const DEPS = [
  {
    name: "Leaflet",
    url: "https://github.com/Leaflet/Leaflet",
    creator: "@mourner",
    creatorUrl: "https://github.com/mourner",
    creatorName: "Volodymyr Agafonkin",
  },
  {
    name: "Zod",
    url: "https://github.com/colinhacks/zod",
    creator: "@colinhacks",
    creatorUrl: "https://github.com/colinhacks",
    creatorName: "Colin McDonnell",
  },
  {
    name: "Hono",
    url: "https://github.com/honojs/hono",
    creator: "@yusukebe",
    creatorUrl: "https://github.com/yusukebe",
    creatorName: "Yusuke Wada",
  },
  {
    name: "turndown",
    url: "https://github.com/domchristie/turndown",
    creator: "@domchristie",
    creatorUrl: "https://github.com/domchristie",
    creatorName: "Dom Christie",
  },
  {
    name: "dotenv",
    url: "https://github.com/motdotla/dotenv",
    creator: "@motdotla",
    creatorUrl: "https://github.com/motdotla",
    creatorName: "Mot",
  },
] as const;

export default function DepsSection() {
  return (
    <section
      aria-labelledby="deps-heading"
      className="bg-white rounded-lg shadow-md p-6 md:p-8 border border-neutral-border"
    >
      <h2 id="deps-heading" className="text-2xl font-bold text-foreground mb-2">
        Направено върху отворен код
      </h2>
      <ul className="space-y-4">
        {DEPS.map((dep) => (
          <li
            key={dep.name}
            className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
          >
            <a
              href={dep.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-link hover:text-link-hover hover:underline"
            >
              {dep.name}
            </a>
            <span className="text-sm text-neutral">
              от{" "}
              <a
                href={dep.creatorUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-link hover:text-link-hover hover:underline"
              >
                {dep.creator}
              </a>{" "}
              ({dep.creatorName})
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-sm text-neutral leading-relaxed">
        Пълният списък включва и: Next.js, React, Tailwind CSS, Firebase,
        Firebase Admin, MongoDB, Hono, Playwright, Turndown, TanStack Query,
        Turf.js, @react-google-maps/api, @googlemaps/markerclusterer,
        lucide-react, react-markdown, react-cookie-consent, csv-parse, proj4,
        commander, @google/genai, @google-cloud/storage, MDX, ua-parser-js,
        adm-zip, @asteasolutions/zod-to-openapi и много други.
      </p>
    </section>
  );
}
