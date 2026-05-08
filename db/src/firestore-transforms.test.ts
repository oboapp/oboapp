import { describe, it, expect } from "vitest";
import {
  transformForFirestoreWrite,
  transformFromFirestoreRead,
} from "./firestore-transforms";

describe("transformForFirestoreWrite", () => {
  it("stringifies geoJson for messages collection", () => {
    const data = {
      text: "hello",
      geoJson: { type: "FeatureCollection", features: [] },
    };
    const result = transformForFirestoreWrite("messages", data);
    expect(result.geoJson).toBe('{"type":"FeatureCollection","features":[]}');
    expect(result.text).toBe("hello");
  });

  it("stringifies addresses for messages collection", () => {
    const data = {
      text: "hello",
      addresses: [{ street: "Main St" }],
    };
    const result = transformForFirestoreWrite("messages", data);
    expect(result.addresses).toBe('[{"street":"Main St"}]');
  });

  it("does NOT stringify null geoJson", () => {
    const data = { text: "hello", geoJson: null };
    const result = transformForFirestoreWrite("messages", data);
    expect(result.geoJson).toBeNull();
  });

  it("does NOT stringify string geoJson (already a string)", () => {
    const data = { text: "hello", geoJson: "already-string" };
    const result = transformForFirestoreWrite("messages", data);
    expect(result.geoJson).toBe("already-string");
  });

  it("strips undefined values", () => {
    const data = { text: "hello", missing: undefined };
    const result = transformForFirestoreWrite("messages", data);
    expect(result).toEqual({ text: "hello" });
    expect("missing" in result).toBe(false);
  });

  it("stringifies geoJson for events collection", () => {
    const data = {
      plainText: "hello",
      geoJson: { type: "FeatureCollection", features: [] },
    };
    const result = transformForFirestoreWrite("events", data);
    expect(result.geoJson).toBe('{"type":"FeatureCollection","features":[]}');
    expect(result.plainText).toBe("hello");
  });

  it("stringifies geoJson for sources collection", () => {
    const data = {
      geoJson: { type: "FeatureCollection", features: [] },
      name: "test",
    };
    const result = transformForFirestoreWrite("sources", data);
    expect(result.geoJson).toBe('{"type":"FeatureCollection","features":[]}');
    expect(result.name).toBe("test");
  });

  it("does NOT stringify fields for unknown collections", () => {
    const data = {
      geoJson: { type: "FeatureCollection", features: [] },
      name: "test",
    };
    const result = transformForFirestoreWrite("notifications", data);
    expect(result.geoJson).toEqual({ type: "FeatureCollection", features: [] });
  });

  it("preserves primitive values unchanged", () => {
    const data = { count: 42, active: true, name: "test" };
    const result = transformForFirestoreWrite("messages", data);
    expect(result).toEqual({ count: 42, active: true, name: "test" });
  });
});

describe("transformFromFirestoreRead", () => {
  it("converts Firestore Timestamp objects (with toDate) to Date", () => {
    const date = new Date("2024-06-15T12:00:00Z");
    const data = {
      text: "hello",
      createdAt: { toDate: () => date },
    };
    const result = transformFromFirestoreRead("messages", data);
    expect(result.createdAt).toEqual(date);
    expect(result.createdAt).toBeInstanceOf(Date);
  });

  it("converts Firestore Timestamp objects (with _seconds) to Date", () => {
    const ts = Math.floor(new Date("2024-06-15T12:00:00Z").getTime() / 1000);
    const data = {
      text: "hello",
      createdAt: { _seconds: ts },
    };
    const result = transformFromFirestoreRead("messages", data);
    expect(result.createdAt).toBeInstanceOf(Date);
    expect((result.createdAt as Date).toISOString()).toBe(
      "2024-06-15T12:00:00.000Z",
    );
  });

  it("parses geoJson JSON string for messages collection", () => {
    const geoJson = { type: "FeatureCollection", features: [] };
    const data = {
      text: "hello",
      geoJson: JSON.stringify(geoJson),
    };
    const result = transformFromFirestoreRead("messages", data);
    expect(result.geoJson).toEqual(geoJson);
  });

  it("parses addresses JSON string for messages collection", () => {
    const addresses = [{ street: "Main St" }];
    const data = {
      text: "hello",
      addresses: JSON.stringify(addresses),
    };
    const result = transformFromFirestoreRead("messages", data);
    expect(result.addresses).toEqual(addresses);
  });

  it("parses ingestErrors JSON string for messages collection", () => {
    const errors = [{ code: "ERR_1", message: "fail" }];
    const data = {
      text: "hello",
      ingestErrors: JSON.stringify(errors),
    };
    const result = transformFromFirestoreRead("messages", data);
    expect(result.ingestErrors).toEqual(errors);
  });

  it("preserves invalid JSON strings as-is", () => {
    const data = {
      text: "hello",
      geoJson: "not-valid-json{",
    };
    const result = transformFromFirestoreRead("messages", data);
    expect(result.geoJson).toBe("not-valid-json{");
  });

  it("parses geoJson JSON string for events collection", () => {
    const geoJson = { type: "FeatureCollection", features: [] };
    const data = {
      plainText: "hello",
      geoJson: JSON.stringify(geoJson),
    };
    const result = transformFromFirestoreRead("events", data);
    expect(result.geoJson).toEqual(geoJson);
  });

  it("parses geoJson JSON string for sources collection", () => {
    const geoJson = { type: "FeatureCollection", features: [] };
    const data = {
      geoJson: JSON.stringify(geoJson),
    };
    const result = transformFromFirestoreRead("sources", data);
    expect(result.geoJson).toEqual(geoJson);
  });

  it("does NOT parse JSON strings for unknown collections", () => {
    const data = {
      geoJson: '{"type":"FeatureCollection"}',
    };
    const result = transformFromFirestoreRead("notifications", data);
    expect(result.geoJson).toBe('{"type":"FeatureCollection"}');
  });

  it("preserves Date instances as-is", () => {
    const date = new Date("2024-06-15T12:00:00Z");
    const data = { createdAt: date };
    const result = transformFromFirestoreRead("messages", data);
    expect(result.createdAt).toBe(date);
  });

  it("preserves non-timestamp primitives unchanged", () => {
    const data = { count: 42, active: true, name: "test" };
    const result = transformFromFirestoreRead("messages", data);
    expect(result).toEqual({ count: 42, active: true, name: "test" });
  });

  it("handles combined timestamps and JSON strings", () => {
    const date = new Date("2024-06-15T12:00:00Z");
    const geoJson = { type: "Point", coordinates: [23.3, 42.7] };
    const data = {
      text: "hello",
      createdAt: { toDate: () => date },
      geoJson: JSON.stringify(geoJson),
      count: 5,
    };
    const result = transformFromFirestoreRead("messages", data);
    expect(result.createdAt).toEqual(date);
    expect(result.geoJson).toEqual(geoJson);
    expect(result.count).toBe(5);
    expect(result.text).toBe("hello");
  });
});
