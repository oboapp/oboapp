import {
  Address,
  ExtractedLocations,
  GeoJsonFeatureCollection,
  InternalMessage,
  Coordinates,
  QualitySignals,
} from "@oboapp/shared";
import type { FilteredMessage } from "@/lib/filter-split.schema";
import type { CadastralGeometry } from "@/geocoding/cadastre/service";
import {
  createIngestErrorCollector,
  buildIngestErrorsField,
  formatIngestErrorText,
  type IngestErrorCollector,
  type IngestErrorRecorder,
} from "@/lib/ingest-errors";
import { storeIncomingMessage, updateMessage } from "./db";
import { encodeDocumentId } from "../crawlers/shared/firestore";
import {
  createGeocodingProgressTracker,
  type GeocodingProgressTracker,
} from "./geocoding-progress-tracker";
import { logger } from "@/lib/logger";
import { getLocality } from "@/lib/target-locality";
import { getSourceTrust } from "@/lib/source-trust";
import { gradePrecomputed } from "@/geocoding/shared/quality";
import {
  getString,
  getOptionalString,
  getNumber,
  getNumberArray,
  getStringOrDateOrNull,
} from "@/lib/record-fields";
import { validateTimespanRange } from "@/lib/timespan-utils";

export {
  geocodeAddressesFromExtractedData,
  type GeocodingResult,
} from "./geocode-addresses";
export { convertMessageGeocodingToGeoJson } from "./convert-to-geojson";
export { filterOutlierCoordinates } from "./filter-outliers";
export { verifyAuthToken, validateMessageText } from "./helpers";
import { buildMessageResponse } from "./build-response";
export { buildMessageResponse };
import { EDUCATIONAL_FACILITY_PREFIX } from "@/lib/constants";

export interface MessageIngestOptions {
  /**
   * Provide ready GeoJSON geometry to skip AI extraction + geocoding.
   * Used by crawlers or integrations with pre-geocoded data.
   */
  precomputedGeoJson?: GeoJsonFeatureCollection | null;
  /**
   * Optional source URL for the message (e.g., original article URL).
   * Used as the user-facing link in message detail view.
   */
  sourceUrl?: string;
  /**
   * Optional source document ID for deduplication.
   * When provided, used directly instead of deriving from sourceUrl.
   */
  sourceDocumentId?: string;
  /**
   * Optional boundary filtering - if provided, only features within boundaries are kept
   * If no features are within boundaries, the message is not stored
   */
  boundaryFilter?: GeoJsonFeatureCollection;
  /**
   * Optional crawledAt timestamp from the source document
   */
  crawledAt?: Date;
  /**
   * Optional publication date from the source document (ISO 8601 string).
   * When valid, preferred over crawledAt as the temporal anchor for LLM reasoning
   * and as the fallback date for timespan validation. Relevant for batch crawlers
   * where crawledAt can be days after the source was written.
   */
  datePublished?: string;
  /**
   * Optional markdown-formatted text for display (when crawler produces markdown)
   */
  markdownText?: string;
  /**
   * Optional timespan start from source (for precomputed GeoJSON crawlers)
   */
  timespanStart?: Date;
  /**
   * Optional timespan end from source (for precomputed GeoJSON crawlers)
   */
  timespanEnd?: Date;
  /**
   * Categories for sources with precomputed GeoJSON (for Firestore indexing)
   */
  categories?: string[];
  /**
   * Whether the source is relevant (for precomputed GeoJSON sources)
   */
  isRelevant?: boolean;
  /**
   * Whether the message applies to the entire locality (for locality-wide sources like weather warnings)
   * Locality-wide messages are hidden from the map but shown in listings
   */
  cityWide?: boolean;
  /**
   * Locality identifier (e.g., 'bg.sofia')
   * Required for all messages
   */
  locality: string;
}

export interface MessageIngestResult {
  messages: InternalMessage[];
  totalCategorized: number;
  totalRelevant: number;
  totalIrrelevant: number;
}

/**
 * Execute the full message ingest pipeline
 * @param text - The message text to process
 * @param source - The source identifier (sourceType, e.g. 'sofia-bg', 'toplo-bg')
 * @returns Array of processed messages with geocoding and GeoJSON data
 */
export async function messageIngest(
  text: string,
  source: string,
  options: MessageIngestOptions,
): Promise<MessageIngestResult> {
  const hasPrecomputedGeoJson = Boolean(options.precomputedGeoJson);
  let sourceDocumentId: string | undefined;

  // Use explicitly provided sourceDocumentId, or derive from sourceUrl
  if (options.sourceDocumentId) {
    sourceDocumentId = options.sourceDocumentId;
  } else if (options.sourceUrl) {
    sourceDocumentId = encodeDocumentId(options.sourceUrl);
  }

  // For messages with precomputed GeoJSON, create single message without AI pipeline
  if (hasPrecomputedGeoJson) {
    return await processPrecomputedGeoJsonMessage(
      text,
      source,
      sourceDocumentId,
      options,
    );
  }

  // Use 3-step AI pipeline for messages without precomputed GeoJSON
  return await processWithAIPipeline(text, source, sourceDocumentId, options);
}

/**
 * Process a single message through the geocoding pipeline (after AI steps are complete)
 */
