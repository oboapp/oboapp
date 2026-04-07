/**
 * Utility functions for URL manipulation
 */

import type { Message } from "./types";

/**
 * Extracts the hostname from a URL and removes common prefixes
 * @param url - The URL to extract hostname from
 * @returns The cleaned hostname, or original URL if parsing fails
 *
 * @example
 * extractHostname("https://www.example.com/path") // "example.com"
 * extractHostname("http://mladost.bg/long/path") // "mladost.bg"
 * extractHostname("invalid-url") // "invalid-url"
 */
export function extractHostname(url: string): string {
  try {
    const { hostname } = new URL(url);
    return hostname.replace("www.", "");
  } catch {
    return url;
  }
}

/**
 * Creates a URL for a message using its ID
 * @param message - The message object with ID
 * @returns The URL path for the message
 *
 * @example
 * createMessageUrl({ id: "aB3xYz12" }) // "/?messageId=aB3xYz12"
 */
export function createMessageUrl(message: Message): string {
  if (!message.id) {
    throw new Error("Message must have an id");
  }
  return `/?messageId=${encodeURIComponent(message.id)}`;
}

/**
 * Creates a URL for a message from its ID string
 * @param messageId - The message ID
 * @returns The URL path for the message
 *
 * @example
 * createMessageUrlFromId("aB3xYz12") // "/?messageId=aB3xYz12"
 */
export function createMessageUrlFromId(messageId: string): string {
  return `/?messageId=${encodeURIComponent(messageId)}`;
}

export function hasValidSourceUrl(sourceUrl?: string): boolean {
  if (!sourceUrl) {
    return false;
  }

  try {
    const url = new URL(sourceUrl);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}
