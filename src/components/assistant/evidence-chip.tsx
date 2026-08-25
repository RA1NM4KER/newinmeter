"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { AssistantEvidence } from "@/lib/assistant/types";

// Evidence must never compete with the answer -- collapsed by default
// behind a tiny "Sources · N" disclosure, not a row of "BASED ON" pills.
// Generic, non-specific entries (e.g. a model restating the active
// scope as if it were a source) are filtered out defensively -- the system
// prompt already asks the model not to emit these, this is the backstop.
function isMeaningfulEvidence(item: AssistantEvidence): boolean {
  const label = item.label.trim().toLowerCase();
  if (!label) return false;
  return !/^(dashboard scope|active scope|selected range|current scope|date range)\b/.test(label);
}

export function EvidenceRow({ evidence }: { evidence: AssistantEvidence[] }) {
  const [expanded, setExpanded] = useState(false);
  const items = evidence.filter(isMeaningfulEvidence);

  if (items.length === 0) {
    return null;
  }

  return (
    <div>
      <button
        aria-expanded={expanded}
        className="inline-flex items-center gap-1 text-[0.75rem] text-muted/70 transition hover:text-muted"
        onClick={() => setExpanded((current) => !current)}
        type="button"
      >
        Sources · {items.length}
        <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>
      {expanded ? (
        <ul className="mt-1.5 flex flex-col gap-0.5">
          {items.map((item, index) => (
            <li className="text-[0.75rem] text-muted" key={`${item.type}-${index}`}>
              {item.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
