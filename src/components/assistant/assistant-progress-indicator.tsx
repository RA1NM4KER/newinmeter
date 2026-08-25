"use client";

import { Sparkles } from "lucide-react";

// Restrained execution-progress indicator: a small sparkle + three tiny
// staggered dots, subtle brand green, no glow/gradient/orbiting/giant
// spinner. `label` is already an app-owned status string (see
// progress-labels.ts -- never a raw tool name), and `null` means "no real
// tool has started yet" -- shown as a generic "Thinking..." so the
// indicator appears immediately on submit rather than waiting for the
// first real progress event. motion-safe: only animates when the user
// hasn't requested reduced motion; otherwise the dots render as a static,
// evenly-lit row.
export function AssistantProgressIndicator({ label }: { label: string | null }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted" role="status">
      <Sparkles aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-brandGreen" />
      <span className="inline-flex items-center gap-1" aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <span
            className="h-1.5 w-1.5 rounded-full bg-brandGreen/70 motion-safe:animate-assistantProgressDot"
            key={index}
            style={{ animationDelay: `${index * 0.18}s` }}
          />
        ))}
      </span>
      <span className="truncate">{label ?? "Thinking..."}</span>
    </div>
  );
}
