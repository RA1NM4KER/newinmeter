import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import { NmLogoMark } from "../nm-logo-mark";
import { BRAND_CANVAS } from "@/lib/site-config";

const MAX_DIMENSION = 3000;

function clampDimension(raw: string | null, fallback: number) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.round(value), MAX_DIMENSION);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const width = clampDimension(searchParams.get("w"), 1170);
  const height = clampDimension(searchParams.get("h"), 2532);
  const logoSize = Math.round(Math.min(width, height) * 0.32);

  return new ImageResponse(
    <div
      style={{
        alignItems: "center",
        background: BRAND_CANVAS,
        display: "flex",
        height: "100%",
        justifyContent: "center",
        width: "100%"
      }}
    >
      <NmLogoMark size={logoSize} />
    </div>,
    { width, height }
  );
}
