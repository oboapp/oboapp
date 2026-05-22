import SentryIcon from "@/components/icons/SentryIcon";
import SonarQubeCloudIcon from "@/components/icons/SonarQubeCloudIcon";
import { APP_NAME } from "@/lib/pwa-metadata";

export default function SponsorsSection() {
  const sponsors = [
    {
      name: "Sentry",
      href: "https://sentry.io/for/open-source/",
      Icon: SentryIcon,
      frameClassName: "size-16 rounded-full",
      iconClassName: "size-10",
    },
    {
      name: "SonarQube Cloud",
      href: "https://www.sonarsource.com/products/sonarcloud/open-source/",
      Icon: SonarQubeCloudIcon,
      frameClassName: "size-16 rounded-full",
      iconClassName: "size-11",
    },
  ] as const;

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
        {sponsors.map(({ name, href, Icon, frameClassName, iconClassName }) => (
          <li key={name}>
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col items-center gap-2 group"
            >
              <div
                className={`${frameClassName} border border-neutral-border bg-neutral-light flex items-center justify-center text-foreground group-hover:ring-2 group-hover:ring-primary group-focus-visible:ring-2 group-focus-visible:ring-primary transition-all`}
              >
                <Icon className={iconClassName} />
              </div>
              <span className="text-xs text-center text-neutral group-hover:text-link">
                {name}
              </span>
            </a>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-sm text-neutral">
        Sentry и SonarQube Cloud спонсорират {APP_NAME} с безплатни услуги за
        проследяване на грешки, анализ на качеството на кода и проверки по
        сигурността за проекти с отворен код.
      </p>
    </section>
  );
}
