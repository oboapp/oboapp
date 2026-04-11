import { ImageResponse } from "next/og";
import { APP_NAME } from "@/lib/pwa-metadata";

export const runtime = "edge";
export const alt = APP_NAME;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const LOCALITY_NAMES: Record<string, string> = {
  "bg.sofia": "София",
};

export default function OgImage() {
  const locality = process.env.NEXT_PUBLIC_LOCALITY ?? "bg.sofia";
  const cityName = LOCALITY_NAMES[locality] ?? "София";
  const tagline = `Следи събитията в ${cityName}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#2c3e50",
          position: "relative",
        }}
      >
        {/* Brand red accent bar at top */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: "10px",
            backgroundColor: "#E74C3C",
            display: "flex",
          }}
        />
        {/* App name */}
        <div
          style={{
            fontSize: 120,
            fontWeight: 700,
            color: "#ffffff",
            letterSpacing: "-2px",
            display: "flex",
          }}
        >
          {APP_NAME}
        </div>
        {/* Tagline */}
        <div
          style={{
            fontSize: 40,
            color: "rgba(255,255,255,0.7)",
            marginTop: 24,
            display: "flex",
          }}
        >
          {tagline}
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
