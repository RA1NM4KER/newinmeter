import { NmLogoMark } from "./nm-logo-mark";

// Root-level Suspense boundary. Without this, a hard navigation (refresh,
// typed URL, first load after /login) has nothing to stream while the async
// (app)/layout.tsx resolves session/permissions/connection -- the browser
// just freezes on whatever page was on screen before, since there is no
// boundary above the blocked layout for Next to swap in a fallback for. This
// gives it one, so the stale previous page never lingers.
export default function RootLoading() {
  return (
    <div className="flex min-h-[100svh] flex-col items-center justify-center gap-5 bg-canvas">
      <NmLogoMark size={64} />
      <div className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted" />
      </div>
    </div>
  );
}
