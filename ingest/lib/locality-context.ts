import { readFileSync } from "node:fs";
import { join } from "node:path";

import { load as parseYaml } from "js-yaml";
import { z } from "zod";

import { logger } from "@/lib/logger";
import { getLocality } from "@/lib/target-locality";

const LocalityContextSchema = z.object({
  city: z.string(),
  country: z.string(),
  "primary-language": z.string(),
  districts: z.array(z.string()),
  "address-hints": z.string(),
});

export type LocalityContext = z.infer<typeof LocalityContextSchema>;

let cachedContext: LocalityContext | null = null;

function loadLocalityContext(): LocalityContext {
  const locality = getLocality();
  const filePath = join(
    process.cwd(),
    "prompts",
    "localities",
    `${locality}.yaml`,
  );

  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      throw new Error(
        `Locality context file not found for "${locality}": ${filePath}. ` +
          `Create prompts/localities/${locality}.yaml to continue.`,
        { cause: error },
      );
    }

    throw new Error(
      `Unable to read locality context file for "${locality}": ${filePath}.`,
      { cause: error },
    );
  }

  let raw: unknown;
  try {
    raw = parseYaml(content);
  } catch (error: unknown) {
    throw new Error(
      `Invalid YAML in locality context file for "${locality}": ${filePath}.`,
      { cause: error },
    );
  }

  const result = LocalityContextSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `Invalid locality context file for "${locality}": ${result.error.message}`,
    );
  }

  logger.debug("Loaded locality context", {
    locality,
    city: result.data.city,
  });
  return result.data;
}

function getLocalityContext(): LocalityContext {
  if (!cachedContext) {
    cachedContext = loadLocalityContext();
  }
  return cachedContext;
}

/**
 * Applies locality-specific placeholder substitution to a prompt template string.
 * Throws if any {{PLACEHOLDER}} remains unresolved after substitution.
 */
export function applyLocalityContext(template: string): string {
  const ctx = getLocalityContext();

  const substitutions: Record<string, string> = {
    "{{CITY}}": ctx.city,
    "{{COUNTRY}}": ctx.country,
    "{{PRIMARY_LANGUAGE}}": ctx["primary-language"],
    "{{DISTRICTS}}": ctx.districts.join(", "),
    "{{ADDRESS_HINTS}}": ctx["address-hints"],
  };

  let result = template;
  for (const [placeholder, value] of Object.entries(substitutions)) {
    result = result.replaceAll(placeholder, value);
  }

  const unreplaced = result.match(/\{\{[A-Z_]+\}\}/g);
  if (unreplaced) {
    const uniqueUnreplaced = [...new Set(unreplaced)];
    const locality = getLocality();
    throw new Error(
      `Prompt contains unresolved placeholders: ${uniqueUnreplaced.join(", ")}. ` +
        `Add the corresponding keys to prompts/localities/${locality}.yaml.`,
    );
  }

  return result;
}
