import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLiveSubscription, type LiveChannelLike, type LiveRealtimeClient } from "@/lib/live-subscription";

// Lets the async subscribe body (getSession -> setAuth -> channel) run to
// completion before assertions.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

type FakeState = {
  setAuthTokens: Array<string | null>;
  channelCreatedAtFirstSetAuth: boolean;
  channelArgs: [string, { config: { private: boolean } }] | null;
  registeredEvents: Array<{ type: string; event: string }>;
  broadcastHandler: (() => void) | null;
  subscribeCb: ((status: string) => void) | null;
  authCb: ((event: string, session: { access_token: string } | null) => void) | null;
  authUnsubscribes: number;
  removedChannels: number;
};

function makeFakeClient(sessionToken: string | null = "tok-1") {
  const state: FakeState = {
    setAuthTokens: [],
    channelCreatedAtFirstSetAuth: false,
    channelArgs: null,
    registeredEvents: [],
    broadcastHandler: null,
    subscribeCb: null,
    authCb: null,
    authUnsubscribes: 0,
    removedChannels: 0
  };

  const channel: LiveChannelLike = {
    on(type, filter, callback) {
      state.registeredEvents.push({ type, event: filter.event });
      if (type === "broadcast" && filter.event === "pulses_changed") {
        state.broadcastHandler = () => callback({});
      }
      return channel;
    },
    subscribe(callback) {
      state.subscribeCb = callback ?? null;
      return channel;
    }
  };

  const client: LiveRealtimeClient = {
    auth: {
      async getSession() {
        return { data: { session: sessionToken ? { access_token: sessionToken } : null } };
      },
      onAuthStateChange(callback) {
        state.authCb = callback;
        return {
          data: {
            subscription: {
              unsubscribe: () => {
                state.authUnsubscribes += 1;
              }
            }
          }
        };
      }
    },
    realtime: {
      setAuth(token) {
        // Record whether the channel had already been created -- proves setAuth
        // runs BEFORE subscribe.
        if (state.setAuthTokens.length === 0) {
          state.channelCreatedAtFirstSetAuth = state.channelArgs !== null;
        }
        state.setAuthTokens.push(token);
      }
    },
    channel(name, opts) {
      state.channelArgs = [name, opts];
      return channel;
    },
    removeChannel() {
      state.removedChannels += 1;
    }
  };

  return { client, state };
}

describe("createLiveSubscription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("subscribes to the user's own private topic, authorizing before subscribe", async () => {
    const { client, state } = makeFakeClient("tok-1");
    createLiveSubscription(client, "user-a", vi.fn());
    await flush();

    expect(state.channelArgs?.[0]).toBe("live-meter:user-a");
    expect(state.channelArgs?.[1]).toEqual({ config: { private: true } });
    expect(state.setAuthTokens[0]).toBe("tok-1");
    expect(state.channelCreatedAtFirstSetAuth).toBe(false); // setAuth ran first
  });

  it("passes a null token when there is no session", async () => {
    const { client, state } = makeFakeClient(null);
    createLiveSubscription(client, "user-a", vi.fn());
    await flush();
    expect(state.setAuthTokens[0]).toBeNull();
  });

  it("invalidates on a pulses_changed broadcast", async () => {
    const { client, state } = makeFakeClient();
    const onChange = vi.fn();
    createLiveSubscription(client, "user-a", onChange);
    await flush();

    state.broadcastHandler?.();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("only registers the pulses_changed broadcast (unrelated events cannot invalidate)", async () => {
    const { client, state } = makeFakeClient();
    createLiveSubscription(client, "user-a", vi.fn());
    await flush();
    expect(state.registeredEvents).toEqual([{ type: "broadcast", event: "pulses_changed" }]);
  });

  it("invalidates once on (re)subscribe to recover missed events, but not on other statuses", async () => {
    const { client, state } = makeFakeClient();
    const onChange = vi.fn();
    createLiveSubscription(client, "user-a", onChange);
    await flush();

    state.subscribeCb?.("SUBSCRIBED");
    expect(onChange).toHaveBeenCalledTimes(1);

    state.subscribeCb?.("CHANNEL_ERROR");
    state.subscribeCb?.("TIMED_OUT");
    state.subscribeCb?.("CLOSED");
    expect(onChange).toHaveBeenCalledTimes(1); // errors fail gracefully, no invalidation
  });

  it("re-authorizes on token refresh / sign-in, ignoring other auth events", async () => {
    const { client, state } = makeFakeClient("tok-1");
    createLiveSubscription(client, "user-a", vi.fn());
    await flush();

    state.authCb?.("TOKEN_REFRESHED", { access_token: "tok-2" });
    state.authCb?.("SIGNED_IN", { access_token: "tok-3" });
    expect(state.setAuthTokens).toContain("tok-2");
    expect(state.setAuthTokens).toContain("tok-3");

    const before = state.setAuthTokens.length;
    state.authCb?.("SIGNED_OUT", null);
    state.authCb?.("USER_UPDATED", { access_token: "tok-x" });
    expect(state.setAuthTokens.length).toBe(before); // no re-auth on these
  });

  it("cleans up: unsubscribes auth, removes channel, and late callbacks become no-ops", async () => {
    const { client, state } = makeFakeClient();
    const onChange = vi.fn();
    const cleanup = createLiveSubscription(client, "user-a", onChange);
    await flush();

    cleanup();
    expect(state.authUnsubscribes).toBe(1);
    expect(state.removedChannels).toBe(1);

    onChange.mockClear();
    state.broadcastHandler?.();
    state.subscribeCb?.("SUBSCRIBED");
    expect(onChange).not.toHaveBeenCalled(); // cancelled
  });

  it("cleanup before the async subscribe completes aborts it without creating a channel", async () => {
    const { client, state } = makeFakeClient();
    const cleanup = createLiveSubscription(client, "user-a", vi.fn());
    cleanup(); // before flush -> cancels the in-flight subscribe
    await flush();

    expect(state.channelArgs).toBeNull();
    expect(state.removedChannels).toBe(0); // no channel to remove
    expect(state.authUnsubscribes).toBe(1);
  });
});
