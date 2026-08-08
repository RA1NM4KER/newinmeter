import { liveMeterTopic, PULSES_CHANGED_EVENT } from "./live-realtime";

// Minimal structural surface of the Supabase client that the Live subscription
// uses. Declared here (rather than importing the full SupabaseClient type) so
// the lifecycle logic can be unit-tested against a small hand-written fake --
// testing OUR orchestration, not a mock of Supabase's internals. The real
// @supabase/ssr browser client satisfies this shape.

export interface LiveChannelLike {
  on(type: "broadcast", filter: { event: string }, callback: (payload: unknown) => void): LiveChannelLike;
  subscribe(callback?: (status: string) => void): LiveChannelLike;
}

export interface LiveRealtimeClient {
  auth: {
    getSession(): Promise<{ data: { session: { access_token: string } | null } }>;
    onAuthStateChange(callback: (event: string, session: { access_token: string } | null) => void): {
      data: { subscription: { unsubscribe(): void } };
    };
  };
  realtime: { setAuth(token: string | null): unknown };
  channel(name: string, opts: { config: { private: boolean } }): LiveChannelLike;
  removeChannel(channel: LiveChannelLike): unknown;
}

// Wires up the authenticated user's PRIVATE Live channel and returns a cleanup
// function. Framework-agnostic so it is exercised directly in tests; the React
// hook (use-live-realtime.ts) is a thin useEffect wrapper around it.
//
// Behaviour (each verified by a test):
//  - attaches the current access token via realtime.setAuth BEFORE subscribing,
//    so the private channel authorizes as this user;
//  - subscribes to exactly `live-meter:<userId>` as a private channel;
//  - invokes onPulsesChanged on a `pulses_changed` broadcast, and once on
//    (re)subscribe (SUBSCRIBED) to recover anything missed while disconnected;
//  - re-attaches the token on TOKEN_REFRESHED / SIGNED_IN so the channel stays
//    authorized across the ~1h JWT expiry;
//  - on cleanup: marks itself cancelled (so an in-flight async subscribe and
//    any late callbacks become no-ops), unsubscribes the auth listener, and
//    removes the channel.
export function createLiveSubscription(
  client: LiveRealtimeClient,
  userId: string,
  onPulsesChanged: () => void
): () => void {
  let cancelled = false;
  let channel: LiveChannelLike | null = null;

  void (async () => {
    const { data } = await client.auth.getSession();
    await client.realtime.setAuth(data.session?.access_token ?? null);
    if (cancelled) {
      return;
    }

    channel = client
      .channel(liveMeterTopic(userId), { config: { private: true } })
      .on("broadcast", { event: PULSES_CHANGED_EVENT }, () => {
        if (!cancelled) {
          onPulsesChanged();
        }
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED" && !cancelled) {
          onPulsesChanged();
        }
      });
  })();

  const { data: authListener } = client.auth.onAuthStateChange((event, session) => {
    if (event === "TOKEN_REFRESHED" || event === "SIGNED_IN") {
      void client.realtime.setAuth(session?.access_token ?? null);
    }
  });

  return () => {
    cancelled = true;
    authListener.subscription.unsubscribe();
    if (channel) {
      void client.removeChannel(channel);
    }
  };
}
