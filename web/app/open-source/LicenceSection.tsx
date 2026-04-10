import ExternalLinkIcon from "@/components/icons/ExternalLinkIcon";
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
      <div className="flex flex-wrap gap-4 items-center mb-6">
        <a
          href="https://www.facebook.com/valery.buchinsky/posts/pfbid0DNVQJ9RgUKmjabwKAccm7MqVNX2Lu3icgCiXu8Vg9dszpdf4LDMsesqYnfoe16kSl"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-link hover:text-link-hover hover:underline text-sm"
        >
          Публикация във Facebook
          <ExternalLinkIcon className="size-3" />
        </a>
        <a
          href="https://www.linkedin.com/feed/update/urn:li:activity:7422898120201568256/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-link hover:text-link-hover hover:underline text-sm"
        >
          Публикация в LinkedIn
          <ExternalLinkIcon className="size-3" />
        </a>
      </div>
      <GitHubRepoLink />
    </section>
  );
}
