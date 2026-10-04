import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

// Explicit inventory: new implementations must add an actual crawl contract suite.
const sources = [
  "erm-zapad", "inspectorat-so-org", "krasna-polyana-org", "lozenets-sofia-bg", "mladost-bg",
  "nadezhda-org", "nimh-severe-weather", "raioniskar-bg", "rayon-ilinden-bg", "rayon-oborishte-bg",
  "rayon-pancharevo-bg", "sdvr-mvr-bg", "sensor-community", "serdika-egov-bg", "so-slatina-org",
  "sofia-bg", "sofia-capital-of-sport", "sofiyska-voda", "sredec-sofia-org", "studentski-bg",
  "toplo-bg", "triaditsa-org", "vrabnitsa-org",
];

it("covers every crawler directory, including sources not selected by this instance", () => {
  const root = join(__dirname, "..");
  const directories = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory() && entry.name !== "shared").map((entry) => entry.name);
  expect(directories.sort()).toEqual([...sources].sort());
  for (const source of sources) {
    const suite = source === "sofia-bg" ? "index.test.ts" : "index.contract.test.ts";
    expect(existsSync(join(root, source, suite)), `${source}: missing crawl contract`).toBe(true);
  }
});
