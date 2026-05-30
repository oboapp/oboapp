import {
  InternalMessage,
  Address,
  GeoJSONFeatureCollection,
} from "@/lib/types";

/**
 * Helper: Build the final message response
 * Returns InternalMessage for backend operations
 */
export async function buildMessageResponse(
  messageId: string,
  text: string,
  locality: string,
  addresses: Address[],
  geoJson: GeoJSONFeatureCollection | null,
  aiProcessed: boolean = false,
): Promise<InternalMessage> {
  return {
    id: messageId,
    text,
    aiProcessed,
    locality,
    addresses,
    geoJson: geoJson || undefined,
    createdAt: new Date().toISOString(),
  };
}
