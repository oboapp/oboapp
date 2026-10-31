import { describe, expect, it } from "vitest";
import { filterEventsByZones } from "@/lib/zone-event-filter";
import type {
  GeoJSONFeatureCollection,
  GeoJSONGeometry,
  Interest,
  Message,
} from "@/lib/types";

const home: Pick<Interest, "coordinates" | "radius"> = {
  coordinates: { lat: 0, lng: 0 },
  radius: 1000,
};

function collection(...geometries: GeoJSONGeometry[]): GeoJSONFeatureCollection {
  return {
    type: "FeatureCollection",
    features: geometries.map((geometry) => {
      return { type: "Feature", properties: {}, geometry };
    }),
  };
}

function point(longitude: number, latitude: number): GeoJSONGeometry {
  return { type: "Point", coordinates: [longitude, latitude] };
}

function event(
  id: string,
  geoJson?: GeoJSONFeatureCollection,
  overrides: Partial<Message> = {},
): Message {
  return {
    id,
    text: id,
    createdAt: "2026-10-29T00:00:00.000Z",
    locality: "bg.sofia",
    geoJson,
    ...overrides,
  };
}

function square(size: number): [number, number][] {
  return [
    [-size, -size],
    [size, -size],
    [size, size],
    [-size, size],
    [-size, -size],
  ];
}

