/**
 * Custom promptfoo assertion functions that validate LLM outputs
 * against the same Zod schemas used in production.
 *
 * Referenced from YAML configs via `type: javascript` assertions.
 *
 * Each function receives (output, context) per promptfoo's
 * AssertionValueFunction signature.
 */

type AssertionValueFunctionContext = {
  config?: {
    value?: unknown;
  };
};

type GradingResult = {
  pass: boolean;
  score: number;
  reason: string;
};

/**
 * Validates that the output is valid JSON parseable by the FilterSplitResponseSchema.
 */
export async function validateFilterSplitSchema(
  output: string,
  _context: AssertionValueFunctionContext,
): Promise<GradingResult> {
  const { FilterSplitResponseSchema } =
    await import("../lib/filter-split.schema");
  return validateWithSchema(output, FilterSplitResponseSchema, "FilterSplit");
}

/**
 * Validates that the output is valid JSON parseable by the CategorizationResponseSchema.
 */
export async function validateCategorizeSchema(
  output: string,
  _context: AssertionValueFunctionContext,
): Promise<GradingResult> {
  const { CategorizationResponseSchema } =
    await import("../lib/categorize.schema");
  return validateWithSchema(output, CategorizationResponseSchema, "Categorize");
}

/**
 * Validates that the output is valid JSON parseable by the ExtractedLocationsSchema.
 */
export async function validateExtractLocationsSchema(
  output: string,
  _context: AssertionValueFunctionContext,
): Promise<GradingResult> {
  const { ExtractedLocationsSchema } =
    await import("../lib/extract-locations.schema");
  return validateWithSchema(
    output,
    ExtractedLocationsSchema,
    "ExtractLocations",
  );
}

/**
 * Asserts that filter-split output marks the message as irrelevant.
 */
export function assertIrrelevant(
  output: string,
  _context: AssertionValueFunctionContext,
): GradingResult {
  const parsed = parseOutput(output);
  if (!parsed.success) return parsed.result;

  const arr = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
  const allIrrelevant = arr.every(
    (item: Record<string, unknown>) => item.isRelevant === false,
  );

  return {
    pass: allIrrelevant,
    score: allIrrelevant ? 1 : 0,
    reason: allIrrelevant
      ? "All messages correctly marked as irrelevant"
      : `Expected all messages to be irrelevant, but some have isRelevant=true`,
  };
}

/**
 * Asserts that filter-split output marks at least one message as relevant.
 */
export function assertRelevant(
  output: string,
  _context: AssertionValueFunctionContext,
): GradingResult {
  const parsed = parseOutput(output);
  if (!parsed.success) return parsed.result;

  const arr = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
  const hasRelevant = arr.some(
    (item: Record<string, unknown>) => item.isRelevant === true,
  );

  return {
    pass: hasRelevant,
    score: hasRelevant ? 1 : 0,
    reason: hasRelevant
      ? "At least one message correctly marked as relevant"
      : "Expected at least one relevant message, but all were irrelevant",
  };
}

/**
 * Asserts that filter-split produces exactly N messages (for split-count validation).
 * Usage in YAML: config.value should be the expected count, e.g., 2
 */
export function assertMessageCount(
  output: string,
  context: AssertionValueFunctionContext,
): GradingResult {
  const parsed = parseOutput(output);
  if (!parsed.success) return parsed.result;

  const expected = Number(context.config?.value ?? 1);
  const arr = Array.isArray(parsed.data) ? parsed.data : [parsed.data];

  return {
    pass: arr.length === expected,
    score: arr.length === expected ? 1 : 0,
    reason:
      arr.length === expected
        ? `Correct message count: ${expected}`
        : `Expected ${expected} messages, got ${arr.length}`,
  };
}

/**
 * Asserts that categorize output contains at least one of the expected categories.
 * Usage in YAML: config.value should be a comma-separated list, e.g., "water,construction-and-repairs"
 */
export function assertContainsCategory(
  output: string,
  context: AssertionValueFunctionContext,
): GradingResult {
  const parsed = parseOutput(output);
  if (!parsed.success) return parsed.result;

  const data = toRecord(parsed.data);
  const categories = Array.isArray(data.categories) ? data.categories : [];
  const expectedStr = String(context.config?.value ?? "");
  const expected = expectedStr.split(",").map((s) => s.trim());

  const hasMatch = expected.some((cat) => categories.includes(cat));

  return {
    pass: hasMatch,
    score: hasMatch ? 1 : 0,
    reason: hasMatch
      ? `Found expected category in [${categories.join(", ")}]`
      : `Expected one of [${expected.join(", ")}] but got [${categories.join(", ")}]`,
  };
}

