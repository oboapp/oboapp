import { describe, it, expect } from "vitest";
import { encodeDocumentId } from "./firestore";

describe("firestore utilities", () => {
  describe("encodeDocumentId", () => {
    it("should encode URL as an MD5 document ID", () => {
      const url = "https://example.com/test";
      const encoded = encodeDocumentId(url);

      expect(encoded).toMatch(/^[a-f0-9]{32}$/);

      // Should not contain unsafe characters
      expect(encoded).not.toMatch(/[/+=]/);
    });

    it("should produce consistent results for same URL", () => {
      const url = "https://example.com/test?param=value";
      const encoded1 = encodeDocumentId(url);
      const encoded2 = encodeDocumentId(url);

      expect(encoded1).toBe(encoded2);
    });

    it("should produce different results for different URLs", () => {
      const url1 = "https://example.com/test1";
      const url2 = "https://example.com/test2";

      expect(encodeDocumentId(url1)).not.toBe(encodeDocumentId(url2));
    });

    it("should handle URLs with special characters", () => {
      const url = "https://example.com/test?param=value&other=123#anchor";
      const encoded = encodeDocumentId(url);

      expect(encoded).toBeTruthy();
      expect(encoded).not.toMatch(/[/+=]/);
    });

    it("should handle Cyrillic URLs", () => {
      const url =
        "https://rayon-oborishte.bg/%d1%83%d0%b2%d0%b5%d0%b4%d0%be%d0%bc%d0%bb%d0%b5%d0%bd%d0%b8%d0%b5";
      const encoded = encodeDocumentId(url);

      expect(encoded).toBeTruthy();
      expect(encoded).not.toMatch(/[/+=]/);
    });
  });
});