describe("filterEventsByZones", () => {
  it("matches the actual zone circle and excludes points in bounding-box corners", () => {
    const inside = event("inside", collection(point(0.005, 0)));
    const corner = event("corner", collection(point(0.008, 0.008)));
    const outside = event("outside", collection(point(0.02, 0)));

    expect(filterEventsByZones([inside, corner, outside], [home])).toEqual([
      inside,
    ]);
  });

  it("honors each saved radius in meters at the minimum and maximum zone sizes", () => {
    const insideSmallZone = event("near", collection(point(0.0008, 0)));
    const outsideSmallZone = event("farther", collection(point(0.001, 0)));
    const events = [insideSmallZone, outsideSmallZone];

    expect(filterEventsByZones(events, [{ ...home, radius: 100 }])).toEqual([
      insideSmallZone,
    ]);
    expect(filterEventsByZones(events, [{ ...home, radius: 1000 }])).toEqual(
      events,
    );
  });

  it("matches crossing lines even when their endpoints are outside the zone", () => {
    const crossing = event(
      "crossing",
      collection({
        type: "LineString",
        coordinates: [[-0.1, 0], [0.1, 0]],
      }),
    );
    const corner = event(
      "corner",
      collection({
        type: "LineString",
        coordinates: [[0.008, 0.012], [0.012, 0.008]],
      }),
    );

    expect(filterEventsByZones([crossing, corner], [home])).toEqual([crossing]);
  });

  it("matches enclosing polygons and respects polygon holes", () => {
    const enclosing = event(
      "enclosing",
      collection({ type: "Polygon", coordinates: [square(0.05)] }),
    );
    const hole = event(
      "hole",
      collection({ type: "Polygon", coordinates: [square(0.05), square(0.02)] }),
    );

    expect(filterEventsByZones([enclosing, hole], [home])).toEqual([enclosing]);
  });

  it("uses every point and feature instead of the event centroid", () => {
    const multiPoint = event(
      "multi-point",
      collection({ type: "MultiPoint", coordinates: [[0.5, 0.5], [0, 0]] }),
    );
    const multiFeature = event(
      "multi-feature",
      collection(point(0.5, 0.5), point(0, 0)),
    );

    expect(filterEventsByZones([multiPoint, multiFeature], [home])).toEqual([
      multiPoint,
      multiFeature,
    ]);
  });

  it("matches any saved zone and deduplicates IDs while preserving order and objects", () => {
    const work = { coordinates: { lat: 1, lng: 1 }, radius: 1000 };
    const first = event("first", collection(point(1, 1)));
    const second = event("second", collection(point(0, 0)));
    const duplicate = { ...first };

    const result = filterEventsByZones(
      [first, second, duplicate],
      [home, home, work],
    );

    expect(result).toEqual([first, second]);
    expect(result[0]).toBe(first);
    expect(result[1]).toBe(second);
  });

  it("keeps separate matching events that have no ID", () => {
    const first = event("first", collection(point(0, 0)), { id: undefined });
    const second = event("second", collection(point(0, 0)), { id: undefined });

    expect(filterEventsByZones([first, second], [home])).toEqual([first, second]);
  });

  it("uses locality boundaries for city-wide events even without event geometry", () => {
    const cityWide = event("city-wide", undefined, { cityWide: true });
    const misleadingGeometry = event(
      "city-wide-far-point",
      collection(point(1, 1)),
      { cityWide: true },
    );
    const boundaries = {
      "bg.sofia": collection({ type: "Polygon", coordinates: [square(0.05)] }),
    };

    expect(
      filterEventsByZones([cityWide, misleadingGeometry], [home], boundaries),
    ).toEqual([cityWide, misleadingGeometry]);
  });

  it("matches city-wide MultiPolygon boundaries using any valid polygon part", () => {
    const cityWide = event("city-wide", undefined, {
      cityWide: true,
      locality: "bg.sofia.oborishte",
    });
    const boundaries = {
      "bg.sofia.oborishte": {
        type: "FeatureCollection",
        features: [
          { type: "Feature", properties: {}, geometry: null },
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "MultiPolygon",
              coordinates: [
                [[]],
                [[[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]]],
                [square(0.05)],
              ],
            },
          },
        ],
      },
    };

    expect(filterEventsByZones([cityWide], [home], boundaries)).toEqual([
      cityWide,
    ]);
    expect(
      filterEventsByZones(
        [cityWide],
        [{ coordinates: { lat: 3, lng: 3 }, radius: 1000 }],
        boundaries,
      ),
    ).toEqual([]);
  });

  it.each([null, undefined])(
    "matches locality boundaries when properties are %j",
    (properties) => {
      const cityWide = event("city-wide", undefined, { cityWide: true });
      const boundaries = {
        "bg.sofia": {
          type: "FeatureCollection",
          features: [{
            type: "Feature",
            geometry: { type: "Polygon", coordinates: [square(0.05)] },
            ...(properties === undefined ? {} : { properties }),
          }],
        },
      };

      expect(filterEventsByZones([cityWide], [home], boundaries)).toEqual([
        cityWide,
      ]);
    },
  );

  it("excludes unsupported boundary geometry and malformed feature collections", () => {
    const cityWide = event("city-wide", undefined, { cityWide: true });
    const unsupported = {
      "bg.sofia": {
        type: "FeatureCollection",
        features: [{
          type: "Feature",
          properties: {},
          geometry: { type: "GeometryCollection", geometries: [point(0, 0)] },
        }],
      },
    };

    expect(filterEventsByZones([cityWide], [home], unsupported)).toEqual([]);
    expect(filterEventsByZones([cityWide], [home], { "bg.sofia": null })).toEqual(
      [],
    );
  });

  it("excludes city-wide events whose locality does not intersect a saved zone", () => {
    const cityWide = event("city-wide", collection(point(0, 0)), {
      cityWide: true,
    });
    const boundaries = { "bg.sofia": collection(point(1, 1)) };

    expect(filterEventsByZones([cityWide], [home], boundaries)).toEqual([]);
    expect(filterEventsByZones([cityWide], [home])).toEqual([]);
    expect(
      filterEventsByZones([cityWide], [home], {
        "bg.other": collection(point(0, 0)),
      }),
    ).toEqual([]);
  });

  it("returns no events when there are no zones or matching geometries", () => {
    const matching = event("matching", collection(point(0, 0)));
    const missing = event("missing");
    const empty = event("empty", collection());

    expect(filterEventsByZones([matching], [])).toEqual([]);
    expect(filterEventsByZones([missing, empty], [home])).toEqual([]);
  });

  it.each<GeoJSONGeometry>([
    point(Number.NaN, 0),
    point(0, Number.POSITIVE_INFINITY),
    point(181, 0),
    { type: "LineString", coordinates: [[0, 0]] },
    { type: "Polygon", coordinates: [[]] },
    { type: "Polygon", coordinates: [[[-1, -1], [1, -1], [1, 1], [-1, 1]]] },
  ])("excludes malformed geometry: %j", (geometry) => {
    expect(
      filterEventsByZones([event("invalid", collection(geometry))], [home]),
    ).toEqual([]);
  });

  it("skips malformed features without dropping a valid feature in the same event", () => {
    const malformed: GeoJSONFeatureCollection = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: {}, geometry: null },
        ...collection(point(0, 0)).features,
      ],
    } as unknown as GeoJSONFeatureCollection;
    const mixed = event("mixed", malformed);

    expect(filterEventsByZones([mixed], [home])).toEqual([mixed]);
  });

  it("ignores invalid zone coordinates and radii", () => {
    const matching = event("matching", collection(point(0, 0)));
    const invalidZones = [
      { coordinates: { lat: Number.NaN, lng: 0 }, radius: 1000 },
      { coordinates: { lat: 91, lng: 0 }, radius: 1000 },
      { coordinates: { lat: 0, lng: 0 }, radius: 0 },
      { coordinates: { lat: 0, lng: 0 }, radius: -1000 },
      { coordinates: { lat: 0, lng: 0 }, radius: Number.POSITIVE_INFINITY },
    ];

    expect(filterEventsByZones([matching], invalidZones)).toEqual([]);
    expect(filterEventsByZones([matching], [...invalidZones, home])).toEqual([
      matching,
    ]);
  });
});
