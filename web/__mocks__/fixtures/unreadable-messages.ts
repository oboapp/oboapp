import type { InternalMessage } from "@/lib/types";

/**
 * Mock unreadable messages for MSW development mode.
 * These represent messages that could not be geolocated.
 */
export const MOCK_UNREADABLE_MESSAGES: InternalMessage[] = [
  {
    locality: "bg.sofia",
    id: "msg-unreadable-1",
    text: "Констативен акт № КА-002\n\nС пълния текст на акта можете да се запознаете от следния линк:\n\nhttps://lozenets.sofia.bg/wp-content/uploads/2026/03/ka-002.pdf",
    aiProcessed: true,
    plainText: "",
    markdownText: "",
    categories: [],
    addresses: [],
    createdAt: new Date("2026-03-10T09:00:00Z").toISOString(),
    finalizedAt: new Date("2026-03-10T09:01:00Z").toISOString(),
    source: "lozenets-sofia-bg",
    sourceUrl: "https://lozenets.sofia.bg/констативен-акт-ка-002/",
    responsibleEntity: "Район Лозенец",
    cityWide: false,
    isRelevant: false,
    isUnreadable: true,
  },
];
