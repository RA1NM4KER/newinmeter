import { displayActivityTag } from "@/lib/activity/utils";

export function ActivityTagChip({ tag, onRemove }: { tag: string; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-accent/30 bg-accentSoft px-2 py-1 text-xs font-medium text-ink">
      {displayActivityTag(tag)}
      {onRemove ? (
        <button
          aria-label={`Remove ${displayActivityTag(tag)}`}
          className="text-muted hover:text-ink"
          onClick={onRemove}
          type="button"
        >
          ×
        </button>
      ) : null}
    </span>
  );
}
