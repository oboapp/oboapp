import {
  FilterSplitResponseSchema,
  type FilterSplitResult,
} from "./filter-split.schema";
import {
  CategorizationResponseSchema,
  type CategorizationResult,
} from "./categorize.schema";
import {
  ExtractedLocationsSchema,
  type ExtractedLocations,
} from "./extract-locations.schema";
import {
  formatIngestErrorText,
  getIngestErrorRecorder,
  truncateIngestPayload,
  type IngestErrorRecorder,
} from "./ingest-errors";

const MAX_INGEST_ERROR_LENGTH = 1000;

/**
 * Parses and validates filter & split response from AI (Step 1)
 */
export function parseFilterSplitResponse(
  responseText: string,
  ingestErrors?: IngestErrorRecorder,
): FilterSplitResult | null {
  const recorder = getIngestErrorRecorder(ingestErrors);

  try {
    const parsed = JSON.parse(responseText);
    return FilterSplitResponseSchema.parse(parsed);
  } catch (parseError) {
    recorder.error(
      `Failed to parse filter & split response: ${formatIngestErrorText(parseError)}`,
    );
    const summary = truncateIngestPayload(
      responseText,
      MAX_INGEST_ERROR_LENGTH,
    );
    recorder.error(
      `Full AI response (${summary.originalLength} chars): ${summary.summary}`,
    );
    return null;
  }
}

/**
 * Parses and validates categorization response from AI (Step 2)
 */
export function parseCategorizeResponse(
  responseText: string,
  ingestErrors?: IngestErrorRecorder,
): CategorizationResult | null {
  const recorder = getIngestErrorRecorder(ingestErrors);

  try {
    const parsed = JSON.parse(responseText);
    return CategorizationResponseSchema.parse(parsed);
  } catch (parseError) {
    recorder.error(
      `Failed to parse categorize response: ${formatIngestErrorText(parseError)}`,
    );
    const summary = truncateIngestPayload(
      responseText,
      MAX_INGEST_ERROR_LENGTH,
    );
    recorder.error(
      `Full AI response (${summary.originalLength} chars): ${summary.summary}`,
    );
    return null;
  }
}

/**
 * Parses and validates extract locations response from AI (Step 3)
 */
export function parseExtractLocationsResponse(
  responseText: string,
  ingestErrors?: IngestErrorRecorder,
): ExtractedLocations | null {
  const recorder = getIngestErrorRecorder(ingestErrors);

  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText);
  } catch (parseError) {
    recorder.error(
      `Failed to parse extract locations response: ${formatIngestErrorText(parseError)}`,
    );
    const summary = truncateIngestPayload(
      responseText,
      MAX_INGEST_ERROR_LENGTH,
    );
    recorder.error(
      `Full AI response (${summary.originalLength} chars): ${summary.summary}`,
    );
    return null;
  }

  // Try full schema parse first
  const result = ExtractedLocationsSchema.safeParse(parsed);
  if (result.success) {
    return result.data;
  }

  // If root is not an object, cannot recover
  if (!parsed || typeof parsed !== "object") {
    recorder.error("Extract locations response is not an object");
    return null;
  }

  // Attempt to filter/validate arrays individually
  // Use correct item schema for each array
  const arrays = [
    {
      key: "pins",
      itemSchema: ExtractedLocationsSchema.shape.pins.removeDefault().element,
    },
    {
      key: "streets",
      itemSchema:
        ExtractedLocationsSchema.shape.streets.removeDefault().element,
    },
    {
      key: "cadastralProperties",
      itemSchema:
        ExtractedLocationsSchema.shape.cadastralProperties.removeDefault()
          .element,
    },
    {
      key: "busStops",
      itemSchema:
        ExtractedLocationsSchema.shape.busStops.removeDefault().element,
    },
  ];

  // Use Record<string, unknown> for filtered
  const parsedRecord: Record<string, unknown> = Object.fromEntries(
    Object.entries(parsed),
  );
  const filtered: Record<string, unknown> = { ...parsedRecord };
  for (const { key, itemSchema } of arrays) {
    const arr = parsedRecord[key];
    if (Array.isArray(arr)) {
      filtered[key] = arr.filter((item, idx) => {
        const itemResult = itemSchema.safeParse(item);
        if (!itemResult.success) {
          recorder.error(
            `Invalid ${key} item at index ${idx}: ${formatIngestErrorText(itemResult.error)}`,
          );
          return false;
        }
        return true;
      });
    }
  }

  // Try parsing again with filtered arrays
  const filteredResult = ExtractedLocationsSchema.safeParse(filtered);
  if (filteredResult.success) {
    recorder.error(
      "Partial extract locations result: some items were filtered due to schema errors",
    );
    return filteredResult.data;
  }
  recorder.error(
    `Failed to parse extract locations response after filtering: ${formatIngestErrorText(filteredResult.error)}`,
  );
  const summary = truncateIngestPayload(responseText, MAX_INGEST_ERROR_LENGTH);
  recorder.error(
    `Full AI response (${summary.originalLength} chars): ${summary.summary}`,
  );
  return null;
}
