import { ImageResponse } from "next/og";
import { APP_NAME } from "@/lib/pwa-metadata";
import { getConfiguredLocalityDescription } from "@/lib/locality-metadata";
import { buildOgCard } from "@/lib/og-card";

export const runtime = "nodejs";
export const alt = APP_NAME;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function TwitterImage() {
  return new ImageResponse(
    buildOgCard(getConfiguredLocalityDescription()),
    { width: 1200, height: 630 },
  );
}