async function processSingleMessage(
  messageId: string,
  text: string,
  precomputedGeoJson: GeoJsonFeatureCollection | null,
  aiProcessed: boolean,
  options: MessageIngestOptions,
  extractedLocations: ExtractedLocations | null,
  ingestErrors: IngestErrorCollector,
): Promise<InternalMessage> {
  const crawledAt = ensureCrawledAtDate(options.crawledAt);
  const referenceDate = resolveReferenceDate(options.datePublished, crawledAt);

  // Early exit: No extracted locations and no precomputed GeoJSON
  if (!precomputedGeoJson && !extractedLocations) {
    return await finalizeFailedMessage(
      messageId,
      text,
      options.locality,
      ingestErrors,
    );
  }

  let addresses: Address[] = [];
  let geoJson: GeoJsonFeatureCollection | null = precomputedGeoJson;

  // Handle precomputed GeoJSON path
  if (precomputedGeoJson) {
    addresses = await handlePrecomputedGeoJsonData(
      messageId,
      precomputedGeoJson,
      // markdownText is guaranteed non-empty by processPrecomputedGeoJsonMessage
      options.markdownText!,
      options.timespanStart,
      options.timespanEnd,
      referenceDate,
    );
  }

  // Handle extracted locations path (geocoding required)
  if (extractedLocations) {
    const geocodingResult = await performGeocodingWithErrorHandling(
      messageId,
      extractedLocations,
      ingestErrors,
    );

    // Early exit: Geocoding failed
    if (!geocodingResult) {
      return await buildMessageResponse(
        messageId,
        text,
        options.locality,
        addresses,
        null,
        aiProcessed,
      );
    }

    addresses = geocodingResult.addresses;
    geoJson = geocodingResult.geoJson;
  }

  try {
    geoJson = await applyBoundaryFilteringIfNeeded(
      messageId,
      geoJson,
      options.boundaryFilter,
    );
  } catch (error) {
    if (!(error instanceof BoundaryFilterRejectedError)) {
      // Unexpected runtime error (e.g. import failure, bug inside filterFeaturesByBoundaries).
      // Rethrow so the caller can handle it — do NOT silently delete the document.
      throw error;
    }
    // Boundary filtering rejected this message — delete the unfinalized document
    // to honor the boundaryFilter contract ("message is not stored").
    logger.info("Message excluded by boundary filter, deleting document", {
      messageId,
      error,
    });
    const { getDb } = await import("@/lib/db");
    const db = await getDb();
    await db.messages.deleteOne(messageId);
    return await buildMessageResponse(
      messageId,
      text,
      options.locality,
      addresses,
      null,
      aiProcessed,
    );
  }

  await finalizeMessageWithResults(messageId, geoJson, ingestErrors);

  // Event matching: group this message into an event (create or attach)
  // Trigger for messages with geoJson OR city-wide messages (which may have no geometry)
  if (geoJson || options.cityWide || extractedLocations?.cityWide) {
    await runEventMatching(messageId, ingestErrors);
  }

  return await buildMessageResponse(
    messageId,
    text,
    options.locality,
    addresses,
    geoJson,
    aiProcessed,
  );
}

/**
 * Handle messages that come with precomputed GeoJSON (skip AI pipeline)
 */
async function processPrecomputedGeoJsonMessage(
  text: string,
  source: string,
  sourceDocumentId: string | undefined,
  options: MessageIngestOptions,
): Promise<MessageIngestResult> {
  if (!options.markdownText?.trim()) {
    throw new Error(
      `Precomputed GeoJSON crawler for source '${source}' must provide a non-empty markdownText`,
    );
  }

  const storedMessageId = await storeIncomingMessage(
    text,
    options.locality,
    source,
    options.sourceUrl,
    options.crawledAt,
    sourceDocumentId,
  );

  // Store categories and isRelevant for precomputed GeoJSON sources (for Firestore indexes)
  if (options.categories && options.isRelevant !== undefined) {
    await updateMessage(storedMessageId, {
      categories: options.categories,
      isRelevant: options.isRelevant,
      ...(options.cityWide !== undefined && { cityWide: options.cityWide }),
    });
  }

  const precomputedIngestErrors = createIngestErrorCollector();

  await storeEmbeddingForMessage(
    storedMessageId,
    text,
    source,
    precomputedIngestErrors,
  );

  // Annotate each precomputed feature with geometryQuality derived from source trust
  const { trust } = getSourceTrust(source);
  const precomputedQuality = gradePrecomputed(trust);
  const annotatedGeoJson = options.precomputedGeoJson
    ? {
        ...options.precomputedGeoJson,
        features: options.precomputedGeoJson.features.map((f) => ({
          ...f,
          properties: {
            ...f.properties,
            geometryQuality:
              f.properties?.geometryQuality ??
              precomputedQuality.geometryQuality,
            qualityProvider:
              f.properties?.qualityProvider ?? precomputedQuality.provider,
          },
        })),
      }
    : options.precomputedGeoJson;

  const message = await processSingleMessage(
    storedMessageId,
    text,
    annotatedGeoJson || null,
    false,
    options,
    null,
    precomputedIngestErrors,
  );

  return {
    messages: [message],
    totalCategorized: 1,
    totalRelevant: 1,
    totalIrrelevant: 0,
  };
}

