import { Activity, Gauge, LayoutDashboard, Settings as SettingsIcon, ShieldCheck, Table2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Gauge as GaugePhosphor, Gear, Pulse, SquaresFour, Table } from "@phosphor-icons/react";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  preserveDateRange: boolean;
  isNew?: boolean;
  // Gets a fixed slot in the mobile bottom nav bar. Admin is the only item
  // that never does -- it lives behind the bottom bar's "More" tab instead.
  bottomNav?: boolean;
  // Bottom-nav-bar-only icon, in a set that ships genuine outline/fill pairs
  // (lucide is stroke-only) so the active tab can fill solid instead of
  // just changing color. Unset for items that never appear in the bar.
  bottomIcon?: PhosphorIcon;
};

export type NavPermissions = {
  isAdmin?: boolean;
  isActivitiesEnabled?: boolean;
  isLiveMeterEnabled?: boolean;
};

// Live sits right after Dashboard: it's the second most immediate "what's my
// house doing" surface. Rolling telemetry, so it never carries a date range.
const liveNavItem: NavItem = {
  href: "/live",
  label: "Live",
  icon: Gauge,
  preserveDateRange: false,
  bottomNav: true,
  bottomIcon: GaugePhosphor
};

const dashboardItem: NavItem = {
  href: "/",
  label: "Dashboard",
  icon: LayoutDashboard,
  preserveDateRange: true,
  bottomNav: true,
  bottomIcon: SquaresFour
};
const tailItems: NavItem[] = [
  { href: "/data", label: "Data", icon: Table2, preserveDateRange: true, bottomNav: true, bottomIcon: Table },
  {
    href: "/activities",
    label: "Activities",
    icon: Activity,
    preserveDateRange: true,
    isNew: true,
    bottomNav: true,
    bottomIcon: Pulse
  },
  {
    href: "/settings",
    label: "Settings",
    icon: SettingsIcon,
    preserveDateRange: false,
    bottomNav: true,
    bottomIcon: Gear
  }
];

const adminNavItem: NavItem = { href: "/admin", label: "Admin", icon: ShieldCheck, preserveDateRange: false };

// Single source of truth for which nav entries a given user sees, so the
// desktop rail and the mobile drawer can never drift. Gated features
// (Live, Activities) are OMITTED entirely when disabled -- never rendered
// disabled or as a teaser -- so a user without the permission has no way to
// even discover the feature exists.
export function buildNavItems(permissions: NavPermissions): NavItem[] {
  const items: NavItem[] = [dashboardItem];

  if (permissions.isLiveMeterEnabled) {
    items.push(liveNavItem);
  }

  for (const item of tailItems) {
    if (item.href === "/activities" && !permissions.isActivitiesEnabled) {
      continue;
    }
    items.push(item);
  }

  if (permissions.isAdmin) {
    items.push(adminNavItem);
  }

  return items;
}
