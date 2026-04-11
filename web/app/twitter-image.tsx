import { ImageResponse } from "next/og";
import { APP_NAME } from "@/lib/pwa-metadata";

export const runtime = "edge";
export const alt = APP_NAME;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const LOCALITY_NAMES: Record<string, string> = {
  "bg.sofia": "София",
};

export default function TwitterImage() {
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ?? "https://oboapp.online";
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

        {/* Logo in white rounded container, matching Header style */}
        <div
          style={{
            display: "flex",
            backgroundColor: "#ffffff",
            borderRadius: "20px",
            padding: "16px",
            marginBottom: "36px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`${baseUrl}/logo.png`}
            width={120}
            height={120}
            alt=""
          />
        </div>

        {/* App name */}
        <div
          style={{
            fontSize: 96,
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
            fontSize: 36,
            color: "#5DADE2",
            marginTop: 16,
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
