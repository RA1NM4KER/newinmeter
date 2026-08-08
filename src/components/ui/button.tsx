import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "danger" | "dangerGhost";
type Size = "sm" | "md";

// One button system for the whole app so actions read consistently instead of
// every card inventing its own border/fill. Variants encode intent: primary =
// the main action, secondary = a neutral alternative, danger = destructive,
// dangerGhost = a quiet control that only turns red on hover (e.g. Disconnect).
const base =
  "inline-flex w-fit items-center justify-center rounded-md font-medium transition " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 " +
  "focus-visible:ring-offset-paper disabled:cursor-not-allowed disabled:opacity-60";

const variants: Record<Variant, string> = {
  primary: "bg-ink text-paper hover:opacity-90",
  secondary: "border border-line bg-paper text-ink hover:bg-canvas",
  danger: "bg-red-600 text-white hover:bg-red-700",
  dangerGhost: "border border-line bg-paper text-muted hover:border-red-300 hover:text-red-600"
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-9 px-3.5 text-sm"
};

function classes(variant: Variant, size: Size, className: string) {
  return `${base} ${variants[variant]} ${sizes[size]} ${className}`.trim();
}

type CommonProps = {
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
};

type ButtonAsButton = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children"> & { href?: undefined };

type ButtonAsLink = CommonProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "children"> & { href: string };

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  ...props
}: ButtonAsButton | ButtonAsLink) {
  if ("href" in props && props.href !== undefined) {
    const { children, ...anchorProps } = props;
    return (
      <a className={classes(variant, size, className)} {...anchorProps}>
        {children}
      </a>
    );
  }

  const { children, type, ...buttonProps } = props as ButtonAsButton;
  return (
    <button type={type ?? "button"} className={classes(variant, size, className)} {...buttonProps}>
      {children}
    </button>
  );
}
