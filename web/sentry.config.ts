import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const ignoredErrorMessages = ["vm.USE_MAIN_CONTEXT_DEFAULT_LOADER"];

function isIgnoredErrorMessage(value: string | undefined): boolean {
  return Boolean(
    value && ignoredErrorMessages.some((message) => value.includes(message)),
  );
}

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.1,
    integrations: [Sentry.captureConsoleIntegration({ levels: ["error"] })],
    beforeSend(event) {
      const exceptionValues = event.exception?.values ?? [];
      if (
        isIgnoredErrorMessage(event.message) ||
        exceptionValues.some((exception) =>
          isIgnoredErrorMessage(exception.value),
        )
      ) {
        return null;
      }

      return event;
    },
  });
}
