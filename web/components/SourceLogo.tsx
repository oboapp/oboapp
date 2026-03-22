"use client";

import { useState } from "react";
import Image from "next/image";
import sources from "@/lib/sources";

interface SourceLogoProps {
  readonly sourceId: string;
  readonly size?: number;
  readonly showFallbackText?: boolean;
}

export default function SourceLogo({
  sourceId,
  size = 20,
  showFallbackText = false,
}: SourceLogoProps) {
  const [error, setError] = useState(false);
  const logoPath = `/sources/${sourceId}.png`;
  const sourceInfo = sources.find((s) => s.id === sourceId);

  if (error) {
    if (!showFallbackText) return null;
    return (
      <span className="text-xs text-neutral truncate">
        {sourceInfo?.name || sourceId}
      </span>
    );
  }

  return (
    <Image
      src={logoPath}
      alt={sourceInfo?.name || sourceId}
      width={size}
      height={size}
      className="object-contain flex-shrink-0"
      style={{ width: size, height: size }}
      onError={() => setError(true)}
    />
  );
}
