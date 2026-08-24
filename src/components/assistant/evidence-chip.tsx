import type { AssistantEvidence } from "@/lib/assistant/types";

// Quiet, informational-only pills -- "based on" evidence, not a control.
// Deliberately not a button: this replaces the old "Used: tool_a, tool_b"
// developer text with something a user actually understands, without
// pretending each chip is interactive when the underlying data is already
// woven into the answer/visualization above it.
export function EvidenceRow({ evidence }: { evidence: AssistantEvidence[] }) {
  if (evidence.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted/80">Based on</span>
      {evidence.map((item, index) => (
        <span
          className="inline-flex items-center rounded-full border border-line bg-canvas px-2 py-0.5 text-[0.6875rem] font-medium text-muted"
          key={`${item.type}-${index}`}
        >
          {item.label}
        </span>
      ))}
    </div>
  );
}
