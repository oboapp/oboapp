import Link from "next/link";

const OPEN_DATA_SOURCES = [
  {
    name: "Sofia Traffic GTFS",
    url: "https://gtfs.sofiatraffic.bg",
    description: "спирки и маршрути на градския транспорт",
  },
  {
    name: "Sofia Plan",
    url: "https://sofiaplan.bg",
    description: "училища и детски градини от Столична община",
  },
  {
    name: "OpenStreetMap",
    url: "https://www.openstreetmap.org",
    description: "геокодиране и улична геометрия",
  },
  {
    name: "sensor.community",
    url: "https://sensor.community",
    description: "данни за качеството на въздуха от граждански сензори",
  },
] as const;

export default function OpenDataSection() {
  return (
    <section
      aria-labelledby="open-data-heading"
      className="bg-white rounded-lg shadow-md p-6 md:p-8 border border-neutral-border"
    >
      <h2
        id="open-data-heading"
        className="text-2xl font-bold text-foreground mb-2"
      >
        Направено върху отворени данни
      </h2>
      <p className="text-sm text-neutral mb-6">
        Приложението се крепи на публично достъпни данни, предоставени безплатно
        от общността.
      </p>
      <ul className="space-y-4">
        {OPEN_DATA_SOURCES.map((source) => (
          <li
            key={source.name}
            className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
          >
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-link hover:text-link-hover hover:underline"
            >
              {source.name}
            </a>
            <span className="text-sm text-neutral">{source.description}</span>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-sm text-neutral">
        <Link
          href="/sources"
          className="text-link hover:text-link-hover hover:underline"
        >
          Всички източници на данни →
        </Link>
      </p>
    </section>
  );
}
