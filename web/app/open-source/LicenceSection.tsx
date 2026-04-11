import GitHubRepoLink from "./GitHubRepoLink";

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
        OboApp е публикуван под{" "}
        <a
          href="https://github.com/vbuch/oboapp/blob/main/LICENSE"
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
