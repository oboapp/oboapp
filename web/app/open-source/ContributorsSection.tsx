import Image from "next/image";

interface GitHubContributor {
  login: string;
  avatar_url: string;
  html_url: string;
}

interface ContributorsSectionProps {
  contributors: GitHubContributor[];
}

export default function ContributorsSection({
  contributors,
}: ContributorsSectionProps) {
  return (
    <section
      aria-labelledby="contributors-heading"
      className="bg-white rounded-lg shadow-md p-6 md:p-8 border border-neutral-border"
    >
      <h2
        id="contributors-heading"
        className="text-2xl font-bold text-foreground mb-6"
      >
        Направено от вас
      </h2>
      {contributors.length > 0 ? (
        <ul className="grid grid-cols-3 sm:grid-cols-4 gap-4">
          {contributors.map((contributor) => (
            <li key={contributor.login}>
              <a
                href={contributor.html_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col items-center gap-2 group"
              >
                <Image
                  src={contributor.avatar_url}
                  alt={contributor.login}
                  width={80}
                  height={80}
                  className="rounded-full border border-neutral-border group-hover:ring-2 group-hover:ring-primary group-focus-visible:ring-2 group-focus-visible:ring-primary transition-all"
                />
                <span className="text-xs text-center text-neutral group-hover:text-link truncate w-full">
                  {contributor.login}
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-neutral text-sm">
          Данните за участниците временно не са достъпни.
        </p>
      )}
    </section>
  );
}
