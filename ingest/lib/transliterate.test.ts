import { describe, expect, it } from "vitest";
import { transliterate } from "./transliterate";

describe("transliterate", () => {
  it("transliterates single Cyrillic characters", () => {
    expect(transliterate("А")).toBe("A");
    expect(transliterate("Б")).toBe("B");
    expect(transliterate("В")).toBe("V");
  });

  it("transliterates multi-char mappings", () => {
    expect(transliterate("Ж")).toBe("ZH");
    expect(transliterate("Ц")).toBe("TS");
    expect(transliterate("Ч")).toBe("CH");
    expect(transliterate("Ш")).toBe("SH");
    expect(transliterate("Щ")).toBe("SHT");
    expect(transliterate("Ю")).toBe("YU");
    expect(transliterate("Я")).toBe("YA");
  });

  it("maps Ъ to A per Bulgarian Streamlined System", () => {
    expect(transliterate("Ъ")).toBe("A");
    expect(transliterate("ъ")).toBe("a");
  });

  it("preserves case — lowercase input produces lowercase output", () => {
    expect(transliterate("а")).toBe("a");
    expect(transliterate("ж")).toBe("zh");
    expect(transliterate("щ")).toBe("sht");
    expect(transliterate("ю")).toBe("yu");
  });

  it("preserves case — uppercase input produces fully uppercase output", () => {
    expect(transliterate("Ж")).toBe("ZH");
    expect(transliterate("Щ")).toBe("SHT");
    expect(transliterate("Ю")).toBe("YU");
  });

  it("transliterates full district names correctly", () => {
    expect(transliterate("НАДЕЖДА")).toBe("NADEZHDA");
    expect(transliterate("ВРЪБНИЦА")).toBe("VRABNITSA");
    expect(transliterate("ВИТОША")).toBe("VITOSHA");
    expect(transliterate("ОВЧА КУПЕЛ")).toBe("OVCHA KUPEL");
    expect(transliterate("ЛЮЛИН")).toBe("LYULIN");
    expect(transliterate("ПАНЧАРЕВО")).toBe("PANCHAREVO");
    expect(transliterate("КРЕМИКОВЦИ")).toBe("KREMIKOVTSI");
    expect(transliterate("ВЪЗРАЖДАНЕ")).toBe("VAZRAZHDANE");
    expect(transliterate("ТРИАДИЦА")).toBe("TRIADITSA");
    expect(transliterate("КРАСНА ПОЛЯНА")).toBe("KRASNA POLYANA");
    expect(transliterate("КРАСНО СЕЛО")).toBe("KRASNO SELO");
  });

  it("passes through non-Cyrillic characters unchanged", () => {
    expect(transliterate("abc")).toBe("abc");
    expect(transliterate("123")).toBe("123");
    expect(transliterate("hello world")).toBe("hello world");
    expect(transliterate("-")).toBe("-");
  });

  it("handles mixed Cyrillic and non-Cyrillic characters", () => {
    expect(transliterate("РАЙОН 1")).toBe("RAYON 1");
  });

  it("handles empty string", () => {
    expect(transliterate("")).toBe("");
  });
});