/**
 * Asserts that extract-locations output contains at least one location reference
 * (pin, street, cadastral property, or bus stop).
 */
export function assertHasLocations(
  output: string,
  _context: AssertionValueFunctionContext,
): GradingResult {
  const parsed = parseOutput(output);
  if (!parsed.success) return parsed.result;

  const data = toRecord(parsed.data);

  const totalLocations =
    (Array.isArray(data.pins) ? data.pins.length : 0) +
    (Array.isArray(data.streets) ? data.streets.length : 0) +
    (Array.isArray(data.cadastralProperties) ? data.cadastralProperties.length : 0) +
    (Array.isArray(data.busStops) ? data.busStops.length : 0);

  return {
    pass: totalLocations > 0,
    score: totalLocations > 0 ? 1 : 0,
    reason:
      totalLocations > 0
        ? `Found ${totalLocations} location(s)`
        : "No locations extracted (expected at least one pin, street, cadastral property, or bus stop)",
  };
}

/**
 * Asserts that extract-locations output has withSpecificAddress set correctly.
 * Usage in YAML: config.value should be "true" or "false"
 */
export function assertWithSpecificAddress(
  output: string,
  context: AssertionValueFunctionContext,
): GradingResult {
  const parsed = parseOutput(output);
  if (!parsed.success) return parsed.result;

  const data = toRecord(parsed.data);
  const expected = String(context.config?.value) === "true";
  const actual = typeof data.withSpecificAddress === "boolean" ? data.withSpecificAddress : false;

  return {
    pass: actual === expected,
    score: actual === expected ? 1 : 0,
    reason:
      actual === expected
        ? `withSpecificAddress correctly set to ${expected}`
        : `Expected withSpecificAddress=${expected}, got ${actual}`,
  };
}

/**
 * Asserts that filter-split output contains no links in plainText or markdownText.
 * Checks bare URLs (https://..., http://...), www.-style domains, autolinks (<https://...>),
 * Markdown inline links ([text](url)), and Markdown reference-style links ([text][id] / [id]: url).
 */
export function assertNoLinks(
  output: string,
  _context: AssertionValueFunctionContext,
): GradingResult {
  const parsed = parseOutput(output);
  if (!parsed.success) return parsed.result;

  const items = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
  const urlPattern =
    /https?:\/\/[^\s)<>\]]+|www\.[^\s)<>\]]+|<https?:\/\/[^>\s]+>|\[[^\]]+\]\([^)]+\)|\[[^\]]+\]\s*\[[^\]]*\]|\[[^\]]+\]:\s*https?:\/\/\S+/im;

  if (items.some((item) => typeof item !== "object" || item === null)) {
    return {
      pass: false,
      score: 0,
      reason:
        "Output is malformed: expected an array of objects with plainText/markdownText fields",
    };
  }

  const violations: string[] = [];
  for (const item of items.filter(isRecord)) {
    for (const field of ["plainText", "markdownText"] as const) {
      const value = item[field];
      if (typeof value !== "string") {
        return {
          pass: false,
          score: 0,
          reason: `Output is malformed: expected ${field} to be a string on every item`,
        };
      }
      const text = value;
      if (urlPattern.test(text)) {
        violations.push(`${field} contains a link`);
      }
    }
  }

  const pass = violations.length === 0;
  return {
    pass,
    score: pass ? 1 : 0,
    reason: pass
      ? "No links found in plainText or markdownText"
      : `Links found in output: ${violations.join("; ")}`,
  };
}

/**
 * Asserts that filter-split output marks at least one message as unreadable.
 */
export function assertUnreadable(
  output: string,
  _context: AssertionValueFunctionContext,
): GradingResult {
  const parsed = parseOutput(output);
  if (!parsed.success) return parsed.result;

  const arr = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
  const hasUnreadable = arr.some(
    (item: Record<string, unknown>) => item.isUnreadable === true,
  );

  return {
    pass: hasUnreadable,
    score: hasUnreadable ? 1 : 0,
    reason: hasUnreadable
      ? "At least one message correctly marked as unreadable"
      : "Expected at least one message with isUnreadable=true, but none found",
  };
}