/**
 * 3-step AI pipeline: Filter & Split -> Categorize -> Extract Locations
 */
async function processWithAIPipeline(
  text: string,
  source: string,
  sourceDocumentId: string | undefined,
  options: MessageIngestOptions,
): Promise<MessageIngestResult> {
  // Import all AI service functions once before the loop
  const { filterAndSplit, categorize, extractLocations, summarize } =
    await import("../lib/ai-service");

  const crawledAt = ensureCrawledAtDate(options.crawledAt);
  const referenceDate = resolveReferenceDate(options.datePublished, crawledAt);
  const promptCtx = {
    currentDate: referenceDate,
    sourceType: source,
    sourceUrl: options.sourceUrl,
  };

  // Step 1: Filter & Split
  const filterResult = await filterAndSplit(text, undefined, promptCtx);

  if (!filterResult || filterResult.length === 0) {
    logger.error("Failed to filter & split message");
    throw new Error("Message filter & split failed");
  }

  logger.info("Filter & split complete", { count: filterResult.length });

  const messages: InternalMessage[] = [];
  let totalRelevant = 0;
  let totalIrrelevant = 0;

  for (let i = 0; i < filterResult.length; i++) {
    const filteredMessage = filterResult[i];
    const messageIndex = i + 1;

    // Use plainText from the split (per-message text)
    // Fall back to full source text only if empty (backwards compatibility)
    const messageText = filteredMessage.plainText || text;

    // Store incoming message
    const storedMessageId = await storeIncomingMessage(
      messageText,
      options.locality,
      source,
      options.sourceUrl,
      options.crawledAt,
      sourceDocumentId,
    );

    // Store filter & split result
    await storeFilteredMessage(storedMessageId, filteredMessage);

    logFilteredMessageInfo(
      filteredMessage,
      messageIndex,
      filterResult.length,
      storedMessageId,
    );

    const ingestErrors = createIngestErrorCollector();

    if (!filteredMessage.isRelevant) {
      totalIrrelevant++;
      // Use plainText for irrelevant messages, fall back to full text
      const irrelevantMessageText = filteredMessage.plainText || text;
      const message = await handleIrrelevantMessage(
        storedMessageId,
        irrelevantMessageText,
        options.locality,
        ingestErrors,
      );
      messages.push(message);
      continue;
    }

    totalRelevant++;

    // Guard: If AI says relevant but returns empty plainText, treat as error
    // This prevents downstream issues where categorize(), extractLocations(),
    // and processSingleMessage() would receive empty strings while the stored
    // message uses the fallback (messageText = filteredMessage.plainText || text).
    // Empty plainText with isRelevant=true is an AI inconsistency that should be flagged.
    if (!filteredMessage.plainText || filteredMessage.plainText.trim() === "") {
      ingestErrors.error(
        "Filter returned isRelevant=true but empty plainText (AI inconsistency)",
      );
      const message = await finalizeFailedMessage(
        storedMessageId,
        messageText,
        options.locality,
        ingestErrors,
      );
      messages.push(message);
      continue;
    }

    await storeEmbeddingForMessage(
      storedMessageId,
      filteredMessage.plainText,
      source,
      ingestErrors,
    );

    // Generate summary for long messages (non-fatal)
    await storeSummary(
      storedMessageId,
      filteredMessage.plainText,
      ingestErrors,
      (text, errors) => summarize(text, errors, promptCtx),
    );

    // Step 2: Categorize (using plainText which is now guaranteed non-empty)
    const categorizationResult = await categorize(
      filteredMessage.plainText,
      ingestErrors,
      promptCtx,
    );

    // Early exit: Categorization failed (API error or parse failure)
    if (!categorizationResult) {
      ingestErrors.error(
        "Categorization failed (API error or parse failure), finalizing without extraction",
      );
      logger.error("Categorization failed, skipping location extraction", {
        messageId: storedMessageId,
      });
      const message = await finalizeFailedMessage(
        storedMessageId,
        messageText,
        options.locality,
        ingestErrors,
      );
      messages.push(message);
      continue;
    }

    await storeCategorization(storedMessageId, categorizationResult);

    // Early exit: Zero categories -> finalize immediately
    if (categorizationResult.categories.length === 0) {
      logger.info("Message has zero categories, finalizing");
      await updateMessage(storedMessageId, {
        finalizedAt: new Date(),
        ...buildIngestErrorsField(ingestErrors),
      });
      const message = await buildMessageResponse(
        storedMessageId,
        messageText,
        options.locality,
        [],
        null,
        true,
      );
      messages.push(message);
      continue;
    }

    // Step 3: Extract Locations
    const extractedLocations = await extractLocations(
      filteredMessage.plainText,
      ingestErrors,
      promptCtx,
    );

    // If extraction failed, finalize without GeoJSON
    if (!extractedLocations) {
      logger.info("Location extraction failed, finalizing without GeoJSON");
      await updateMessage(storedMessageId, {
        finalizedAt: new Date(),
        ...buildIngestErrorsField(ingestErrors),
      });
      const message = await buildMessageResponse(
        storedMessageId,
        messageText,
        options.locality,
        [],
        null,
        true,
      );
      messages.push(message);
      continue;
    }

    await storeExtractedLocations(
      storedMessageId,
      extractedLocations,
      referenceDate,
    );

    // Pre-geocode matching: try to reuse geometry from an existing high-quality event
    const preGeocodeResult = await tryPreGeocodeMatch(
      storedMessageId,
      filteredMessage.plainText,
      options,
      extractedLocations,
      categorizationResult.categories,
      ingestErrors,
    );
    if (preGeocodeResult) {
      messages.push(preGeocodeResult);
      continue;
    }

    // Continue through geocoding pipeline
    const message = await processSingleMessage(
      storedMessageId,
      filteredMessage.plainText,
      null,
      true,
      options,
      extractedLocations,
      ingestErrors,
    );
    messages.push(message);
  }

  return {
    messages,
    totalCategorized: filterResult.length,
    totalRelevant,
    totalIrrelevant,
  };
}

