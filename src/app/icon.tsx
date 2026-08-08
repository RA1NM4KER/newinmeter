import { ImageResponse } from "next/og";

export const size = {
  width: 512,
  height: 512
};

export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        alignItems: "center",
        background: "#111111",
        borderRadius: 96,
        display: "flex",
        height: "100%",
        justifyContent: "center",
        width: "100%"
      }}
    >
      <div
        style={{
          color: "#ffffff",
          display: "flex",
          fontFamily: "sans-serif",
          fontSize: 280,
          fontWeight: 700,
          letterSpacing: -8
        }}
      >
        N<span style={{ color: "#00ff9b" }}>M</span>
      </div>
    </div>,
    size
  );
}