/**
 * Asserts that filter-split output does NOT mark any message as unreadable.
 */
export function assertNotUnreadable(
  output: string,
  _context: AssertionValueFunctionContext,
): GradingResult {
  const parsed = parseOutput(output);
  if (!parsed.success) return parsed.result;

  const arr = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
  const hasUnreadable = arr.some(
    (item: Record<string, unknown>) => item.isUnreadable === true,
  );

  return {
    pass: !hasUnreadable,
    score: !hasUnreadable ? 1 : 0,
    reason: !hasUnreadable
      ? "No message incorrectly marked as unreadable"
      : "Expected no unreadable messages, but at least one has isUnreadable=true",
  };
}

// ─── Verify Event Match Assertions ────────────────────────────────

/**
 * Validates that the output is valid JSON parseable by VerifyEventMatchResponseSchema.
 */
export async function validateVerifyEventMatchSchema(
  output: string,
  _context: AssertionValueFunctionContext,
): Promise<GradingResult> {
  const { VerifyEventMatchResponseSchema } =
    await import("../lib/verify-event-match.schema");
  return validateWithSchema(
    output,
    VerifyEventMatchResponseSchema,
    "VerifyEventMatch",
  );
}

/**
 * Asserts that the LLM judged the two texts as the same event.
 */
export function assertIsSameEvent(
  output: string,
  _context: AssertionValueFunctionContext,
): GradingResult {
  const parsed = parseOutput(output);
  if (!parsed.success) return parsed.result;

  const data = toRecord(parsed.data);

  return {
    pass: data.isSameEvent === true,
    score: data.isSameEvent === true ? 1 : 0,
    reason:
      data.isSameEvent === true
        ? "Correctly identified as the same event"
        : "Expected isSameEvent=true, but got false",
  };
}

/**
 * Asserts that the LLM judged the two texts as different events.
 */
export function assertIsDifferentEvent(
  output: string,
  _context: AssertionValueFunctionContext,
): GradingResult {
  const parsed = parseOutput(output);
  if (!parsed.success) return parsed.result;

  const data = toRecord(parsed.data);

  return {
    pass: data.isSameEvent === false,
    score: data.isSameEvent === false ? 1 : 0,
    reason:
      data.isSameEvent === false
        ? "Correctly identified as different events"
        : "Expected isSameEvent=false, but got true",
  };
}

/**
 * Asserts that extract-locations output contains at least N pins.
 * Usage in YAML: config.value should be the minimum number of pins expected.
 */
export function assertMinPinCount(
  output: string,
  context: AssertionValueFunctionContext,
): GradingResult {
  const parsed = parseOutput(output);
  if (!parsed.success) return parsed.result;

  const data = toRecord(parsed.data);
  let expected = Number(context.config?.value ?? 1);
  if (Number.isNaN(expected) || expected < 0) {
    expected = 1;
  }
  const actual = Array.isArray(data.pins) ? data.pins.length : 0;

  return {
    pass: actual >= expected,
    score: actual >= expected ? 1 : 0,
    reason:
      actual >= expected
        ? `Found ${actual} pin(s) (expected at least ${expected})`
        : `Expected at least ${expected} pin(s), got ${actual}`,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function parseOutput(
  raw: string,
):
  | { success: true; data: unknown }
  | { success: false; result: GradingResult } {
  try {
    const data = JSON.parse(raw);
    return { success: true, data };
  } catch {
    return {
      success: false,
      result: {
        pass: false,
        score: 0,
        reason: `Output is not valid JSON: ${raw.slice(0, 200)}`,
      },
    };
  }
}

async function validateWithSchema(
  raw: string,
  schema: {
    safeParse: (data: unknown) => {
      success: boolean;
      error?: { message: string };
    };
  },
  name: string,
): Promise<GradingResult> {
  const parsed = parseOutput(raw);
  if (!parsed.success) return parsed.result;

  const result = schema.safeParse(parsed.data);

  return {
    pass: result.success,
    score: result.success ? 1 : 0,
    reason: result.success
      ? `${name} schema validation passed`
      : `${name} schema validation failed: ${result.error?.message ?? "unknown error"}`,
  };
}
