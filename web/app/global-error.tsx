"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { getButtonClasses } from "@/lib/theme";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="bg">
      <body className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="max-w-md text-center">
          <h1 className="mb-2 text-xl font-semibold text-foreground">
            Нещо се обърка
          </h1>
          <p className="mb-6 text-neutral">
            Възникна неочаквана грешка. Опитай отново.
          </p>
          <button type="button" onClick={reset} className={getButtonClasses("destructive")}>
            Опитай пак
          </button>
        </div>
      </body>
    </html>
  );
}
