import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { Message } from "@/lib/types";
import {
  clampBounds,
  addBuffer,
  featureIntersectsBounds,
  type ViewportBounds,
} from "@/lib/bounds-utils";
import { getCentroid } from "@/lib/geometry-utils";
import { messagesQuerySchema } from "@/lib/api-query.schema";
import { recordToMessage } from "@/lib/doc-to-message";

const DEFAULT_RELEVANCE_DAYS = 7;
const CLUSTER_ZOOM_THRESHOLD = 15;
const FIRESTORE_IN_OPERATOR_LIMIT = 10;

type DbClient = Awaited<ReturnType<typeof getDb>>;
type MessageRecord = Record<string, unknown>;

function sortMessagesByRelevance(messages: Message[]): Message[] {
  return [...messages].sort((a, b) => {
    const aFinalizedAt = a.finalizedAt ?? "";
    const bFinalizedAt = b.finalizedAt ?? "";
    if (aFinalizedAt !== bFinalizedAt) {
      return bFinalizedAt.localeCompare(aFinalizedAt);
    }

    const aEnd = a.timespanEnd ?? "";
    const bEnd = b.timespanEnd ?? "";
    return bEnd.localeCompare(aEnd);
  });
}

function isUncategorizedDoc(doc: MessageRecord): boolean {
  const categories = Array.isArray(doc.categories) ? doc.categories : undefined;
  return !categories || categories.length === 0;
}

function toViewportBounds(params: {
  north?: number;
  south?: number;
  east?: number;
  west?: number;
}): ViewportBounds | null {
  const { north, south, east, west } = params;
  if (
    north === undefined ||
    south === undefined ||
    east === undefined ||
    west === undefined
  ) {
    return null;
  }

  const rawBounds: ViewportBounds = { north, south, east, west };
  const clampedBounds = clampBounds(rawBounds);
  return addBuffer(clampedBounds, 0.2);
}

function getCutoffDate(override?: Date): Date {
  if (override) {
    return override;
  }

  const relevanceDays = process.env.MESSAGE_RELEVANCE_DAYS
    ? Number.parseInt(process.env.MESSAGE_RELEVANCE_DAYS, 10)
    : DEFAULT_RELEVANCE_DAYS;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - relevanceDays);
  return cutoffDate;
}

