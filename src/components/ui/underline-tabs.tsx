import type { UnderlineTabsProps } from "./types";

export function UnderlineTabs({ tabs, activeId, onChange, endSlot }: UnderlineTabsProps) {
  return (
    <div className="flex items-center gap-6 border-b border-line" role="tablist">
      <div className="flex gap-5">
        {tabs.map((tab) => {
          const isActive = tab.id === activeId;

          return (
            <button
              aria-selected={isActive}
              className={`-mb-px border-b-2 pb-2 text-sm font-medium transition ${
                isActive ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"
              }`}
              key={tab.id}
              onClick={() => onChange(tab.id)}
              role="tab"
              type="button"
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {endSlot}
    </div>
  );
}
