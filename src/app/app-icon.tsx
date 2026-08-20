import { ImageResponse } from "next/og";
import { NmLogoMark } from "./nm-logo-mark";

export const size = {
  width: 512,
  height: 512
};

export const contentType = "image/png";

export default function AppIcon() {
  return new ImageResponse(<NmLogoMark size={512} />, size);
}
