import type { AdminUserListItem } from "@/lib/user-roles";
import { FEATURES } from "@/lib/newinmeter/features-shared";

export function FeatureChips({ user }: { user: AdminUserListItem }) {
  const enabled = FEATURES.filter((feature) => user.features[feature.key].enabled);

  if (enabled.length === 0) {
    return (
      <span className="inline-flex items-center rounded-full border border-line bg-canvas px-2.5 py-0.5 text-xs font-medium text-muted">
        None
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {enabled.map((feature) => (
        <span
          key={feature.key}
          className="inline-flex items-center rounded-full border border-accent/30 bg-accentSoft px-2.5 py-0.5 text-xs font-medium text-brandTeal dark:text-accent"
        >
          {feature.short}
        </span>
      ))}
    </div>
  );
}
