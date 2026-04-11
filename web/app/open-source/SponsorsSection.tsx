import SentryIcon from "@/components/icons/SentryIcon";
import { APP_NAME } from "@/lib/pwa-metadata";

export default function SponsorsSection() {
  return (
    <section
      aria-labelledby="sponsors-heading"
      className="bg-white rounded-lg shadow-md p-6 md:p-8 border border-neutral-border"
    >
      <h2
        id="sponsors-heading"
        className="text-2xl font-bold text-foreground mb-6"
      >
        Спонсори
      </h2>
      <ul className="flex flex-wrap gap-6">
        <li>
          <a
            href="https://sentry.io/for/open-source/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center gap-2 group"
          >
            <div className="size-16 rounded-full border border-neutral-border bg-neutral-light flex items-center justify-center text-foreground group-hover:ring-2 group-hover:ring-primary group-focus-visible:ring-2 group-focus-visible:ring-primary transition-all">
              <SentryIcon className="size-10" />
            </div>
            <span className="text-xs text-center text-neutral group-hover:text-link">
              Sentry
            </span>
          </a>
        </li>
      </ul>
      <p className="mt-4 text-sm text-neutral">
        Sentry спонсорира {APP_NAME} с безплатен акаунт за проследяване на грешки
        като отворен код.
      </p>
    </section>
  );
}
