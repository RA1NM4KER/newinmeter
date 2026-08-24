import type { UnderlineTabsProps } from "./types";

export function UnderlineTabs({ tabs, activeId, onChange, endSlot }: UnderlineTabsProps) {
  return (
    <div className="flex items-center gap-6 border-b border-line" role="tablist">
      {/* overflow-x-auto only kicks in once tab labels actually don't fit
          (e.g. Settings' 4 tabs on a narrow phone) -- a short tab list like
          Activities' two never scrolls, this is a no-op there. shrink-0 on
          each button stops them compressing/wrapping instead of scrolling.
          Scrollbar itself is hidden (scroll still works via drag/trackpad/
          keyboard) -- some browsers paint a visible track for an
          overflow-auto container even when nothing actually overflows. */}
      <div className="flex gap-5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((tab) => {
          const isActive = tab.id === activeId;

          return (
            <button
              aria-selected={isActive}
              className={`-mb-px shrink-0 whitespace-nowrap border-b-2 pb-2 text-sm font-medium transition ${
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
