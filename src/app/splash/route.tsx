import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

// iOS ignores the web manifest for its launch splash screen and instead
// needs a matching pre-rendered PNG per device size, wired up via
// appleWebApp.startupImage in layout.tsx. Rendering it on the fly here
// (same mark as app-icon.tsx) avoids hand-exporting a PNG per device.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const width = Number(searchParams.get("w")) || 1170;
  const height = Number(searchParams.get("h")) || 2532;
  const logoSize = Math.round(Math.min(width, height) * 0.32);

  return new ImageResponse(
    <div
      style={{
        alignItems: "center",
        background: "#f6f6f6",
        display: "flex",
        height: "100%",
        justifyContent: "center",
        width: "100%"
      }}
    >
      <div
        style={{
          alignItems: "center",
          background: "#111111",
          borderRadius: Math.round(logoSize * 0.19),
          display: "flex",
          height: logoSize,
          justifyContent: "center",
          width: logoSize
        }}
      >
        <div
          style={{
            color: "#ffffff",
            display: "flex",
            fontFamily: "sans-serif",
            fontSize: Math.round(logoSize * 0.55),
            fontWeight: 700,
            letterSpacing: -8
          }}
        >
          N<span style={{ color: "#00ff9b" }}>M</span>
        </div>
      </div>
    </div>,
    { width, height }
  );
}
