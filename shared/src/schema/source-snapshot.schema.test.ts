import { describe, expect, it } from "vitest";
import {
  SourceIncidentSchema,
  SourceSnapshotSchema,
} from "./source-snapshot.schema";

const observation = {
  sourceType: "toplo-bg",
  locality: "bg.sofia",
  count: 0,
  observedAt: "2026-11-11T15:00:00.000Z",
};

const incident = {
  id: "incident-one",
  accidentId: "accident-one",
  name: "Яворов",
  addresses: "Цар Иван Асен II 42",
  type: "accident" as const,
  status: 1,
  reportedStart: "2026-11-11T14:00:00Z",
  estimatedEnd: "2026-11-12T20:00:00Z",
  createdAt: null,
};

describe("SourceSnapshotSchema", () => {
  it("preserves count-only observations and complete empty listings", () => {
    expect(SourceSnapshotSchema.parse(observation)).toEqual(observation);
    expect(SourceSnapshotSchema.parse({
      ...observation,
      incidents: [],
    })).toEqual({ ...observation, incidents: [] });
  });

  it("preserves a complete listing and nullable incident timestamps", () => {
    const snapshot = { ...observation, count: 1, incidents: [incident] };

    expect(SourceSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(SourceIncidentSchema.parse({
      ...incident,
      type: "repair",
      reportedStart: null,
      estimatedEnd: null,
    })).toMatchObject({
      type: "repair",
      reportedStart: null,
      estimatedEnd: null,
      createdAt: null,
    });
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects an invalid count: %s",
    (count) => {
      expect(SourceSnapshotSchema.safeParse({
        ...observation,
        count,
      }).success).toBe(false);
    },
  );

  it.each([
    { sourceType: "" },
    { locality: "" },
    { observedAt: "2026-11-09" },
    { observedAt: "2026-11-09T19:30:00" },
    { observedAt: "invalid" },
  ])("rejects invalid observation fields: %j", (fields) => {
    expect(SourceSnapshotSchema.safeParse({
      ...observation,
      ...fields,
    }).success).toBe(false);
  });

  it.each([
    { id: "" },
    { accidentId: "" },
    { name: "" },
    { type: "unknown" },
    { status: -1 },
    { status: 0.5 },
    { reportedStart: "invalid" },
    { estimatedEnd: "2026-02-30T00:00:00Z" },
    { createdAt: "2026-11-11T14:00:00" },
  ])("rejects invalid incident fields: %j", (fields) => {
    expect(SourceSnapshotSchema.safeParse({
      ...observation,
      count: 1,
      incidents: [{ ...incident, ...fields }],
    }).success).toBe(false);
  });

  it("rejects a listing whose size differs from its count", () => {
    expect(SourceSnapshotSchema.safeParse({
      ...observation,
      count: 2,
      incidents: [incident],
    }).success).toBe(false);
  });

  it.each([
    { id: incident.id, accidentId: "another-accident" },
    { id: "another-incident", accidentId: incident.accidentId },
  ])("rejects duplicate incident identities: %j", (identities) => {
    expect(SourceSnapshotSchema.safeParse({
      ...observation,
      count: 2,
      incidents: [incident, { ...incident, ...identities }],
    }).success).toBe(false);
  });
});
