import Link from "next/link";
import type { ReactNode } from "react";
import { Wordmark } from "./wordmark";

type TopBarProps = {
  // Optional right-side element -- AppShell puts <NotificationBell /> here,
  // public/document pages (DocumentShell, /install) pass nothing.
  right?: ReactNode;
  // Positioning/visibility varies by caller (AppShell: fixed + lg:hidden,
  // since desktop has its own sidebar header instead; document/support
  // pages: sticky at every width, no desktop alternative) -- that's a real
  // per-page difference, not something this shared component should paper
  // over. The chrome itself (height, padding, border, background, logo
  // size) is the part that must never drift, so that's the only part fixed
  // here.
  className?: string;
  // AppShell's own scroll-to-hide state -- translate this bar off-screen
  // upward. Callers with no such behavior (document/support pages) simply
  // never pass this, so it stays permanently visible.
  hidden?: boolean;
};

// Single source of truth for NewinMeter's top navbar chrome -- the
// authenticated mobile header's own h-14/px-4/text-base dimensions, which
// DocumentShell and /install used to duplicate at a different (larger)
// size. Logo size, bar height, border/background, and horizontal spacing
// must stay identical everywhere this renders.
export function TopBar({ right, className = "", hidden = false }: TopBarProps) {
  return (
    <header
      className={`flex h-14 items-center justify-between border-b border-line bg-canvas px-4 transition-transform duration-200 motion-reduce:transition-none ${
        hidden ? "-translate-y-full" : "translate-y-0"
      } ${className}`}
    >
      <Link href="/">
        <Wordmark className="text-base" textClassName="text-ink" accentClassName="text-accent" />
      </Link>
      {right}
    </header>
  );
}
