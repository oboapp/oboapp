import { describe, it, expect } from "vitest";
import {
  extractHostname,
  createMessageUrl,
  createMessageUrlFromId,
  hasValidSourceUrl,
} from "./url-utils";
import type { Message } from "./types";

describe("extractHostname", () => {
  it("should extract hostname from https URL", () => {
    expect(extractHostname("https://example.com/path")).toBe("example.com");
  });

  it("should extract hostname from http URL", () => {
    expect(extractHostname("http://example.com/path")).toBe("example.com");
  });

  it("should remove www prefix", () => {
    expect(extractHostname("https://www.example.com/path")).toBe("example.com");
  });

  it("should handle complex paths and query parameters", () => {
    expect(
      extractHostname(
        "https://mladost.bg/%d0%b2%d1%81%d0%b8%d1%87%d0%ba%d0%b8-%d0%bd%d0%be%d0%b2%d0%b8%d0%bd%d0%b8/%d0%b8%d0%bd%d1%84%d0%be%d1%80%d0%bc%d0%b0%d1%86%d0%b8%d1%8f?param=value",
      ),
    ).toBe("mladost.bg");
  });

  it("should handle URLs with ports", () => {
    expect(extractHostname("https://example.com:8080/path")).toBe(
      "example.com",
    );
  });

  it("should handle subdomains", () => {
    expect(extractHostname("https://api.example.com/path")).toBe(
      "api.example.com",
    );
  });

  it("should handle www subdomain with other subdomains", () => {
    expect(extractHostname("https://www.api.example.com/path")).toBe(
      "api.example.com",
    );
  });

  it("should return original string for invalid URLs", () => {
    expect(extractHostname("not-a-url")).toBe("not-a-url");
  });

  it("should return original string for empty string", () => {
    expect(extractHostname("")).toBe("");
  });

  it("should handle URLs without protocol", () => {
    expect(extractHostname("example.com/path")).toBe("example.com/path");
  });

  it("should handle real project URLs", () => {
    expect(extractHostname("https://rayon-oborishte.bg/category/news")).toBe(
      "rayon-oborishte.bg",
    );
    expect(extractHostname("https://www.sofiyskavoda.bg/water-status")).toBe(
      "sofiyskavoda.bg",
    );
    expect(extractHostname("https://so-slatina.org/2024/news")).toBe(
      "so-slatina.org",
    );
  });
});

describe("createMessageUrl", () => {
  it("should create URL from message with ID", () => {
    const message: Message = {
      id: "aB3xYz12",
      text: "Test message",
      createdAt: "2024-01-01T00:00:00Z",
      locality: "bg.sofia",
    };
    expect(createMessageUrl(message)).toBe("/?messageId=aB3xYz12");
  });

  it("should URL-encode special characters in ID", () => {
    const message: Message & { id: string } = {
      id: "test/id?value",
      text: "Test message",
      createdAt: "2024-01-01T00:00:00Z",
      locality: "bg.sofia",
    };
    expect(createMessageUrl(message)).toBe("/?messageId=test%2Fid%3Fvalue");
  });
});

describe("createMessageUrlFromId", () => {
  it("should create URL from ID string", () => {
    expect(createMessageUrlFromId("aB3xYz12")).toBe("/?messageId=aB3xYz12");
  });

  it("should URL-encode special characters in ID", () => {
    expect(createMessageUrlFromId("test/id?value")).toBe(
      "/?messageId=test%2Fid%3Fvalue",
    );
  });
});

describe("hasValidSourceUrl", () => {
  it("returns true for valid https URL", () => {
    expect(hasValidSourceUrl("https://example.com/path")).toBe(true);
  });

  it("returns false for http URL", () => {
    expect(hasValidSourceUrl("http://example.com/path")).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(hasValidSourceUrl(undefined)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(hasValidSourceUrl("")).toBe(false);
  });

  it("returns false for invalid URL string", () => {
    expect(hasValidSourceUrl("not a url")).toBe(false);
  });

  it("returns false for https:// with no host", () => {
    expect(hasValidSourceUrl("https://")).toBe(false);
  });

  it("returns true for https URL with query params", () => {
    expect(hasValidSourceUrl("https://example.com/path?foo=bar")).toBe(true);
  });
});
