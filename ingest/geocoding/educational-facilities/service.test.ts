import { describe, it, expect, vi } from "vitest";

vi.mock("../../lib/firebase-admin", () => ({
  adminDb: vi.fn(),
}));

const { parseFacilityNumber } = await import("./service");

describe("parseFacilityNumber", () => {
  describe("object_nom takes priority", () => {
    it("returns string form of object_nom when it is a positive number", () => {
      expect(parseFacilityNumber(133, "ДГ №133 Зорница")).toBe("133");
    });

    it("returns string form of object_nom for a single-digit number", () => {
      expect(parseFacilityNumber(7, "7 ОУ Св. Седмочисленици")).toBe("7");
    });

    it("ignores object_nom of 0 and falls back to object_nam", () => {
      expect(parseFacilityNumber(0, "93 СУ Александър Теодоров")).toBe("93");
    });

    it("ignores negative object_nom and falls back to object_nam", () => {
      expect(parseFacilityNumber(-1, "93 СУ Александър Теодоров")).toBe("93");
    });
  });

  describe("fallback to leading digits in object_nam", () => {
    it("extracts leading number from a named school", () => {
      expect(parseFacilityNumber(null, '93 СУ "Александър Теодоров – Балан"')).toBe("93");
    });

    it("extracts leading number from a numbered kindergarten name", () => {
      expect(parseFacilityNumber(null, "29 ДГ Слънце")).toBe("29");
    });

    it("extracts multi-digit leading number", () => {
      expect(parseFacilityNumber(null, "133-та детска градина Зорница")).toBe("133");
    });
  });

  describe("returns null when no number is available", () => {
    it("returns null when object_nom is null and object_nam has no leading digits", () => {
      expect(parseFacilityNumber(null, "НГ по приложни изкуства „Св. Лука\"")).toBeNull();
    });

    it("returns null when both arguments are null", () => {
      expect(parseFacilityNumber(null, null)).toBeNull();
    });

    it("returns null when object_nom is not a number and object_nam has no leading digits", () => {
      expect(parseFacilityNumber("abc", "НГ по музикално изкуство")).toBeNull();
    });

    it("returns null when object_nam is an empty string", () => {
      expect(parseFacilityNumber(null, "")).toBeNull();
    });
  });
});