/**
 * Log information about a filtered message being processed
 */
function logFilteredMessageInfo(
  filteredMessage: FilteredMessage,
  messageIndex: number,
  totalMessages: number,
  messageId: string | undefined,
): void {
  logger.info(`Processing message ${messageIndex}/${totalMessages}`, {
    isRelevant: filteredMessage.isRelevant,
    isInformative: filteredMessage.isInformative,
    isOneOfMany: filteredMessage.isOneOfMany,
    messageId: messageId || "auto-generated",
    responsibleEntity: filteredMessage.responsibleEntity || "",
  });
}

/**
 * Create minimal audit record for filter & split step
 */
function createFilterSplitAudit(filteredMessage: FilteredMessage) {
  return {
    step: "filterAndSplit",
    timestamp: new Date().toISOString(),
    summary: {
      isRelevant: filteredMessage.isRelevant,
      isOneOfMany: filteredMessage.isOneOfMany,
      responsibleEntity: filteredMessage.responsibleEntity || "(none)",
      textLength: filteredMessage.plainText.length,
    },
  };
}

/**
 * Create minimal audit record for categorization step
 */
function createCategorizationAudit(categories: string[]) {
  return {
    step: "categorize",
    timestamp: new Date().toISOString(),
    summary: {
      categoriesCount: categories.length,
      categories: categories,
    },
  };
}

/**
 * Create minimal audit record for location extraction step
 */
function createLocationExtractionAudit(
  extractedLocations: ExtractedLocations | null,
) {
  if (!extractedLocations) {
    return {
      step: "extractLocations",
      timestamp: new Date().toISOString(),
      summary: { success: false },
    };
  }

  return {
    step: "extractLocations",
    timestamp: new Date().toISOString(),
    summary: {
      success: true,
      pinsCount: extractedLocations.pins?.length || 0,
      streetsCount: extractedLocations.streets?.length || 0,
      cadastralCount: extractedLocations.cadastralProperties?.length || 0,
      busStopsCount: extractedLocations.busStops?.length || 0,
      educationalFacilitiesCount:
        extractedLocations.educationalFacilities?.length || 0,
      cityWide: extractedLocations.cityWide || false,
    },
  };
}

/**
 * Create minimal audit record for summarization step
 */
function createSummarizationAudit(
  success: boolean,
  charCount?: number,
  reason?: string,
) {
  return {
    step: "summarize",
    timestamp: new Date().toISOString(),
    summary: success
      ? { success: true, charCount }
      : { success: false, reason: reason || "unknown" },
  };
}

/**
 * Store filter & split result (Step 1)
 */
async function storeFilteredMessage(
  messageId: string,
  filteredMessage: FilteredMessage,
): Promise<void> {
  await updateMessage(messageId, {
    aiProcessed: true,
    plainText: filteredMessage.plainText,
    isRelevant: filteredMessage.isRelevant,
    isUnreadable: filteredMessage.isUnreadable,
    markdownText: filteredMessage.markdownText,
    responsibleEntity: filteredMessage.responsibleEntity,
    isOneOfMany: filteredMessage.isOneOfMany,
    isInformative: filteredMessage.isInformative,
    process: [createFilterSplitAudit(filteredMessage)],
  });
}

/**
 * Store categorization result (Step 2)
 */
async function storeCategorization(
  messageId: string,
  categorizationResult: { categories: string[] },
): Promise<void> {
  await updateMessage(messageId, {
    $set: {
      categories: categorizationResult.categories,
    },
    $addToSet: {
      process: createCategorizationAudit(categorizationResult.categories),
    },
  });
}

/**
 * Store extracted locations result (Step 3)
 * Denormalizes location fields to root level for Firestore queries
 */
