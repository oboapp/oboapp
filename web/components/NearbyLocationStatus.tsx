import { LocateFixed } from "lucide-react";
import type { NearbyLocationState } from "@/components/MapContainer";
import { borderRadius, buttonSizes, buttonStyles } from "@/lib/theme";

export function NearbyLocationStatus({ location }: { readonly location: NearbyLocationState }) {
  if (location.status === "idle" || location.status === "loading") {
    return <p className="text-neutral">Определяме местоположението ти...</p>;
  }

  if (location.status === "ready") {
    return (
      <button
        type="button"
        onClick={location.retry}
        className={`${buttonStyles.ghost} ${buttonSizes.sm} ${borderRadius.sm} inline-flex items-center gap-2`}
      >
        <LocateFixed className="h-4 w-4" aria-hidden="true" />
        Обнови местоположението
      </button>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-neutral">{location.message}</p>
      <button
        type="button"
        onClick={location.retry}
        className={`${buttonStyles.primary} ${buttonSizes.sm} ${borderRadius.sm}`}
      >
        {location.status === "permission-required" ? "Разреши местоположение" : "Опитай отново"}
      </button>
    </div>
  );
}
