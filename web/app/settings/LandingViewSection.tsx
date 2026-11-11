"use client";

import { useState } from "react";
import {
  useLandingPreference,
  type LandingView,
} from "@/lib/hooks/useLandingPreference";

const OPTIONS: readonly {
  value: LandingView;
  label: string;
  description: string;
}[] = [
  {
    value: "all",
    label: "Всички",
    description: "Общ изглед на града при отваряне.",
  },
  {
    value: "nearby",
    label: "Около мен",
    description: "Използва текущото местоположение при отваряне.",
  },
  {
    value: "zones",
    label: "Моите зони",
    description: "Показва събитията, които засягат запазените ти зони.",
  },
];

export function LandingViewSection() {
  const { preferredLandingView, isLoading, setPreferredLandingView } =
    useLandingPreference();
  const [saveFailed, setSaveFailed] = useState(false);

  const handleChange = (view: LandingView) => {
    setSaveFailed(!setPreferredLandingView(view));
  };

  return (
    <section className="bg-white rounded-lg shadow mb-6 p-6">
      <h2 className="text-xl font-semibold text-foreground mb-2">
        Начален изглед
      </h2>
      <p id="landing-view-description" className="text-neutral mb-4">
        Избери какво да виждаш при отваряне на приложението на това устройство.
      </p>
      <fieldset
        disabled={isLoading}
        aria-describedby="landing-view-description"
        className="space-y-3"
      >
        <legend className="sr-only">Избор на начален изглед</legend>
        {OPTIONS.map((option) => (
          <label
            key={option.value}
            className={`flex items-start gap-3 rounded-md text-foreground transition-colors ${
              isLoading ? "cursor-not-allowed" : "cursor-pointer hover:bg-neutral-light"
            }`}
          >
            <input
              type="radio"
              name="landing-view"
              value={option.value}
              aria-labelledby={`landing-view-${option.value}-label`}
              aria-describedby={`landing-view-${option.value}-description`}
              checked={(preferredLandingView ?? "all") === option.value}
              onChange={() => {
                handleChange(option.value);
              }}
              className="accent-primary mt-1"
            />
            <span>
              <span id={`landing-view-${option.value}-label`} className="block">
                {option.label}
              </span>
              <span
                id={`landing-view-${option.value}-description`}
                className="block text-sm text-neutral"
              >
                {option.description}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      {saveFailed && (
        <p role="alert" className="text-error text-sm mt-3">
          Настройката не се запази. Провери дали браузърът позволява запазване на
          данни и опитай отново.
        </p>
      )}
    </section>
  );
}
