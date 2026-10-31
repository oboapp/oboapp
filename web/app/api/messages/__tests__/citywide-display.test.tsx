import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { GET } from "@/app/api/messages/route";
import MessagesGrid from "@/components/MessagesGrid";
import { filterEventsByZones } from "@/lib/zone-event-filter";
import type { InternalMessage } from "@/lib/types";

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("@/lib/db", () => ({
  getDb: async () => ({ messages: { findMany } }),
}));

let sofiaBoundary: unknown;

beforeAll(async () => {
  const boundaryPath = resolve(process.cwd(), "../ingest/localities/bg.sofia.geojson");
  sofiaBoundary = JSON.parse(await readFile(boundaryPath, "utf8"));
});

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_LOCALITY", "bg.sofia");
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("City-wide events from API to My zones cards", () => {
  it.each([
    { name: "missing geometry", fields: {} },
    { name: "null geometry", fields: { geoJson: null } },
    {
      name: "an empty feature collection",
      fields: { geoJson: { type: "FeatureCollection", features: [] } },
    },
  ])("displays a matching city-wide event with $name", async ({ fields }) => {
    const now = new Date();
    const cityWideRecord = {
      _id: "sofia-warning",
      text: "Sofia city-wide warning",
      cityWide: true,
      locality: "bg.sofia",
      createdAt: now,
      finalizedAt: now,
      timespanEnd: now,
      ...fields,
    };
    findMany.mockResolvedValue([
      cityWideRecord,
      {
        ...cityWideRecord,
        _id: "outside-warning",
        text: "Warning outside the saved zone",
        locality: "bg.other",
      },
    ]);

    const response = await GET(new Request(
      "http://localhost/api/messages?north=42.75&south=42.74&east=23.50&west=23.49",
    ));
    expect(response.status).toBe(200);
    const { messages } = await response.json() as { messages: InternalMessage[] };
    expect(messages).toHaveLength(2);

    const matched = filterEventsByZones(
      messages,
      [{ coordinates: { lat: 42.6977, lng: 23.3219 }, radius: 500 }],
      {
        "bg.sofia": sofiaBoundary,
        "bg.other": {
          type: "FeatureCollection",
          features: [{
            type: "Feature",
            properties: {},
            geometry: {
              type: "Polygon",
              coordinates: [[[24, 42], [25, 42], [25, 43], [24, 43], [24, 42]]],
            },
          }],
        },
      },
    );
    expect(matched.map((message) => message.id)).toEqual(["sofia-warning"]);

    render(
      <MessagesGrid
        messages={matched}
        isLoading={false}
        onMessageClick={vi.fn()}
        variant="list"
      />,
    );
    expect(screen.getByText("Sofia city-wide warning")).toBeVisible();
    expect(screen.queryByText("Warning outside the saved zone"))
      .not.toBeInTheDocument();
  });
});
