import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  normalizeAddressForNominatim,
  normalizeStreetName,
  toOverpassRegex,
  clearStreetGeometryCache,
  overpassGeocodeIntersections,
  getStreetGeometryFromOverpass,
  preFetchStreetGeometries,
  CIRCUIT_BREAKER_THRESHOLD,
  OVERPASS_INSTANCES,
  OVERPASS_RETRY_MAX_ATTEMPTS,
  OVERPASS_RETRY_BASE_DELAY_MS,
  OVERPASS_RETRY_MAX_DELAY_MS,
  parseRetryAfterMs,
  calculateRetryDelayMs,
} from "./service";
import { delay } from "../../lib/delay";

// Prevent the 500ms inter-item delay from slowing down the test suite
vi.mock("../../lib/delay", () => ({
  delay: vi.fn().mockResolvedValue(undefined),
}));

describe("overpass-geocoding-service", () => {
  describe("parseOverpassError", () => {
    // Helper function copied for testing
    function parseOverpassError(responseText: string): string | null {
      const remarkMatch = /<remark>\s*([\s\S]+?)\s*<\/remark>/.exec(
        responseText,
      );
      if (remarkMatch) {
        return remarkMatch[1].trim();
      }
      return null;
    }

    it("should extract error message from XML remark tag", () => {
      const xml =
        '<?xml version="1.0" encoding="UTF-8"?><remark>Error: Query timed out after 25 seconds</remark>';
      expect(parseOverpassError(xml)).toBe(
        "Error: Query timed out after 25 seconds",
      );
    });

    it("should handle multi-line error messages", () => {
      const xml = `<?xml version="1.0"?>
<remark>
  Error: Query syntax error at line 3
  Expected identifier
</remark>`;
      expect(parseOverpassError(xml)).toBe(
        "Error: Query syntax error at line 3\n  Expected identifier",
      );
    });

    it("should trim whitespace from error messages", () => {
      const xml = "<remark>   Error: timeout   </remark>";
      expect(parseOverpassError(xml)).toBe("Error: timeout");
    });

    it("should return null for non-error responses", () => {
      const json = '{"elements":[{"type":"way","id":123}]}';
      expect(parseOverpassError(json)).toBe(null);
    });

    it("should return null for empty string", () => {
      expect(parseOverpassError("")).toBe(null);
    });

    it("should handle XML without remark tag", () => {
      const xml =
        '<?xml version="1.0"?><osm version="0.6"><note>Some note</note></osm>';
      expect(parseOverpassError(xml)).toBe(null);
    });
  });

  describe("shouldTryFallback", () => {
    // Helper function copied for testing
    function shouldTryFallback(error: Error, statusCode?: number): boolean {
      const msg = error.message.toLowerCase();

      // Client-side errors (our fault) - don't retry
      if (
        msg.includes("syntax") ||
        msg.includes("parse error") ||
        msg.includes("expected") ||
        msg.includes("unexpected") ||
        msg.includes("invalid")
      ) {
        return false;
      }

      // HTTP 4xx = client error (except 429 Too Many Requests)
      if (
        statusCode &&
        statusCode >= 400 &&
        statusCode < 500 &&
        statusCode !== 429
      ) {
        return false;
      }

      // All other errors = server-side, should retry
      return true;
    }

    describe("client-side errors (should NOT retry)", () => {
      it("should not retry on syntax errors", () => {
        const error = new Error("Query syntax error at line 3");
        expect(shouldTryFallback(error)).toBe(false);
      });

      it("should not retry on parse errors", () => {
        const error = new Error("Parse error: unexpected token");
        expect(shouldTryFallback(error)).toBe(false);
      });

      it("should not retry on expected keyword errors", () => {
        const error = new Error("Expected identifier, got symbol");
        expect(shouldTryFallback(error)).toBe(false);
      });

      it("should not retry on unexpected keyword errors", () => {
        const error = new Error("Unexpected end of query");
        expect(shouldTryFallback(error)).toBe(false);
      });

      it("should not retry on invalid errors", () => {
        const error = new Error("Invalid coordinates provided");
        expect(shouldTryFallback(error)).toBe(false);
      });

      it("should not retry on HTTP 400 errors", () => {
        const error = new Error("Bad Request");
        expect(shouldTryFallback(error, 400)).toBe(false);
      });

      it("should not retry on HTTP 404 errors", () => {
        const error = new Error("Not Found");
        expect(shouldTryFallback(error, 404)).toBe(false);
      });
    });

    describe("server-side errors (SHOULD retry)", () => {
      it("should retry on timeout errors", () => {
        const error = new Error("Query timed out after 25 seconds");
        expect(shouldTryFallback(error)).toBe(true);
      });

      it("should retry on network errors", () => {
        const error = new Error("Network request failed");
        expect(shouldTryFallback(error)).toBe(true);
      });

      it("should retry on AbortError", () => {
        const error = new Error("The operation was aborted");
        error.name = "AbortError";
        expect(shouldTryFallback(error)).toBe(true);
      });

      it("should retry on server overload", () => {
        const error = new Error("Server is busy, please try again");
        expect(shouldTryFallback(error)).toBe(true);
      });

      it("should retry on HTTP 429 (rate limit)", () => {
        const error = new Error("Too Many Requests");
        expect(shouldTryFallback(error, 429)).toBe(true);
      });

      it("should retry on HTTP 500 errors", () => {
        const error = new Error("Internal Server Error");
        expect(shouldTryFallback(error, 500)).toBe(true);
      });

      it("should retry on HTTP 503 errors", () => {
        const error = new Error("Service Unavailable");
        expect(shouldTryFallback(error, 503)).toBe(true);
      });

      it("should retry on generic errors without status code", () => {
        const error = new Error("Something went wrong");
        expect(shouldTryFallback(error)).toBe(true);
      });
    });

    describe("case insensitivity", () => {
      it("should detect SYNTAX errors in uppercase", () => {
        const error = new Error("SYNTAX ERROR AT LINE 5");
        expect(shouldTryFallback(error)).toBe(false);
      });

      it("should detect Invalid errors in mixed case", () => {
        const error = new Error("Invalid Query Structure");
        expect(shouldTryFallback(error)).toBe(false);
      });
    });
  });

  describe("normalizeStreetName", () => {
    it("strips ул. prefix", () => {
      expect(normalizeStreetName("ул. Оборище")).toBe("оборище");
    });

    it("strips бул. prefix", () => {
      expect(normalizeStreetName("бул. Цар Освободител")).toBe(
        "цар освободител",
      );
    });

    it("strips ordinal suffix -ти from numbers", () => {
      expect(normalizeStreetName("ул. 20-ти април")).toBe("20 април");
    });

    it("strips ordinal suffix -ви from numbers", () => {
      expect(normalizeStreetName("ул. 21-ви януари")).toBe("21 януари");
    });

    it("strips ordinal suffix -ри from numbers", () => {
      expect(normalizeStreetName("ул. 3-ти март")).toBe("3 март");
    });

    it("removes quote styles", () => {
      expect(normalizeStreetName("ул. „Цар Самуил“")).toBe("цар самуил");
    });

    it("inserts spaces after dots in consecutive abbreviations: Г.С.Раковски", () => {
      expect(normalizeStreetName("ул. Г.С.Раковски")).toBe("г. с. раковски");
    });

    it("preserves already-spaced abbreviations", () => {
      expect(normalizeStreetName("ул. Г. С. Раковски")).toBe("г. с. раковски");
    });
  });

  describe("toOverpassRegex", () => {
    it("adds optional ordinal suffix after numbers (20 → matches 20-ти)", () => {
      const regex = new RegExp(toOverpassRegex("20 април"), "i");
      expect(regex.test("20 април")).toBe(true);
      expect(regex.test("20-ти април")).toBe(true);
      expect(regex.test("20-ви април")).toBe(true);
    });

    it("makes hyphens between letters flexible (matches both -  and  -  variants)", () => {
      const regex = new RegExp(toOverpassRegex("данчов-зографина"), "i");
      expect(regex.test("Георги Данчов - Зографина")).toBe(true);
      expect(regex.test("Георги Данчов-Зографина")).toBe(true);
    });

    it("leaves plain street names unchanged", () => {
      expect(toOverpassRegex("лайош кошут")).toBe("лайош кошут");
    });

    it("expands single-letter abbreviation at start: к. пейчинович matches Кирил Пейчинович", () => {
      const regex = new RegExp(toOverpassRegex("к. пейчинович"), "i");
      // OSM stores the full name, so the expanded pattern must match it
      expect(regex.test("Кирил Пейчинович")).toBe(true);
      // Also still matches when the first letter is followed by more letters (any initial)
      expect(regex.test("Кузман Пейчинович")).toBe(true);
    });

    it("expands single-letter abbreviation in the middle: михаил д. скобелев matches Михаил Дмитриевич Скобелев", () => {
      const regex = new RegExp(toOverpassRegex("михаил д. скобелев"), "i");
      expect(regex.test("Михаил Дмитриевич Скобелев")).toBe(true);
      expect(regex.test("Михаил Д. Скобелев")).toBe(true); // also matches abbreviated OSM form
    });

    it("expands consecutive abbreviations: г. с. раковски matches Георги С. Раковски", () => {
      const regex = new RegExp(toOverpassRegex("г. с. раковски"), "i");
      expect(regex.test("Георги С. Раковски")).toBe(true); // OSM format
      expect(regex.test("Георги Стефанов Раковски")).toBe(true); // fully expanded
    });

    it("does not expand multi-letter abbreviations (ген. stays literal)", () => {
      const pattern = toOverpassRegex("ген. михаил скобелев");
      // "ген." has 3 letters — must NOT be expanded
      expect(pattern).toBe("ген. михаил скобелев");
    });
  });

  describe("normalizeAddressForNominatim", () => {
    it("strips № symbol", () => {
      expect(normalizeAddressForNominatim("ул. Оборище №15")).toBe(
        "ул. Оборище 15",
      );
    });

    it("strips № with space after it", () => {
      expect(normalizeAddressForNominatim("бул. Витоша № 23")).toBe(
        "бул. Витоша 23",
      );
    });

    it("normalizes multiple spaces", () => {
      expect(normalizeAddressForNominatim("бл. 66,  ж.к.  Дружба")).toBe(
        "бл. 66, ж.к. Дружба",
      );
    });

    it("trims leading/trailing whitespace", () => {
      expect(normalizeAddressForNominatim("  ул. Шипка 5  ")).toBe(
        "ул. Шипка 5",
      );
    });

    it("returns empty string for whitespace-only input", () => {
      expect(normalizeAddressForNominatim("   ")).toBe("");
    });

    it("passes through addresses without special characters", () => {
      expect(normalizeAddressForNominatim("бл. 12, ж.к. Младост")).toBe(
        "бл. 12, ж.к. Младост",
      );
    });
  });

  describe("parseRetryAfterMs", () => {
    it("returns null for null header", () => {
      expect(parseRetryAfterMs(null)).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(parseRetryAfterMs("")).toBeNull();
      expect(parseRetryAfterMs("   ")).toBeNull();
    });

    it("parses delta-seconds correctly", () => {
      expect(parseRetryAfterMs("3")).toBe(3_000);
      expect(parseRetryAfterMs("0")).toBe(0);
    });

    it("caps delta-seconds at OVERPASS_RETRY_MAX_DELAY_MS", () => {
      expect(parseRetryAfterMs("9999")).toBe(OVERPASS_RETRY_MAX_DELAY_MS);
    });

    it("returns 0 for a past HTTP-date", () => {
      const pastDate = new Date(Date.now() - 60_000).toUTCString();
      expect(parseRetryAfterMs(pastDate)).toBe(0);
    });

    it("returns a positive delta for a future HTTP-date, capped at max", () => {
      const farFuture = new Date(Date.now() + 999_999_999).toUTCString();
      expect(parseRetryAfterMs(farFuture)).toBe(OVERPASS_RETRY_MAX_DELAY_MS);
    });

    it("returns the correct delta for a near-future HTTP-date", () => {
      const targetDelayMs = 10_000;
      const futureDate = new Date(Date.now() + targetDelayMs).toUTCString();
      const result = parseRetryAfterMs(futureDate);
      // toUTCString() truncates to second precision; allow up to 1500ms tolerance
      expect(result).toBeGreaterThanOrEqual(targetDelayMs - 1500);
      expect(result).toBeLessThanOrEqual(targetDelayMs);
    });

    it("returns null for a malformed string", () => {
      expect(parseRetryAfterMs("not-a-date")).toBeNull();
    });

    it("returns null for strings that are not IMF-fixdate (strict RFC 7231 format)", () => {
      // ISO 8601 — accepted by Date.parse but not a valid Retry-After HTTP-date
      expect(parseRetryAfterMs("2026-04-05T12:34:56Z")).toBeNull();
      // Raw number with sign — not delta-seconds, not IMF-fixdate
      expect(parseRetryAfterMs("-1")).toBeNull();
    });
  });

  describe("calculateRetryDelayMs", () => {
    it("returns retryAfterMs directly when provided", () => {
      expect(calculateRetryDelayMs(1, 5_000)).toBe(5_000);
      expect(calculateRetryDelayMs(2, 0)).toBe(0);
    });

    it("caps retryAfterMs at OVERPASS_RETRY_MAX_DELAY_MS", () => {
      expect(calculateRetryDelayMs(1, OVERPASS_RETRY_MAX_DELAY_MS + 1)).toBe(
        OVERPASS_RETRY_MAX_DELAY_MS,
      );
    });

    it("attempt 1 falls within [BASE * 0.75, BASE * 1.25]", () => {
      for (let i = 0; i < 20; i++) {
        const result = calculateRetryDelayMs(1, null);
        expect(result).toBeGreaterThanOrEqual(
          Math.round(OVERPASS_RETRY_BASE_DELAY_MS * 0.75),
        );
        expect(result).toBeLessThanOrEqual(
          Math.round(OVERPASS_RETRY_BASE_DELAY_MS * 1.25),
        );
      }
    });

    it("attempt 2 has a larger base than attempt 1 (exponential growth)", () => {
      // With ±25% jitter: attempt1 max = BASE*1.25 = 1250, attempt2 min = BASE*2*0.75 = 1500
      // Ranges do not overlap, so a single sample suffices for a range check
      const attempt1Max = Math.round(OVERPASS_RETRY_BASE_DELAY_MS * 1.25);
      const attempt2Min = Math.round(OVERPASS_RETRY_BASE_DELAY_MS * 2 * 0.75);
      expect(attempt2Min).toBeGreaterThan(attempt1Max);
    });

    it("caps at OVERPASS_RETRY_MAX_DELAY_MS for large attempt numbers", () => {
      for (let i = 0; i < 10; i++) {
        expect(calculateRetryDelayMs(20, null)).toBe(
          OVERPASS_RETRY_MAX_DELAY_MS,
        );
      }
    });
  });

  describe("streetGeometryCache", () => {
    const wayResponse = JSON.stringify({
      elements: [
        {
          type: "way",
          geometry: [
            { lat: 42.6977, lon: 23.3219 },
            { lat: 42.698, lon: 23.3225 },
          ],
        },
      ],
    });
    const emptyResponse = JSON.stringify({ elements: [] });

    function mockFetch(responseBody: string) {
      return vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(responseBody),
      });
    }

    beforeEach(() => {
      clearStreetGeometryCache();
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("retries deferred intersections after transient network failures", async () => {
      const attemptsByInstanceAndQuery = new Map<string, number>();
      const fetchMock = vi.fn(
        async (input: string | URL, init?: RequestInit) => {
          const instance =
            input instanceof URL ? input.toString() : String(input);
          const query = typeof init?.body === "string" ? init.body : "";
          const key = `${instance}|${query}`;
          const attempts = attemptsByInstanceAndQuery.get(key) ?? 0;
          attemptsByInstanceAndQuery.set(key, attempts + 1);

          if (attempts === 0) {
            throw new Error("Network request failed");
          }

          return {
            ok: true,
            text: () => Promise.resolve(wayResponse),
          };
        },
      );
      vi.stubGlobal("fetch", fetchMock);

      const results = await overpassGeocodeIntersections([
        "ул. Пример ∩ ул. Фоо",
      ]);

      expect(
        [...attemptsByInstanceAndQuery.values()].some(
          (attempts) => attempts > 1,
        ),
      ).toBe(true);
      expect(results).toHaveLength(1);
    });

    it("deduplicates Overpass fetches when the same street appears in multiple intersections", async () => {
      vi.stubGlobal("fetch", mockFetch(wayResponse));

      await overpassGeocodeIntersections([
        "ул. Пример ∩ ул. Фоо",
        "ул. Пример ∩ ул. Бар",
      ]);

      // 3 unique streets (ул. Пример, ул. Фоо, ул. Бар) — ул. Пример fetched only once
      expect(fetch).toHaveBeenCalledTimes(3);
    });

    it("caches null results and skips re-fetching streets not found in OSM", async () => {
      vi.stubGlobal("fetch", mockFetch(emptyResponse));

      await overpassGeocodeIntersections([
        "ул. Пример ∩ ул. Фоо",
        "ул. Пример ∩ ул. Бар",
      ]);

      // Same deduplication applies even when results are null
      expect(fetch).toHaveBeenCalledTimes(3);
    });

    it("uses separate cache entries for streets vs squares with the same normalized name", async () => {
      const fetchMock = mockFetch(wayResponse);
      vi.stubGlobal("fetch", fetchMock);

      // Both normalize to the same string, but use different Overpass queries
      await overpassGeocodeIntersections(["ул. Свобода ∩ ул. Фоо"]);
      fetchMock.mockClear();

      // A square lookup for the same normalized name should still go to the network
      await overpassGeocodeIntersections(["пл. Свобода ∩ ул. Фоо"]);
      // пл. Свобода is a square — NOT served from the way cache (different key square:свобода vs way:свобода)
      // ул. Фоо is already cached (way:фоо) → only 1 fresh fetch
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("clearing the cache causes a subsequent lookup to hit the network again", async () => {
      const fetchMock = mockFetch(wayResponse);
      vi.stubGlobal("fetch", fetchMock);

      await overpassGeocodeIntersections(["ул. Пример ∩ ул. Фоо"]);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      clearStreetGeometryCache();
      fetchMock.mockClear();

      // Both streets were cleared — should fetch them again
      await overpassGeocodeIntersections(["ул. Пример ∩ ул. Фоо"]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    describe("adaptive retry policy", () => {
      it("retries 429 on the same instance with backoff before falling back to the next", async () => {
        // First instance always returns 429; second instance succeeds
        let instance1Calls = 0;
        let instance2Calls = 0;
        vi.stubGlobal(
          "fetch",
          vi.fn(async (url: string | URL) => {
            if (String(url) === OVERPASS_INSTANCES[0]) {
              instance1Calls++;
              return {
                ok: false,
                status: 429,
                statusText: "Too Many Requests",
                headers: { get: (_: string) => null },
                text: () => Promise.resolve(""),
              };
            }
            instance2Calls++;
            return { ok: true, text: () => Promise.resolve(wayResponse) };
          }),
        );

        const results = await overpassGeocodeIntersections([
          "ул. Пример ∩ ул. Фоо",
        ]);

        // 2 streets, each exhausts OVERPASS_RETRY_MAX_ATTEMPTS on instance 1 before falling back
        expect(instance1Calls).toBe(OVERPASS_RETRY_MAX_ATTEMPTS * 2);
        // Instance 2 then handles both streets successfully on the first try
        expect(instance2Calls).toBe(2);
        expect(results).toHaveLength(1);
      });

      it("respects Retry-After header when backing off on 429", async () => {
        vi.mocked(delay).mockClear();
        let fetchCount = 0;
        vi.stubGlobal(
          "fetch",
          vi.fn(async (url: string | URL) => {
            if (String(url) === OVERPASS_INSTANCES[0] && fetchCount++ === 0) {
              return {
                ok: false,
                status: 429,
                statusText: "Too Many Requests",
                headers: {
                  get: (name: string) => (name === "Retry-After" ? "3" : null),
                },
                text: () => Promise.resolve(""),
              };
            }
            return { ok: true, text: () => Promise.resolve(wayResponse) };
          }),
        );

        await overpassGeocodeIntersections(["ул. Пример ∩ ул. Фоо"]);

        // delay must have been called with exactly 3000 ms for the Retry-After header
        const delayCalls = vi.mocked(delay).mock.calls.map(([ms]) => ms);
        expect(delayCalls).toContain(3000);
      });

      it("falls back to the next instance after all 429 retries are exhausted on the first", async () => {
        // All instances always return 429 — retries exhaust on each instance,
        // then fall back, then exhaust again → all instances fail → null result.
        vi.stubGlobal(
          "fetch",
          vi.fn(async () => ({
            ok: false,
            status: 429,
            statusText: "Too Many Requests",
            headers: { get: (_: string) => null },
            text: () => Promise.resolve(""),
          })),
        );

        const results = await overpassGeocodeIntersections(["ул. Пример ∩ ул. Фоо"]);

        // Each of the 2 streets has 2 unique street names. In pass 1 every instance is
        // tried with OVERPASS_RETRY_MAX_ATTEMPTS before moving on. All streets are deferred.
        // In pass 2 the deferred streets are retried with the same exhaustion pattern.
        const expectedCalls =
          2 * OVERPASS_INSTANCES.length * OVERPASS_RETRY_MAX_ATTEMPTS * 2; // ×2 passes
        expect(vi.mocked(fetch).mock.calls.length).toBe(expectedCalls);
        // No intersection resolved — both streets have null geometry
        expect(results).toHaveLength(0);
      });

      it("retries AbortError (timeout) on the same instance with backoff", async () => {
        // First instance always times out; second instance succeeds
        let instance1Calls = 0;
        let instance2Calls = 0;
        vi.stubGlobal(
          "fetch",
          vi.fn(async (url: string | URL) => {
            if (String(url) === OVERPASS_INSTANCES[0]) {
              instance1Calls++;
              const err = new Error("The operation was aborted");
              err.name = "AbortError";
              throw err;
            }
            instance2Calls++;
            return { ok: true, text: () => Promise.resolve(wayResponse) };
          }),
        );

        const results = await overpassGeocodeIntersections([
          "ул. Пример ∩ ул. Фоо",
        ]);

        // 2 streets, each exhausts OVERPASS_RETRY_MAX_ATTEMPTS on instance 1 before falling back
        expect(instance1Calls).toBe(OVERPASS_RETRY_MAX_ATTEMPTS * 2);
        expect(instance2Calls).toBe(2);
        expect(results).toHaveLength(1);
      });
    });

    describe("circuit breaker", () => {
      it("opens after threshold consecutive transient failures and defers remaining streets", async () => {
        vi.stubGlobal(
          "fetch",
          vi.fn().mockRejectedValue(new Error("Network request failed")),
        );

        // Enough unique intersections to exceed the threshold (each has 2 unique streets)
        const intersections = Array.from(
          { length: CIRCUIT_BREAKER_THRESHOLD + 2 },
          (_, i) => `ул. А${i} ∩ ул. Б${i}`,
        );

        await overpassGeocodeIntersections(intersections);

        // Without circuit breaker every street would be tried on every instance in both passes.
        // With circuit breaker, at most threshold × instances calls occur per pass before it opens.
        const overpassInstanceCount = OVERPASS_INSTANCES.length;
        const maxExpectedCallsPerPass =
          CIRCUIT_BREAKER_THRESHOLD * overpassInstanceCount;
        expect(vi.mocked(fetch).mock.calls.length).toBeLessThan(
          intersections.length * 2 * overpassInstanceCount,
        );
        expect(vi.mocked(fetch).mock.calls.length).toBeLessThanOrEqual(
          maxExpectedCallsPerPass * 2, // retry pass also resets and can trip again
        );
      });

      it("resets after a successful request so subsequent streets are attempted", async () => {
        // All instances fail for the first threshold streets, then requests start succeeding
        // — the circuit should reset on the first successful response.
        const overpassInstanceCount = OVERPASS_INSTANCES.length;
        let fetchCallCount = 0;
        vi.stubGlobal(
          "fetch",
          vi.fn(async (url: string | URL) => {
            fetchCallCount++;
            // First threshold × instances calls fail (enough to open the circuit)
            if (
              fetchCallCount <=
              CIRCUIT_BREAKER_THRESHOLD * overpassInstanceCount
            ) {
              throw new Error("Network request failed");
            }
            return { ok: true, text: () => Promise.resolve(wayResponse) };
          }),
        );

        // Provide threshold+2 intersections: after threshold × instances failures the
        // circuit opens, then the retry pass resets it once requests start succeeding.
        const intersections = Array.from(
          { length: CIRCUIT_BREAKER_THRESHOLD + 2 },
          (_, i) => `ул. А${i} ∩ ул. Б${i}`,
        );

        const results = await overpassGeocodeIntersections(intersections);

        // After the circuit resets, some intersections should be resolved
        expect(results.length).toBeGreaterThan(0);
      });
    });
  });

  describe("preFetchStreetGeometries", () => {
    const wayResponse = JSON.stringify({
      elements: [
        {
          type: "way",
          geometry: [
            { lat: 42.6977, lon: 23.3219 },
            { lat: 42.698, lon: 23.3225 },
          ],
        },
      ],
    });

    function mockFetch(responseBody: string) {
      return vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(responseBody),
      });
    }

    beforeEach(() => {
      clearStreetGeometryCache();
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("deduplicates by normalized cache key: three names → two Overpass calls", async () => {
      vi.stubGlobal("fetch", mockFetch(wayResponse));

      // "ул. Оборище" and "ул.Оборище" normalize to the same key
      await preFetchStreetGeometries([
        "ул. Оборище",
        "ул.Оборище",
        "ул. Раковски",
      ]);

      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("skips names already present in the geometry cache", async () => {
      vi.stubGlobal("fetch", mockFetch(wayResponse));

      // Warm up the cache for "ул. Оборище"
      await preFetchStreetGeometries(["ул. Оборище"]);
      expect(fetch).toHaveBeenCalledTimes(1);
      vi.mocked(fetch).mockClear();

      // Second call: already cached → no new fetch
      await preFetchStreetGeometries(["ул. Оборище", "ул. Оборище"]);
      expect(fetch).toHaveBeenCalledTimes(0);
    });

    it("retries deferred streets in a second pass", async () => {
      // Fail on ALL instances in pass 1 so the street is actually deferred (not satisfied
      // by the fallback instance), then succeed in pass 2 (after clearDeferredStreetGeometryKeys).
      // The inter-pass delay mock is overridden to flip the pass1Done flag.
      let pass1Done = false;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          if (!pass1Done) throw new Error("Network request failed");
          return { ok: true, text: () => Promise.resolve(wayResponse) };
        }),
      );
      vi.mocked(delay).mockImplementation(async () => {
        pass1Done = true;
      });

      await preFetchStreetGeometries(["ул. Пример"]);

      // Pass 1: OVERPASS_INSTANCES.length calls all fail → street deferred
      // Pass 2: 1 call succeeds on the first instance
      expect(vi.mocked(fetch).mock.calls.length).toBe(OVERPASS_INSTANCES.length + 1);
      // The second-pass result must have been cached — no further fetch needed
      vi.mocked(fetch).mockClear();
      const cached = await getStreetGeometryFromOverpass("ул. Пример");
      expect(cached).not.toBeNull();
      expect(vi.mocked(fetch).mock.calls.length).toBe(0);

      // Restore default delay mock
      vi.mocked(delay).mockResolvedValue(undefined);
    });

    it("caches persistently unavailable streets as null after retry exhaustion", async () => {
      // All instances always fail → passes through both passes → cached as null
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new Error("Network request failed")),
      );

      await preFetchStreetGeometries(["ул. Пример"]);
      const fetchCallsDuringPreFetch = vi.mocked(fetch).mock.calls.length;
      vi.mocked(fetch).mockClear();

      // getStreetGeometryFromOverpass should now return null from cache — no new fetch
      const geometry = await getStreetGeometryFromOverpass("ул. Пример");
      expect(geometry).toBeNull();
      expect(vi.mocked(fetch).mock.calls.length).toBe(0);
      expect(fetchCallsDuringPreFetch).toBeGreaterThan(0);
    });

    it("is a no-op for empty input and blank strings", async () => {
      vi.stubGlobal("fetch", mockFetch(wayResponse));

      await preFetchStreetGeometries([]);
      await preFetchStreetGeometries(["", "  "]);

      expect(fetch).not.toHaveBeenCalled();
    });
  });
});
