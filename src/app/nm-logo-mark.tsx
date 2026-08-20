import { BRAND_ACCENT } from "@/lib/site-config";

export function NmLogoMark({ size }: { size: number }) {
  const borderRadius = Math.round(size * (96 / 512));
  const fontSize = Math.round(size * (280 / 512));
  const letterSpacing = Math.round(size * (-8 / 512) * 100) / 100;

  return (
    <div
      style={{
        alignItems: "center",
        background: "#111111",
        borderRadius,
        display: "flex",
        height: size,
        justifyContent: "center",
        width: size
      }}
    >
      <div
        style={{
          color: "#ffffff",
          display: "flex",
          fontFamily: "sans-serif",
          fontSize,
          fontWeight: 700,
          letterSpacing
        }}
      >
        N<span style={{ color: BRAND_ACCENT }}>M</span>
      </div>
    </div>
  );
}
