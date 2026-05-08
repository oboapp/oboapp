import GitHubRepoLink from "./GitHubRepoLink";
import { APP_NAME } from "@/lib/pwa-metadata";
import { GITHUB_REPO } from "@/lib/github";

export default function LicenceSection() {
  return (
    <section
      aria-labelledby="licence-heading"
      className="bg-white rounded-lg shadow-md p-6 md:p-8 border border-neutral-border"
    >
      <h2
        id="licence-heading"
        className="text-2xl font-bold text-foreground mb-4"
      >
        Лиценз: Unlicense
      </h2>
      <p className="text-neutral mb-4">
        {APP_NAME} е публикуван под{" "}
        <a
          href={`https://github.com/${GITHUB_REPO}/blob/main/LICENSE`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-link hover:text-link-hover hover:underline"
        >
          Unlicense
        </a>{" "}
        — можеш да правиш каквото искаш с кода:
      </p>
      <ul className="list-disc list-inside space-y-1 text-neutral mb-6">
        <li lang="en">contribute</li>
        <li lang="en">fork it</li>
        <li lang="en">host it</li>
      </ul>
      <GitHubRepoLink />
    </section>
  );
}