async function storeExtractedLocations(
  messageId: string,
  extractedLocations: ExtractedLocations | null,
  referenceDate: Date,
): Promise<void> {
  const { extractTimespanRangeFromExtractedLocations, validateAndFallback } =
    await import("@/lib/timespan-utils");

  const pins = extractedLocations?.pins || [];
  const streets = extractedLocations?.streets || [];
  const cadastralProperties = extractedLocations?.cadastralProperties || [];
  const busStops = extractedLocations?.busStops || [];
  const educationalFacilities = extractedLocations?.educationalFacilities || [];
  const cityWide = extractedLocations?.cityWide || false;

  // Extract timespans from extracted locations (pins/streets), preferring referenceDate
  // (datePublished when valid) over crawledAt as the fallback anchor.
  const { timespanStart, timespanEnd } =
    extractTimespanRangeFromExtractedLocations(
      extractedLocations,
      referenceDate,
    );

  // Validate and fallback to referenceDate if extracted timespans are out of range
  const validated = validateAndFallback(
    timespanStart,
    timespanEnd,
    referenceDate,
  );

  await updateMessage(messageId, {
    $set: {
      pins,
      streets,
      cadastralProperties,
      busStops,
      educationalFacilities,
      cityWide,
      timespanStart: validated.timespanStart,
      timespanEnd: validated.timespanEnd,
    },
    $addToSet: {
      process: createLocationExtractionAudit(extractedLocations),
    },
  });
}

/**
 * Generate and store a summary for a message.
 * Non-fatal: failures are logged but don't abort the pipeline.
 */
async function storeSummary(
  messageId: string,
  text: string,
  ingestErrors: IngestErrorCollector,
  summarizeService: (
    text: string,
    ingestErrors?: IngestErrorCollector,
  ) => Promise<{ summary: string } | null>,
): Promise<void> {
  try {
    const result = await summarizeService(text, ingestErrors);
    if (result) {
      await updateMessage(messageId, {
        $set: { summary: result.summary },
        $addToSet: {
          process: createSummarizationAudit(true, result.summary.length),
        },
      });
    }
    // null means skipped (text below threshold) — no audit entry needed
  } catch (error) {
    const errorMessage = formatIngestErrorText(error);
    ingestErrors.error(
      `Summarization failed for message ${messageId}: ${errorMessage}`,
    );
    await updateMessage(messageId, {
      $addToSet: {
        process: createSummarizationAudit(false, undefined, errorMessage),
      },
    }).catch(() => {
      // Best-effort — don't let audit storage failure mask the real error
    });
  }
}

/**
 * Handle messages that are filtered as irrelevant
 */
async function handleIrrelevantMessage(
  messageId: string,
  text: string,
  locality: string,
  ingestErrors: IngestErrorCollector,
): Promise<InternalMessage> {
  logger.info("Message filtered as irrelevant, marking as finalized");
  await updateMessage(messageId, {
    finalizedAt: new Date(),
    isRelevant: false,
    ...buildIngestErrorsField(ingestErrors),
  });

  return await buildMessageResponse(messageId, text, locality, [], null, true);
}

/**
 * Convert crawledAt to Date object, handling string/Date/undefined cases
 * Falls back to current date for invalid/missing values
 */
function ensureCrawledAtDate(crawledAt: Date | string | undefined): Date {
  if (crawledAt instanceof Date) {
    return crawledAt;
  }
  if (crawledAt) {
    const date = new Date(crawledAt);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }
  return new Date();
}

/**
 * Resolve the best temporal anchor date for LLM reasoning and timespan fallback.
 * Prefers datePublished (when the source was written) over crawledAt (when crawled).
 * Relevant for batch crawlers where crawledAt can be days after the article was published.
 */
function resolveReferenceDate(
  datePublished: string | undefined,
  crawledAt: Date,
): Date {
  if (datePublished) {
    const parsed = new Date(datePublished);
    if (!Number.isNaN(parsed.getTime()) && validateTimespanRange(parsed)) {
      return parsed;
    }
  }
  return crawledAt;
}

/**
 * Perform geocoding on extracted locations
 */
async function performGeocoding(
  extractedLocations: ExtractedLocations,
  ingestErrors?: IngestErrorRecorder,
  tracker?: GeocodingProgressTracker,
) {
  const { geocodeAddressesFromExtractedData } =
    await import("./geocode-addresses");
  return await geocodeAddressesFromExtractedData(
    extractedLocations,
    ingestErrors,
    tracker,
  );
}

/**
 * Perform geocoding with error handling for the main pipeline
 */
async function performGeocodingWithErrorHandling(
  messageId: string,
  extractedLocations: ExtractedLocations,
  ingestErrors: IngestErrorCollector,
): Promise<{
  addresses: Address[];
  geoJson: GeoJsonFeatureCollection | null;
} | null> {
  const totalLocations =
    (extractedLocations.pins?.length ?? 0) +
    (extractedLocations.streets?.length ?? 0) +
    (extractedLocations.cadastralProperties?.length ?? 0) +
    (extractedLocations.busStops?.length ?? 0) +
    (extractedLocations.educationalFacilities?.length ?? 0);
  const tracker = createGeocodingProgressTracker(messageId, totalLocations);
  let geocodingSucceeded = false;

  try {
    const geocodingResult = await performGeocoding(
      extractedLocations,
      ingestErrors,
      tracker,
    );
    const filteredAddresses = await filterAndStoreAddresses(
      messageId,
      geocodingResult.addresses,
      geocodingResult.preGeocodedMap,
    );

    // Identify geocoded bus stops for GeoJSON feature creation
    const geocodedBusStops =
      extractedLocations.busStops && extractedLocations.busStops.length > 0
        ? filteredAddresses.filter((addr) =>
            addr.originalText.startsWith("Спирка "),
          )
        : undefined;

    // Identify geocoded educational facilities for GeoJSON feature creation
    const geocodedEducationalFacilities =
      extractedLocations.educationalFacilities &&
      extractedLocations.educationalFacilities.length > 0
        ? filteredAddresses.filter((addr) =>
            addr.originalText.startsWith(EDUCATIONAL_FACILITY_PREFIX),
          )
        : undefined;

    const geoJson = await convertToGeoJson(
      extractedLocations,
      geocodingResult.preGeocodedMap,
      geocodingResult.qualityMap,
      geocodingResult.cadastralGeometries,
      geocodedBusStops,
      ingestErrors,
      geocodedEducationalFacilities,
    );

    geocodingSucceeded = true;
    return { addresses: filteredAddresses, geoJson };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    ingestErrors.exception(`Ingestion exception: ${errorMessage}`);
    await finalizeMessageWithoutGeoJson(messageId, ingestErrors);
    return null;
  } finally {
    try {
      if (geocodingSucceeded) {
        await tracker.finalize();
      } else {
        await tracker.flushPending();
      }
    } catch (finalizeError) {
      logger.warn(
        "Failed to finalize geocoding progress tracker — partial progress may be lost",
        {
          messageId,
          error:
            finalizeError instanceof Error
              ? finalizeError.message
              : String(finalizeError),
        },
      );
    }
  }
}

