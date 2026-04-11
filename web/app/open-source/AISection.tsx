import CopilotIcon from "@/components/icons/CopilotIcon";
import ClaudeIcon from "@/components/icons/ClaudeIcon";
import { ComponentType, SVGProps } from "react";

const AI_TOOLS: {
  name: string;
  url: string;
  Icon: ComponentType<SVGProps<SVGSVGElement> & { className?: string }>;
}[] = [
  {
    name: "GitHub Copilot",
    url: "https://github.com/features/copilot",
    Icon: CopilotIcon,
  },
  {
    name: "Claude",
    url: "https://www.anthropic.com",
    Icon: ClaudeIcon,
  },
];

export default function AISection() {
  return (
    <section
      aria-labelledby="ai-heading"
      className="bg-white rounded-lg shadow-md p-6 md:p-8 border border-neutral-border"
    >
      <h2 id="ai-heading" className="text-2xl font-bold text-foreground mb-6">
        Направено с AI
      </h2>
      <ul className="flex flex-wrap gap-6">
        {AI_TOOLS.map((tool) => (
          <li key={tool.name}>
            <a
              href={tool.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col items-center gap-2 group"
            >
              <div className="size-16 rounded-full border border-neutral-border bg-neutral-light flex items-center justify-center text-foreground group-hover:ring-2 group-hover:ring-primary group-focus-visible:ring-2 group-focus-visible:ring-primary transition-all">
                <tool.Icon className="size-12" />
              </div>
              <span className="text-xs text-center text-neutral group-hover:text-link">
                {tool.name}
              </span>
            </a>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-sm text-neutral">
        * Възможно е да са участвали и други, но тези са видими в{" "}
        <a
          href="https://github.com/vbuch/oboapp/graphs/contributors"
          target="_blank"
          rel="noopener noreferrer"
          className="text-link hover:text-link-hover hover:underline"
          lang="en"
        >
          Contributors
        </a>
        .
      </p>
    </section>
  );
}
