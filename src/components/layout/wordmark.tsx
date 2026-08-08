type WordmarkProps = {
  className?: string;
  textClassName?: string;
  accentClassName?: string;
};

// Two contexts use this: the signed-out auth pages, whose background is
// permanently dark regardless of the app's own theme toggle (fixed white +
// brandGreen defaults below), and the authenticated app shell, which passes
// theme-aware tokens instead (text-ink / text-accent) so it flips correctly
// with light/dark mode.
export function Wordmark({
  className = "",
  textClassName = "text-white",
  accentClassName = "text-brandGreen"
}: WordmarkProps) {
  return (
    <span className={`font-semibold tracking-tight ${textClassName} ${className}`}>
      Newin<span className={accentClassName}>Meter</span>
    </span>
  );
}
