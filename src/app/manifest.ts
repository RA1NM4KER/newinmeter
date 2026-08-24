import type { MetadataRoute } from "next";
import { BRAND_ACCENT, BRAND_CANVAS } from "@/lib/site-config";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "NewinMeter",
    short_name: "NewinMeter",
    description: "Track electricity usage, spend, tariffs, and balance from your phone or desktop.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: BRAND_CANVAS,
    theme_color: BRAND_ACCENT,
    icons: [
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable"
      }
    ]
  };
}