/**
 * Filter outliers and store valid addresses
 */
async function filterAndStoreAddresses(
  messageId: string,
  geocodedAddresses: Address[],
  preGeocodedMap: Map<string, Coordinates>,
): Promise<Address[]> {
  const { filterOutlierCoordinates } = await import("./filter-outliers");
  const addresses = filterOutlierCoordinates(geocodedAddresses);

  // Update preGeocodedMap to remove filtered outliers
  // Only delete entries that were explicitly removed by the outlier filter,
  // not entries absent due to deduplication (which happens before this step)
  const beforeFilterTexts = new Set(
    geocodedAddresses.map((a) => a.originalText),
  );
  const afterFilterTexts = new Set(addresses.map((a) => a.originalText));
  for (const [key] of preGeocodedMap) {
    if (beforeFilterTexts.has(key) && !afterFilterTexts.has(key)) {
      preGeocodedMap.delete(key);
    }
  }

  if (addresses.length > 0) {
    await updateMessage(messageId, { addresses });
  }

  return addresses;
}

/**
 * Convert geocoding results to GeoJSON format
 */
async function convertToGeoJson(
  extractedLocations: ExtractedLocations,
  preGeocodedMap: Map<string, Coordinates>,
  qualityMap: Map<string, QualitySignals>,
  cadastralGeometries: Map<string, CadastralGeometry> | undefined,
  geocodedBusStops?: Address[],
  ingestErrors?: IngestErrorRecorder,
  geocodedEducationalFacilities?: Address[],
): Promise<GeoJsonFeatureCollection | null> {
  const { convertMessageGeocodingToGeoJson } =
    await import("./convert-to-geojson");
  return await convertMessageGeocodingToGeoJson(
    extractedLocations,
    preGeocodedMap,
    qualityMap,
    cadastralGeometries,
    geocodedBusStops,
    ingestErrors,
    geocodedEducationalFacilities,
  );
}

/**
 * Finalize a message that failed extraction
 */
async function finalizeFailedMessage(
  messageId: string,
  text: string,
  locality: string,
  ingestErrors: IngestErrorCollector,
): Promise<InternalMessage> {
  ingestErrors.error(
    "Failed to extract data from message, marking as finalized",
  );
  await updateMessage(messageId, {
    finalizedAt: new Date(),
    ...buildIngestErrorsField(ingestErrors),
  });

  return await buildMessageResponse(messageId, text, locality, [], null, true);
}

function addCoordinatesFromGeometry(
  geometry: GeoJsonFeatureCollection["features"][number]["geometry"],
  addCoordinate: (coord: readonly number[]) => void,
  addCoordinates: (coords: readonly (readonly number[])[]) => void,
): void {
  switch (geometry.type) {
    case "Point": {
      addCoordinate(geometry.coordinates);
      break;
    }
    case "MultiPoint":
    case "LineString": {
      addCoordinates(geometry.coordinates);
      break;
    }
    case "Polygon": {
      const ring = geometry.coordinates[0];
      if (!ring || ring.length === 0) {
        break;
      }

      // Skip the closing vertex if it duplicates the first (standard GeoJSON rings are closed).
      const first = ring[0];
      const last = ring.at(-1);
      const isClosed =
        ring.length > 1 &&
        !!first &&
        !!last &&
        first[0] === last[0] &&
        first[1] === last[1];
      const vertices = isClosed ? ring.slice(0, -1) : ring;
      addCoordinates(vertices);
      break;
    }
  }
}

/**
 * Compute the centroid of all features in a GeoJSON FeatureCollection.
 * Returns an Address with the centroid coordinates, or null if it cannot be computed.
 * Uses coordinate averaging across all vertices — sufficient precision for map navigation.
 * For Polygon geometries, only the outer ring is used (holes/inner rings are excluded).
 * Exported for unit testing.
 */
