import { readFileSync } from "fs";
import { join } from "path";
import { APP_NAME } from "@/lib/pwa-metadata";

// Read once at module load — avoids an HTTP round-trip and works in Node.js runtime
const logoBuffer = readFileSync(join(process.cwd(), "public/logo.png"));
const LOGO_SRC = `data:image/png;base64,${logoBuffer.toString("base64")}`;

/**
 * Shared JSX card for opengraph-image and twitter-image.
 * Rendered by next/og ImageResponse (Satori) — not a browser component.
 */
export function buildOgCard(tagline: string) {
  return (
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
        {/* eslint-disable-next-line @next/next/no-img-element -- Satori (next/og) does not support next/image */}
        <img src={LOGO_SRC} width={120} height={120} alt="" />
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
  );
}
