import { describe, it, expect, vi } from "vitest";

// Mock firebase-admin to avoid requiring env vars
vi.mock("../../lib/firebase-admin", () => ({
  adminDb: vi.fn(),
}));

// Import after mocking
const { parseStopsFile } = await import("./service");

describe("parseStopsFile", () => {
  it("should parse valid GTFS stops.txt CSV", () => {
    const csvContent = `stop_id,stop_code,stop_name,stop_lat,stop_lon
1805_0,1805,Ул. 507,42.697123456789,23.321987654321
1064_0,1064,Ул. 503,42.684500000000,23.318800000000`;

    const result = parseStopsFile(csvContent);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      stopCode: "1805",
      stopName: "Ул. 507",
      lat: 42.697123, // Rounded to 6 decimals
      lng: 23.321988, // Rounded to 6 decimals
    });
    expect(result[1]).toEqual({
      stopCode: "1064",
      stopName: "Ул. 503",
      lat: 42.6845,
      lng: 23.3188,
    });
  });

  it("should skip stops without stop_code", () => {
    const csvContent = `stop_id,stop_code,stop_name,stop_lat,stop_lon
1805_0,,Ул. 507,42.697,23.321
1064_0,1064,Ул. 503,42.684,23.318`;

    const result = parseStopsFile(csvContent);

    expect(result).toHaveLength(1);
    expect(result[0].stopCode).toBe("1064");
  });

  it("should skip stops outside Sofia boundaries", () => {
    const csvContent = `stop_id,stop_code,stop_name,stop_lat,stop_lon
1805_0,1805,Ул. 507,42.697,23.321
9999_0,9999,Outside Sofia,51.5074,-0.1278`;

    const result = parseStopsFile(csvContent);

    expect(result).toHaveLength(1);
    expect(result[0].stopCode).toBe("1805");
  });

  it("should skip stops with invalid coordinates", () => {
    const csvContent = `stop_id,stop_code,stop_name,stop_lat,stop_lon
1805_0,1805,Ул. 507,42.697,23.321
1064_0,1064,Invalid,invalid,invalid
1234_0,1234,Missing,,`;

    const result = parseStopsFile(csvContent);

    expect(result).toHaveLength(1);
    expect(result[0].stopCode).toBe("1805");
  });

  it("should use stop_code as name if stop_name is missing", () => {
    const csvContent = `stop_id,stop_code,stop_name,stop_lat,stop_lon
1805_0,1805,,42.697,23.321`;

    const result = parseStopsFile(csvContent);

    expect(result).toHaveLength(1);
    expect(result[0].stopName).toBe("1805");
  });

  it("should handle empty CSV", () => {
    const csvContent = `stop_id,stop_code,stop_name,stop_lat,stop_lon`;

    const result = parseStopsFile(csvContent);

    expect(result).toHaveLength(0);
  });

  it("should round coordinates to exactly 6 decimal places", () => {
    const csvContent = `stop_id,stop_code,stop_name,stop_lat,stop_lon
1_0,0001,Test,42.697123456789,23.321987654321`;

    const result = parseStopsFile(csvContent);

    expect(result).toHaveLength(1);
    expect(result[0].lat).toBe(42.697123);
    expect(result[0].lng).toBe(23.321988);
  });

  it("should trim whitespace from stop_code and stop_name", () => {
    const csvContent = `stop_id,stop_code,stop_name,stop_lat,stop_lon
1805_0,  1805  ,  Ул. 507  ,42.697,23.321`;

    const result = parseStopsFile(csvContent);

    expect(result).toHaveLength(1);
    expect(result[0].stopCode).toBe("1805");
    expect(result[0].stopName).toBe("Ул. 507");
  });
});
