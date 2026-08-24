"use client";

import { ArrowUpRight, Sparkles } from "lucide-react";
import { BorderBeam } from "@/components/ui/border-beam";
import { useAssistant } from "./assistant-provider";

type AssistantPanelProps = {
  from: string;
  to: string;
  compact?: boolean;
};

// Trigger only -- the actual conversation lives in AssistantDialog, mounted
// once globally (see app-shell.tsx) so it can also be opened from
// elsewhere in the app (e.g. "Ask AI" on a notification) and keep its
// conversation across a page navigation, not just while this button is
// mounted.
export function AssistantPanel({ from, to, compact = false }: AssistantPanelProps) {
  const { open, turns } = useAssistant();

  return (
    <button
      className={`group relative overflow-hidden bg-transparent text-left transition duration-200 ${
        compact ? "h-9 w-full rounded-md px-3" : "block w-full rounded-xl px-4 py-3 lg:max-w-3xl"
      }`}
      onClick={() => open({ from, to })}
      type="button"
    >
      <div
        className={
          compact
            ? "absolute inset-0 rounded-[inherit] border border-white/15 bg-white/10 transition duration-200 group-hover:border-white/30 group-hover:bg-white/15"
            : "absolute inset-0 rounded-[inherit] border border-line bg-paper transition duration-200 group-hover:border-accent/35 group-hover:bg-canvas/40"
        }
      />
      <BorderBeam
        borderWidth={1.5}
        colorFrom="rgba(0, 255, 155, 0)"
        colorTo="rgba(0, 255, 155, 0.95)"
        duration={8.5}
        size={300}
      />
      <div
        className={`relative flex items-center ${compact ? "text-white/80" : "text-muted"} ${compact ? "gap-2 text-sm" : "gap-3 text-sm"}`}
      >
        <div
          className={`shrink-0 rounded-full ring-1 transition ${
            compact
              ? "bg-white/15 ring-white/20 group-hover:ring-white/35"
              : "bg-paper/90 ring-accent/15 group-hover:ring-accent/30"
          } ${compact ? "flex h-5 w-5 items-center justify-center" : "flex h-8 w-8 items-center justify-center"}`}
        >
          <Sparkles className={`${compact ? "h-3 w-3" : "h-4 w-4"} text-brandGreen`} />
        </div>
        <span
          className={`min-w-0 flex-1 truncate ${compact ? "text-white/80" : "text-ink/80"} ${compact ? "pr-2 text-sm" : ""}`}
        >
          {compact
            ? "Ask your energy assistant..."
            : turns.length
              ? "Continue the conversation about your usage and spend..."
              : "Ask about spend, usage, top-ups, spikes, or comparisons..."}
        </span>
        {compact ? <ArrowUpRight className="ml-auto h-3.5 w-3.5 shrink-0 text-white/70" /> : null}
      </div>
    </button>
  );
}
