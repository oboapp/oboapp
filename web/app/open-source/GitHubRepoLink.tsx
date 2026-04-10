"use client";

import GitHubIcon from "@/components/icons/GitHubIcon";
import { trackEvent } from "@/lib/analytics";

export default function GitHubRepoLink() {
  return (
    <a
      href="https://github.com/vbuch/oboapp"
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 text-sm font-medium text-link hover:text-link-hover hover:underline"
      onClick={() => {
        trackEvent({
          name: "external_link_clicked",
          params: {
            url: "https://github.com/vbuch/oboapp",
            location: "open-source-page",
            link_text: "GitHub",
          },
        });
      }}
    >
      <GitHubIcon className="size-4 shrink-0" />
      vbuch/oboapp в GitHub
    </a>
  );
}