export function computeGeoJsonCentroidAddress(
  geoJson: GeoJsonFeatureCollection,
): Address | null {
  const features = geoJson.features;
  if (!features || features.length === 0) return null;

  let totalLat = 0;
  let totalLng = 0;
  let count = 0;

  const addCoordinate = (coord: readonly number[]) => {
    if (coord.length < 2) return;
    totalLng += coord[0] ?? 0;
    totalLat += coord[1] ?? 0;
    count++;
  };

  const addCoordinates = (coords: readonly (readonly number[])[]) => {
    for (const coord of coords) {
      addCoordinate(coord);
    }
  };

  for (const feature of features) {
    const geom = feature.geometry;
    if (!geom) continue;
    addCoordinatesFromGeometry(geom, addCoordinate, addCoordinates);
  }

  if (count === 0) return null;

  const lat = totalLat / count;
  const lng = totalLng / count;

  return {
    originalText: "Местоположение",
    formattedAddress: "Местоположение",
    coordinates: { lat, lng },
  };
}

/**
 * Handle precomputed GeoJSON data storage
 */
async function handlePrecomputedGeoJsonData(
  messageId: string,
  precomputedGeoJson: GeoJsonFeatureCollection,
  markdownText: string,
  timespanStart: Date | undefined,
  timespanEnd: Date | undefined,
  fallbackDate: Date,
): Promise<Address[]> {
  const centroidAddress = computeGeoJsonCentroidAddress(precomputedGeoJson);
  const addresses = centroidAddress ? [centroidAddress] : [];
  const pins = centroidAddress
    ? [{ address: centroidAddress.originalText, timespans: [] }]
    : [];

  const { validateAndFallback } = await import("@/lib/timespan-utils");
  const validated = validateAndFallback(
    timespanStart,
    timespanEnd,
    fallbackDate,
  );

  const locationFields = {
    addresses,
    pins,
    streets: [],
    cadastralProperties: [],
  };

  await updateMessage(messageId, {
    markdownText,
    responsibleEntity: "",
    ...locationFields,
    timespanStart: validated.timespanStart,
    timespanEnd: validated.timespanEnd,
  });

  return addresses;
}

/**
 * Thrown when boundary filtering rejects a message (no features within boundaries).
 * Distinguished from unexpected runtime errors so callers can safely delete the document.
 */
class BoundaryFilterRejectedError extends Error {
  constructor(messageId: string) {
    super(`Message ${messageId} has no features within specified boundaries`);
    this.name = "BoundaryFilterRejectedError";
  }
}

/**
 * Apply boundary filtering to GeoJSON if boundary filter is provided
 */
async function applyBoundaryFilteringIfNeeded(
  messageId: string,
  geoJson: GeoJsonFeatureCollection | null,
  boundaryFilter: GeoJsonFeatureCollection | undefined,
): Promise<GeoJsonFeatureCollection | null> {
  if (!boundaryFilter || !geoJson) {
    return geoJson;
  }

  const { filterFeaturesByBoundaries } =
    await import("../geocoding/shared/boundary-utils");
  const filteredGeoJson = filterFeaturesByBoundaries(geoJson, boundaryFilter);

  if (!filteredGeoJson) {
    logger.info("Message has no features within boundaries, skipping storage", {
      messageId,
    });
    throw new BoundaryFilterRejectedError(messageId);
  }

  return filteredGeoJson;
}

/**
 * Finalize message by storing GeoJSON and setting finalized timestamp
 */
async function finalizeMessageWithResults(
  messageId: string,
  geoJson: GeoJsonFeatureCollection | null,
  ingestErrors: IngestErrorCollector,
): Promise<void> {
  if (!geoJson) {
    await finalizeMessageWithoutGeoJson(messageId, ingestErrors);
    return;
  }

  await updateMessage(messageId, {
    geoJson,
    finalizedAt: new Date(),
    ...buildIngestErrorsField(ingestErrors),
  });
}

async function finalizeMessageWithoutGeoJson(
  messageId: string,
  ingestErrors: IngestErrorCollector,
): Promise<void> {
  await updateMessage(messageId, {
    finalizedAt: new Date(),
    ...buildIngestErrorsField(ingestErrors),
  });
}

/**
 * Create minimal audit record for embedding generation step
 */
function createEmbeddingAudit(
  success: boolean,
  dimensions?: number,
  reason?: string,
) {
  return {
    step: "embedding",
    timestamp: new Date().toISOString(),
    summary: success
      ? { success: true, dimensions }
      : { success: false, reason: reason || "unknown" },
  };
}

/**
 * Generate and store a text embedding for a message.
 * Non-fatal: failures are logged but don't abort the pipeline.
 */
async function storeEmbeddingForMessage(
  messageId: string,
  text: string,
  source: string,
  ingestErrors: IngestErrorCollector,
): Promise<void> {
  try {
    const { generateEmbedding } = await import("@/lib/embeddings");
    const embedding = await generateEmbedding(text, { messageId, source });
    if (embedding) {
      await updateMessage(messageId, {
        $set: { embedding },
        $addToSet: {
          process: createEmbeddingAudit(true, embedding.length),
        },
      });
    } else {
      ingestErrors.warn(
        `Embedding generation returned null for message ${messageId} (source: ${source}, textLength: ${text.length})`,
      );
      await updateMessage(messageId, {
        $addToSet: {
          process: createEmbeddingAudit(false, undefined, "null result"),
        },
      });
    }
  } catch (error) {
    const errorMessage = formatIngestErrorText(error);
    ingestErrors.error(
      `Embedding generation failed for message ${messageId} (source: ${source}, textLength: ${text.length}): ${errorMessage}`,
    );
    await updateMessage(messageId, {
      $addToSet: {
        process: createEmbeddingAudit(false, undefined, errorMessage),
      },
    }).catch(() => {
      // Best-effort — don't let audit storage failure mask the real error
    });
  }
}

