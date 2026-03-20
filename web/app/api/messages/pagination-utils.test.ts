import { describe, it, expect } from "vitest";
import { toTimestamp, paginateCandidateDocs } from "./pagination-utils";

// ---------------------------------------------------------------------------
// toTimestamp
// ---------------------------------------------------------------------------

describe("toTimestamp", () => {
  it("converts a Date object", () => {
    const d = new Date("2026-01-10T10:00:00.000Z");
    expect(toTimestamp(d)).toBe(d.getTime());
  });

  it("converts an ISO string", () => {
    expect(toTimestamp("2026-01-10T10:00:00.000Z")).toBe(
      new Date("2026-01-10T10:00:00.000Z").getTime(),
    );
  });

  it("returns null for an unparseable string", () => {
    expect(toTimestamp("not-a-date")).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(toTimestamp(undefined)).toBeNull();
  });

  it("treats null as missing — same as undefined", () => {
    expect(toTimestamp(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function makeDoc(
  id: string,
  finalizedAt: Date,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return { _id: id, finalizedAt, ...extra };
}

const allPass = () => true;

// ---------------------------------------------------------------------------
// paginateCandidateDocs — basic filtering & ordering
// ---------------------------------------------------------------------------

describe("paginateCandidateDocs — basic filtering and ordering", () => {
  it("returns all docs when there are fewer than pageSize", () => {
    const docs = [
      makeDoc("b", new Date("2026-01-02T00:00:00Z")),
      makeDoc("a", new Date("2026-01-01T00:00:00Z")),
    ];
    const { pageDocs, hasMore, boundaryDoc } = paginateCandidateDocs(
      docs,
      null,
      allPass,
      12,
      500,
    );
    expect(pageDocs).toHaveLength(2);
    expect(hasMore).toBe(false);
    expect(boundaryDoc).toBeUndefined();
  });

  it("applies the isCandidate predicate", () => {
    const docs = [
      makeDoc("a", new Date("2026-01-02T00:00:00Z"), { flag: true }),
      makeDoc("b", new Date("2026-01-01T00:00:00Z"), { flag: false }),
      makeDoc("c", new Date("2025-12-31T00:00:00Z"), { flag: true }),
    ];
    const { pageDocs } = paginateCandidateDocs(
      docs,
      null,
      (doc) => doc.flag === true,
      12,
      500,
    );
    expect(pageDocs.map((d) => d._id)).toEqual(["a", "c"]);
  });

  it("skips docs with invalid finalizedAt", () => {
    const docs = [
      makeDoc("good", new Date("2026-01-02T00:00:00Z")),
      { _id: "bad", finalizedAt: "not-a-date" },
    ];
    const { pageDocs } = paginateCandidateDocs(docs, null, allPass, 12, 500);
    expect(pageDocs.map((d) => d._id)).toEqual(["good"]);
  });

  it("sorts docs within a same-timestamp bucket by _id descending", () => {
    const ts = new Date("2026-01-01T00:00:00Z");
    // Intentionally unsorted to verify the bucket sort
    const docs = [
      makeDoc("msg-b", ts),
      makeDoc("msg-a", ts),
      makeDoc("msg-c", ts),
    ];
    const { pageDocs } = paginateCandidateDocs(docs, null, allPass, 12, 500);
    expect(pageDocs.map((d) => d._id)).toEqual(["msg-c", "msg-b", "msg-a"]);
  });
});

// ---------------------------------------------------------------------------
// paginateCandidateDocs — cursor filtering
// ---------------------------------------------------------------------------

describe("paginateCandidateDocs — cursor filtering", () => {
  it("includes docs strictly older than the cursor date", () => {
    const pivot = new Date("2026-01-05T00:00:00Z");
    const docs = [
      makeDoc("newer", new Date("2026-01-06T00:00:00Z")),
      makeDoc("older", new Date("2026-01-04T00:00:00Z")),
    ];
    const cursor = { date: pivot, id: "any-id" };
    const { pageDocs } = paginateCandidateDocs(docs, cursor, allPass, 12, 500);
    expect(pageDocs.map((d) => d._id)).toEqual(["older"]);
  });

  it("excludes docs newer than the cursor date", () => {
    const pivot = new Date("2026-01-05T00:00:00Z");
    const docs = [makeDoc("newer", new Date("2026-01-06T00:00:00Z"))];
    const cursor = { date: pivot, id: "any-id" };
    const { pageDocs } = paginateCandidateDocs(docs, cursor, allPass, 12, 500);
    expect(pageDocs).toHaveLength(0);
  });

  it("uses _id as tie-breaker for same-timestamp docs", () => {
    const ts = new Date("2026-01-05T00:00:00Z");
    const docs = [
      makeDoc("msg-c", ts),
      makeDoc("msg-b", ts),
      makeDoc("msg-a", ts),
    ];
    // Cursor is at msg-b — only msg-a (localeCompare < "msg-b") should come through
    const cursor = { date: ts, id: "msg-b" };
    const { pageDocs } = paginateCandidateDocs(docs, cursor, allPass, 12, 500);
    expect(pageDocs.map((d) => d._id)).toEqual(["msg-a"]);
  });
});

// ---------------------------------------------------------------------------
// paginateCandidateDocs — pagination and hasMore
// ---------------------------------------------------------------------------

describe("paginateCandidateDocs — pagination and hasMore", () => {
  it("sets hasMore and boundaryDoc when candidates exceed pageSize", () => {
    const start = new Date("2026-01-20T00:00:00Z").getTime();
    const docs = Array.from({ length: 14 }, (_, i) =>
      makeDoc(
        `msg-${String(i).padStart(3, "0")}`,
        new Date(start - i * 60_000),
      ),
    );
    const { pageDocs, hasMore, boundaryDoc } = paginateCandidateDocs(
      docs,
      null,
      allPass,
      12,
      500,
    );
    expect(pageDocs).toHaveLength(12);
    expect(hasMore).toBe(true);
    expect(boundaryDoc?._id).toBe("msg-011");
  });

  it("sets hasMore when fetchedDocs length equals fetchLimit", () => {
    const start = new Date("2026-01-20T00:00:00Z").getTime();
    // 3 docs returned == fetchLimit of 3 → hasMore should be true
    const docs = Array.from({ length: 3 }, (_, i) =>
      makeDoc(`msg-${i}`, new Date(start - i * 60_000)),
    );
    const { hasMore } = paginateCandidateDocs(docs, null, allPass, 12, 3);
    expect(hasMore).toBe(true);
  });

  it("returns hasMore false and no boundaryDoc when results fit in one page", () => {
    const docs = [
      makeDoc("a", new Date("2026-01-02T00:00:00Z")),
      makeDoc("b", new Date("2026-01-01T00:00:00Z")),
    ];
    const { hasMore, boundaryDoc } = paginateCandidateDocs(
      docs,
      null,
      allPass,
      12,
      500,
    );
    expect(hasMore).toBe(false);
    expect(boundaryDoc).toBeUndefined();
  });

  it("produces non-overlapping pages across multiple fetches", () => {
    const start = new Date("2026-01-20T00:00:00Z").getTime();
    const allDocs = Array.from({ length: 20 }, (_, i) =>
      makeDoc(
        `msg-${String(i).padStart(3, "0")}`,
        new Date(start - i * 60_000),
      ),
    );
    const PAGE_SIZE = 12;
    const FETCH_LIMIT = 500;

    const page1 = paginateCandidateDocs(
      allDocs,
      null,
      allPass,
      PAGE_SIZE,
      FETCH_LIMIT,
    );
    expect(page1.pageDocs).toHaveLength(PAGE_SIZE);
    expect(page1.hasMore).toBe(true);

    const cursor = {
      date: page1.boundaryDoc!.finalizedAt as Date,
      id: String(page1.boundaryDoc!._id),
    };

    // Simulate the DB returning only docs at-or-before the cursor date
    const filteredDocs = allDocs.filter(
      (d) => (d.finalizedAt as Date).getTime() <= cursor.date.getTime(),
    );

    const page2 = paginateCandidateDocs(
      filteredDocs,
      cursor,
      allPass,
      PAGE_SIZE,
      FETCH_LIMIT,
    );
    expect(page2.pageDocs).toHaveLength(8);
    expect(page2.hasMore).toBe(false);

    const page1Ids = page1.pageDocs.map((d) => d._id);
    const page2Ids = page2.pageDocs.map((d) => d._id);
    expect(page1Ids.filter((id) => page2Ids.includes(id))).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// paginateCandidateDocs — boundaryDoc when hitFetchLimit
// ---------------------------------------------------------------------------

describe("paginateCandidateDocs — boundaryDoc when hitting fetchLimit", () => {
  it("picks the lowest _id within the oldest-timestamp bucket", () => {
    const oldTs = new Date("2026-01-01T00:00:00Z");
    // All docs are candidates; fetchLimit = 4 = docs.length, triggering hitFetchLimit path
    const docs = [
      makeDoc("msg-newer", new Date("2026-01-02T00:00:00Z")),
      makeDoc("msg-c", oldTs),
      makeDoc("msg-a", oldTs),
      makeDoc("msg-b", oldTs),
    ];
    const { boundaryDoc, hasMore } = paginateCandidateDocs(
      docs,
      null,
      allPass,
      12, // pageSize > docs — hasMoreCandidates will be false
      4, // fetchLimit == docs.length → hitFetchLimit
    );
    expect(hasMore).toBe(true);
    // Lowest _id in the oldest bucket (msg-a < msg-b < msg-c)
    expect(boundaryDoc?._id).toBe("msg-a");
  });

  it("ignores docs with invalid finalizedAt when computing boundary", () => {
    const validTs = new Date("2026-01-01T00:00:00Z");
    const docs = [
      makeDoc("valid", validTs),
      { _id: "invalid", finalizedAt: "not-a-date" },
    ];
    const { boundaryDoc, hasMore } = paginateCandidateDocs(
      docs,
      null,
      allPass,
      12,
      2, // fetchLimit == docs.length
    );
    expect(hasMore).toBe(true);
    expect(boundaryDoc?._id).toBe("valid");
  });
});
