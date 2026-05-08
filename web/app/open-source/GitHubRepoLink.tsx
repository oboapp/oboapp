"use client";

import GitHubIcon from "@/components/icons/GitHubIcon";
import { trackEvent } from "@/lib/analytics";
import { APP_NAME } from "@/lib/pwa-metadata";
import { GITHUB_REPO_URL } from "@/lib/github";

export default function GitHubRepoLink() {
  return (
    <a
      href={GITHUB_REPO_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 text-sm font-medium text-link hover:text-link-hover hover:underline"
      onClick={() => {
        trackEvent({
          name: "external_link_clicked",
          params: {
            url: GITHUB_REPO_URL,
            location: "open-source-page",
            link_text: "GitHub",
          },
        });
      }}
    >
      <GitHubIcon className="size-4 shrink-0" />
      {APP_NAME} в GitHub
    </a>
  );
}