/**
 * Create minimal audit record for event matching step
 */
function createEventMatchingAudit(
  success: boolean,
  result?: {
    eventId: string;
    action: string;
    confidence: number;
    llmVerified?: boolean;
    candidateCount: number;
  },
  errorMessage?: string,
) {
  if (!success) {
    return {
      step: "eventMatching",
      timestamp: new Date().toISOString(),
      summary: { success: false, error: errorMessage || "unknown" },
    };
  }

  return {
    step: "eventMatching",
    timestamp: new Date().toISOString(),
    summary: {
      success: true,
      eventId: result!.eventId,
      action: result!.action,
      confidence: result!.confidence,
      llmVerified: result!.llmVerified ?? false,
      candidateCount: result!.candidateCount,
    },
  };
}

/**
 * Run event matching for a finalized message.
 * Reads the full message from DB, finds or creates an event, and stores the eventId cache.
 */
async function runEventMatching(
  messageId: string,
  ingestErrors: IngestErrorCollector,
): Promise<void> {
  try {
    const { getDb } = await import("@/lib/db");
    const { processEventMatching } = await import("@/event-matching");

    const db = await getDb();
    const message = await db.messages.findById(messageId);
    if (!message) return;

    const result = await processEventMatching(db, message);

    await updateMessage(messageId, {
      $set: { eventId: result.eventId },
      $addToSet: {
        process: createEventMatchingAudit(true, result),
      },
    });
  } catch (error) {
    const errorMessage = formatIngestErrorText(error);
    // Event matching failures should not break the ingest pipeline
    ingestErrors.error(
      `Event matching failed for message ${messageId}: ${errorMessage}`,
    );
    // Persist errors directly — finalizeMessageWithResults already ran
    await updateMessage(messageId, {
      $addToSet: {
        process: createEventMatchingAudit(false, undefined, errorMessage),
        ingestErrors: {
          text: `Event matching failed: ${errorMessage}`,
          type: "error" as const,
        },
      },
    }).catch(() => {
      // Best-effort — don't let audit storage failure mask the real error
    });
  }
}

/**
 * Try to match a message to an existing event before geocoding.
 * If a high-quality event is found, reuse its geometry, finalize, and attach.
 * Returns the message response if reuse succeeded, null otherwise.
 */
async function tryPreGeocodeMatch(
  messageId: string,
  messageText: string,
  options: MessageIngestOptions,
  extractedLocations: ExtractedLocations,
  categories: string[],
  ingestErrors: IngestErrorCollector,
): Promise<InternalMessage | null> {
  try {
    const { getDb } = await import("@/lib/db");
    const { preGeocodeMatch, attachMessageToEvent } =
      await import("@/event-matching");

    const db = await getDb();

    // Read message from DB to get timespans stored by storeExtractedLocations()
    const storedMessage = await db.messages.findById(messageId);
    if (!storedMessage) return null;

    const match = await preGeocodeMatch(db, {
      timespanStart: getStringOrDateOrNull(storedMessage.timespanStart),
      timespanEnd: getStringOrDateOrNull(storedMessage.timespanEnd),
      categories,
      cityWide: extractedLocations.cityWide,
      locality: options.locality || getLocality(),
      embedding: getNumberArray(storedMessage.embedding) ?? null,
    });

    if (!match) return null;

    const eventId = getString(match.event._id);
    const geoJson = match.geometry;

    logger.info("Pre-geocode match: reusing event geometry", {
      messageId,
      eventId,
      geometryQuality: getNumber(match.event.geometryQuality),
      score: match.score,
    });

    // Apply boundary filtering if needed
    const filteredGeoJson = await applyBoundaryFilteringIfNeeded(
      messageId,
      geoJson,
      options.boundaryFilter,
    );

    // Finalize with reused geometry
    await finalizeMessageWithResults(messageId, filteredGeoJson, ingestErrors);

    // Attach to the matched event
    await attachMessageToEvent(
      db,
      {
        _id: messageId,
        geoJson: filteredGeoJson,
        timespanStart: getStringOrDateOrNull(storedMessage.timespanStart),
        timespanEnd: getStringOrDateOrNull(storedMessage.timespanEnd),
        source: getOptionalString(storedMessage.source),
        categories,
        embedding: getNumberArray(storedMessage.embedding) ?? null,
      },
      match.event,
      match.score,
      match.signals,
    );

    await updateMessage(messageId, { eventId });

    return await buildMessageResponse(
      messageId,
      messageText,
      options.locality,
      [],
      filteredGeoJson,
      true,
    );
  } catch (error) {
    // Pre-geocode match failures should not break the pipeline — fall through to normal geocoding
    logger.error("Pre-geocode match aborted, proceeding with geocoding", {
      messageId,
      error,
    });
    return null;
  }
}