async function findRecentMessageDocs(
  db: DbClient,
  cutoffDate: Date,
): Promise<MessageRecord[]> {
  return db.messages.findMany({
    where: [{ field: "timespanEnd", op: ">=", value: cutoffDate }],
    orderBy: [{ field: "timespanEnd", direction: "desc" }],
  });
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

async function findRecentMessageDocsBySources(
  db: DbClient,
  cutoffDate: Date,
  sources: string[],
): Promise<MessageRecord[]> {
  if (sources.length === 0) {
    return [];
  }

  const sourceChunks = chunkArray(sources, FIRESTORE_IN_OPERATOR_LIMIT);
  const chunkQueries = sourceChunks.map((sourceChunk) =>
    db.messages.findMany({
      where: [
        { field: "source", op: "in", value: sourceChunk },
        { field: "timespanEnd", op: ">=", value: cutoffDate },
      ],
      orderBy: [{ field: "timespanEnd", direction: "desc" }],
    }),
  );

  const chunkResults = await Promise.all(chunkQueries);
  return chunkResults.flat();
}

async function findMessagesBySources(
  db: DbClient,
  cutoffDate: Date,
  sources: string[],
): Promise<Message[]> {
  const results = await findRecentMessageDocsBySources(db, cutoffDate, sources);
  const messagesMap = new Map<string, Message>();

  for (const doc of results) {
    const docId = typeof doc._id === "string" ? doc._id : "";
    if (docId && !messagesMap.has(docId)) {
      messagesMap.set(docId, recordToMessage(doc));
    }
  }

  return sortMessagesByRelevance(Array.from(messagesMap.values()));
}

function toSourceList(sourceSet?: Set<string>): string[] {
  return sourceSet ? Array.from(sourceSet) : [];
}

async function findUncategorizedDocs(
  db: DbClient,
  cutoffDate: Date,
  sourceSet?: Set<string>,
): Promise<MessageRecord[]> {
  const sourceList = toSourceList(sourceSet);
  const docs = sourceList.length
    ? await findRecentMessageDocsBySources(db, cutoffDate, sourceList)
    : await findRecentMessageDocs(db, cutoffDate);

  return docs.filter((doc) => isUncategorizedDoc(doc));
}

function dedupeAndMapMessages(docs: MessageRecord[]): Message[] {
  const messagesMap = new Map<string, Message>();

  for (const doc of docs) {
    const docId = typeof doc._id === "string" ? doc._id : "";
    if (docId && !messagesMap.has(docId)) {
      messagesMap.set(docId, recordToMessage(doc));
    }
  }

  return Array.from(messagesMap.values());
}

function applyOptionalSourceSet(
  docs: MessageRecord[],
  sourceSet?: Set<string>,
): MessageRecord[] {
  if (!sourceSet) {
    return docs;
  }

  return docs.filter(
    (doc) => typeof doc.source === "string" && sourceSet.has(doc.source),
  );
}

function isInvalidSourceForFilter(
  doc: MessageRecord,
  sourceSet?: Set<string>,
): boolean {
  if (!sourceSet) {
    return false;
  }

  return !doc.source || typeof doc.source !== "string" || !sourceSet.has(doc.source);
}

async function buildCategoryQueryPlans(
  db: DbClient,
  cutoffDate: Date,
  realCategories: string[],
  includeUncategorized: boolean,
  sourceSet?: Set<string>,
): Promise<Array<{ uncategorizedOnly: boolean; docs: MessageRecord[] }>> {
  const plans: Array<
    Promise<{ uncategorizedOnly: boolean; docs: MessageRecord[] }>
  > = [];

  if (realCategories.length > 0) {
    plans.push(
      db.messages
        .findMany({
          where: [
            {
              field: "categories",
              op: "array-contains-any",
              value: realCategories,
            },
            { field: "timespanEnd", op: ">=", value: cutoffDate },
          ],
          orderBy: [{ field: "timespanEnd", direction: "desc" }],
        })
        .then((docs) => ({ uncategorizedOnly: false, docs })),
    );
  }

  if (includeUncategorized) {
    plans.push(
      findUncategorizedDocs(db, cutoffDate, sourceSet).then((docs) => ({
        uncategorizedOnly: true,
        docs,
      })),
    );
  }

  return Promise.all(plans);
}

async function findMessagesByCategoryFilters(
  db: DbClient,
  cutoffDate: Date,
  selectedCategories: string[],
  sourceSet?: Set<string>,
): Promise<Message[]> {
  const realCategories = selectedCategories.filter(
    (c) => c !== "uncategorized",
  );
  const includeUncategorized = selectedCategories.includes("uncategorized");

  if (includeUncategorized && realCategories.length === 0) {
    const uncategorizedDocs = await findUncategorizedDocs(
      db,
      cutoffDate,
      sourceSet,
    );
    return dedupeAndMapMessages(uncategorizedDocs);
  }
  const queryPlans = await buildCategoryQueryPlans(
    db,
    cutoffDate,
    realCategories,
    includeUncategorized,
    sourceSet,
  );
  const messagesMap = new Map<string, Message>();

  for (const plan of queryPlans) {
    const docs = applyOptionalSourceSet(plan.docs, sourceSet);
    const { uncategorizedOnly } = plan;

    for (const doc of docs) {
      if (uncategorizedOnly && !isUncategorizedDoc(doc)) {
        continue;
      }

      if (isInvalidSourceForFilter(doc, sourceSet)) {
        continue;
      }

      const docId = typeof doc._id === "string" ? doc._id : "";
      if (docId && !messagesMap.has(docId)) {
        messagesMap.set(docId, recordToMessage(doc));
      }
    }
  }

  return sortMessagesByRelevance(Array.from(messagesMap.values()));
}

function filterMessagesByGeoAndViewport(
  messages: Message[],
  viewportBounds: ViewportBounds | null,
): Message[] {
  let filtered = messages.filter(
    (message) => message.geoJson !== null && message.geoJson !== undefined,
  );

  if (!viewportBounds) {
    return filtered;
  }

  filtered = filtered.filter((message) => {
    if (message.cityWide) return true;
    if (!message.geoJson?.features) return false;

    return message.geoJson.features.some((feature) =>
      featureIntersectsBounds(feature, viewportBounds),
    );
  });

  return filtered;
}

function simplifyMessagesForClusterZoom(
  messages: Message[],
  zoom?: number,
): Message[] {
  if (zoom === undefined || zoom >= CLUSTER_ZOOM_THRESHOLD) {
    return messages;
  }

  return messages.map((message) => {
    if (!message.geoJson?.features) return message;

    const simplifiedFeatures = message.geoJson.features.map((feature) => {
      if (
        feature.geometry.type === "LineString" ||
        feature.geometry.type === "Polygon"
      ) {
        const centroid = getCentroid(feature.geometry);
        if (!centroid) return feature;

        const simplifiedFeature: typeof feature = {
          ...feature,
          geometry: {
            type: "Point",
            coordinates: [centroid.lng, centroid.lat],
          },
          properties: {
            ...feature.properties,
            _originalGeometryType: feature.geometry.type,
          },
        };
        return simplifiedFeature;
      }

      return feature;
    });

    return {
      ...message,
      geoJson: {
        ...message.geoJson,
        features: simplifiedFeatures,
      },
    };
  });
}

async function validateSources(
  selectedSources?: string[],
): Promise<string[] | undefined> {
  if (!selectedSources || selectedSources.length === 0) {
    return undefined;
  }

  const { getCurrentLocalitySources } = await import("@/lib/source-utils");
  const localitySources = getCurrentLocalitySources();
  const validSourceIds = new Set(localitySources.map((s) => s.id));

  const uniqueSources = Array.from(new Set(selectedSources));
  return uniqueSources.filter((sourceId) => validSourceIds.has(sourceId));
}

export async function GET(request: Request) {
  try {
    const db = await getDb();
    // Validate query params
    const { searchParams } = new URL(request.url);
    const parsed = messagesQuerySchema.safeParse(
      Object.fromEntries(searchParams.entries()),
    );

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid query parameters", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const {
      north,
      south,
      east,
      west,
      zoom,
      categories: selectedCategories,
      sources: selectedSources,
      timespanEndGte,
    } = parsed.data;

    const viewportBounds = toViewportBounds({ north, south, east, west });
    const cutoffDate = getCutoffDate(timespanEndGte);

    // If categories param was provided but resulted in empty array, return empty result
    if (selectedCategories && selectedCategories.length === 0) {
      return NextResponse.json({ messages: [] });
    }

    const validatedSources = await validateSources(selectedSources);

    if (
      selectedSources &&
      selectedSources.length > 0 &&
      validatedSources?.length === 0
    ) {
      return NextResponse.json({ messages: [] });
    }

    let allMessages: Message[] = [];
    const hasSourceFilter = validatedSources && validatedSources.length > 0;
    const hasCategoryFilter =
      selectedCategories && selectedCategories.length > 0;

    if (hasCategoryFilter) {
      const sourceSet = hasSourceFilter ? new Set(validatedSources) : undefined;
      allMessages = await findMessagesByCategoryFilters(
        db,
        cutoffDate,
        selectedCategories,
        sourceSet,
      );
    } else if (hasSourceFilter) {
      allMessages = await findMessagesBySources(
        db,
        cutoffDate,
        validatedSources,
      );
    } else {
      const docs = await db.messages.findMany({
        where: [{ field: "timespanEnd", op: ">=", value: cutoffDate }],
        orderBy: [{ field: "timespanEnd", direction: "desc" }],
      });

      allMessages = docs.map(recordToMessage);
    }

    let messages = filterMessagesByGeoAndViewport(allMessages, viewportBounds);
    messages = simplifyMessagesForClusterZoom(messages, zoom);
    messages = sortMessagesByRelevance(messages);

    return NextResponse.json({ messages });
  } catch (error) {
    console.error("Error fetching messages:", error);
    return NextResponse.json(
      { error: "Failed to fetch messages" },
      { status: 500 },
    );
  }
}
