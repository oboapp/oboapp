import { Hono } from "hono";
import { SOURCES } from "@oboapp/shared";
import { getDb } from "../../lib/db";
import type { OboDb } from "@oboapp/db";
import { recordToMessageV2 } from "../../lib/doc-to-message.v2";
import { apiKeyAuth } from "../../middleware/api-key";
import { messagesQuerySchema } from "../../schema/query";
import type { MessageV2, GeoJsonFeature } from "../../schema/contract.v2";
import {
  featureIntersectsBounds,
  type ViewportBounds,
} from "../../lib/bounds-utils";
import { getCentroid } from "../../lib/geometry-utils";
import {
  type MessageRecord,
  isUncategorizedDoc,
  toViewportBounds,
  getCutoffDate,
  findRecentMessageDocs,
  findRecentMessageDocsBySources,
  findUncategorizedDocs,
  applyOptionalSourceSet,
  isInvalidSourceForFilter,
  buildCategoryQueryPlans,
  getValidatedSources,
} from "../../lib/messages-query";

const CLUSTER_ZOOM_THRESHOLD = 15;

function sortMessagesByRelevance(messages: MessageV2[]): MessageV2[] {
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

function dedupeAndMapMessages(docs: MessageRecord[]): MessageV2[] {
  const messagesMap = new Map<string, MessageV2>();

  for (const doc of docs) {
    const docId = typeof doc._id === "string" ? doc._id : "";
    if (docId && !messagesMap.has(docId)) {
      messagesMap.set(docId, recordToMessageV2(doc));
    }
  }

  return Array.from(messagesMap.values());
}

async function findMessagesBySources(
  db: OboDb,
  cutoffDate: Date,
  sources: string[],
  locality?: string,
): Promise<MessageV2[]> {
  const results = await findRecentMessageDocsBySources(
    db,
    cutoffDate,
    sources,
    locality,
  );
  const messagesMap = new Map<string, MessageV2>();

  for (const doc of results) {
    const docId = typeof doc._id === "string" ? doc._id : "";
    if (docId && !messagesMap.has(docId)) {
      messagesMap.set(docId, recordToMessageV2(doc));
    }
  }

  return sortMessagesByRelevance(Array.from(messagesMap.values()));
}

async function findMessagesByCategoryFilters(
  db: OboDb,
  cutoffDate: Date,
  selectedCategories: string[],
  sourceSet?: Set<string>,
  locality?: string,
): Promise<MessageV2[]> {
  const realCategories = selectedCategories.filter(
    (c) => c !== "uncategorized",
  );
  const includeUncategorized = selectedCategories.includes("uncategorized");

  if (includeUncategorized && realCategories.length === 0) {
    const uncategorizedDocs = await findUncategorizedDocs(
      db,
      cutoffDate,
      sourceSet,
      locality,
    );
    return dedupeAndMapMessages(uncategorizedDocs);
  }

  const queryPlans = await buildCategoryQueryPlans(
    db,
    cutoffDate,
    realCategories,
    includeUncategorized,
    sourceSet,
    locality,
  );
  const messagesMap = new Map<string, MessageV2>();

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
        messagesMap.set(docId, recordToMessageV2(doc));
      }
    }
  }

  return sortMessagesByRelevance(Array.from(messagesMap.values()));
}

function filterMessagesByGeoAndViewport(
  messages: MessageV2[],
  viewportBounds: ViewportBounds | null,
): MessageV2[] {
  let filtered = messages.filter(
    (message) =>
      message.cityWide ||
      (message.geoJson !== null && message.geoJson !== undefined),
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
  messages: MessageV2[],
  zoom?: number,
): MessageV2[] {
  if (zoom === undefined || zoom >= CLUSTER_ZOOM_THRESHOLD) {
    return messages;
  }

  return messages.map((message) => {
    if (!message.geoJson?.features) return message;

    const simplifiedFeatures: GeoJsonFeature[] = message.geoJson.features.map(
      (feature) => {
        if (
          feature.geometry.type === "LineString" ||
          feature.geometry.type === "Polygon"
        ) {
          const centroid = getCentroid(feature.geometry);
          if (!centroid) return feature;

          const simplified: GeoJsonFeature = {
            type: "Feature",
            geometry: {
              type: "Point",
              coordinates: [centroid.lng, centroid.lat],
            },
            properties: {
              ...feature.properties,
              _originalGeometryType: feature.geometry.type,
            },
          };
          return simplified;
        }

        return feature;
      },
    );

    return {
      ...message,
      geoJson: {
        ...message.geoJson,
        features: simplifiedFeatures,
      },
    };
  });
}

export const messagesRouteV2 = new Hono();

messagesRouteV2.get("/messages", apiKeyAuth, async (c) => {
  try {
    const db = await getDb();

    const parsed = messagesQuerySchema.safeParse(
      Object.fromEntries(new URL(c.req.url).searchParams.entries()),
    );

    if (!parsed.success) {
      return c.json({ error: "Invalid query parameters" }, 400);
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

    if (selectedCategories && selectedCategories.length === 0) {
      return c.json({ messages: [] });
    }

    const locality = process.env.LOCALITY || "bg.sofia";
    const allSourceIds = new Set(
      SOURCES.filter((s) => s.localities.includes(locality)).map((s) => s.id),
    );

    const validatedSources = getValidatedSources(selectedSources, allSourceIds);

    if (
      selectedSources &&
      selectedSources.length > 0 &&
      validatedSources?.length === 0
    ) {
      return c.json({ messages: [] });
    }

    let allMessages: MessageV2[];
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
        locality,
      );
    } else if (hasSourceFilter) {
      allMessages = await findMessagesBySources(
        db,
        cutoffDate,
        validatedSources,
        locality,
      );
    } else {
      const docs = await findRecentMessageDocs(db, cutoffDate, locality);
      allMessages = docs.map(recordToMessageV2);
    }

    let messages = filterMessagesByGeoAndViewport(allMessages, viewportBounds);
    messages = simplifyMessagesForClusterZoom(messages, zoom);
    messages = sortMessagesByRelevance(messages);

    return c.json({ messages });
  } catch (error) {
    console.error("Error fetching messages:", error);
    return c.json({ error: "Failed to fetch messages" }, 500);
  }
});
