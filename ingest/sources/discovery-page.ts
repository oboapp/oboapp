import { serializeDiscoveryPayload } from "@oboapp/source-sdk";
import type { DiscoveryPage } from "@oboapp/source-sdk";
import type { PendingSourceItem } from "@oboapp/db";

export const MAX_DISCOVERY_PAGE_ITEMS = 500;
export const MAX_DISCOVERY_PAGE_BYTES = 1024 * 1024;
const MAX_IDENTIFIER_BYTES = 8192;
const MAX_CURSOR_BYTES = 4096;

function boundedString(value: unknown, limit: number, name: string): string {
  if (typeof value !== "string" || new TextEncoder().encode(value).byteLength > limit) {
    throw new TypeError(`Invalid or oversized discovery ${name}`);
  }
  return value;
}

export interface PreparedDiscoveryPage {
  items: PendingSourceItem[];
  nextCursor: string | null;
}

/** Validate the complete page before allowing any durable writes. */
export function prepareDiscoveryPage(
  sourceType: string,
  locality: string,
  page: DiscoveryPage,
): PreparedDiscoveryPage {
  if (!page || !Array.isArray(page.items) || page.items.length > MAX_DISCOVERY_PAGE_ITEMS) {
    throw new TypeError("Invalid or oversized discovery page");
  }
  const nextCursor = page.nextCursor === undefined
    ? null : boundedString(page.nextCursor, MAX_CURSOR_BYTES, "cursor");
  const items = Array.from(page.items, (item): PendingSourceItem => {
    if (!item || typeof item !== "object") throw new TypeError("Invalid discovery item");
    const identifier = boundedString(item.identifier, MAX_IDENTIFIER_BYTES, "identifier");
    if (identifier.trim().length === 0) throw new TypeError("Discovery identifier must not be empty");
    return {
      identifier, sourceType, locality,
      ...(item.observedAt === undefined ? {} : {
        observedAt: boundedString(item.observedAt, MAX_CURSOR_BYTES, "revision"),
      }),
      ...(item.payload === undefined ? {} : { payloadJson: serializeDiscoveryPayload(item.payload) }),
    };
  });
  if (new TextEncoder().encode(JSON.stringify({ items, nextCursor })).byteLength > MAX_DISCOVERY_PAGE_BYTES) {
    throw new RangeError("Discovery page exceeds 1 MiB; return smaller pages");
  }
  return { items, nextCursor };
}
