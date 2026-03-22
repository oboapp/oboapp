"use client";

import { FlaskConical } from "lucide-react";
import type { Source } from "@/lib/source-utils";

interface ExperimentalFeaturesSectionProps {
  readonly enabled: boolean;
  readonly onToggle: (enabled: boolean) => void;
  readonly experimentalSources: Source[];
}

export default function ExperimentalFeaturesSection({
  enabled,
  onToggle,
  experimentalSources,
}: ExperimentalFeaturesSectionProps) {
  return (
    <div className="px-6 py-5 border-b border-neutral-border last:border-b-0">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <FlaskConical size={18} className="text-neutral" />
          <h3 className="text-base font-medium text-foreground">
            Експериментални функции
          </h3>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onToggle(e.target.checked)}
            className="sr-only peer"
            aria-label="Експериментални функции"
          />
          <div className="w-11 h-6 bg-neutral-border rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-neutral-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary" />
        </label>
      </div>

      <p className="text-sm text-neutral mb-3">
        Включи, за да получаваш известия от нови, все още нетествани източници на
        данни.
      </p>

      {enabled && (
        <div className="mt-3 p-3 bg-neutral-light rounded-lg">
          {experimentalSources.length > 0 ? (
            <ul className="space-y-1">
              {experimentalSources.map((source) => (
                <li
                  key={source.id}
                  className="text-sm text-foreground flex items-center gap-2"
                >
                  <FlaskConical size={14} className="text-warning flex-shrink-0" />
                  {source.name}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-neutral italic">
              В момента няма експериментални функции, но когато се появят, ще ги
              получаваш автоматично.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
