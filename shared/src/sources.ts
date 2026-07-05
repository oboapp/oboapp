export type { SourceDefinition } from "./source-definition";

// ─────────────────────────────────────────────────────────────────────────────
// INSTANCE ASSEMBLY — replace this file in your fork
// ─────────────────────────────────────────────────────────────────────────────
// When you fork oboapp for your city:
//   1. Replace this file with your own assembly.
//   2. Import the source definition files relevant to your deployment.
//   3. Add any city-specific sources that live only in your fork.
//
// See docs/setup/new-locality-instance.md for the full guide.
import rayonOborishte from "./sources/rayon-oborishte-bg";
import sofiyskavoda from "./sources/sofiyska-voda";
import toploBg from "./sources/toplo-bg";
import sofiaBg from "./sources/sofia-bg";
import ermZapad from "./sources/erm-zapad";
import mladostBg from "./sources/mladost-bg";
import studentskiBg from "./sources/studentski-bg";
import sredecSofiaOrg from "./sources/sredec-sofia-org";
import soSlatinaOrg from "./sources/so-slatina-org";
import nimhSevereWeather from "./sources/nimh-severe-weather";
import lozenets from "./sources/lozenets-sofia-bg";
import raioniskarBg from "./sources/raioniskar-bg";
import rayonPancharevo from "./sources/rayon-pancharevo-bg";
import rayonIlinden from "./sources/rayon-ilinden-bg";
import triaditsaOrg from "./sources/triaditsa-org";
import krasnaPolyanaOrg from "./sources/krasna-polyana-org";
import vrabnitsa from "./sources/vrabnitsa-org";
import nadezhda from "./sources/nadezhda-org";
import inspectoratSo from "./sources/inspectorat-so-org";
import sofiaCapitalOfSport from "./sources/sofia-capital-of-sport";
import serdikaEgovBg from "./sources/serdika-egov-bg";
import sdvrMvrBg from "./sources/sdvr-mvr-bg";

export const SOURCES = [
  rayonOborishte,
  sofiyskavoda,
  toploBg,
  sofiaBg,
  ermZapad,
  mladostBg,
  studentskiBg,
  sredecSofiaOrg,
  soSlatinaOrg,
  nimhSevereWeather,
  lozenets,
  raioniskarBg,
  rayonPancharevo,
  rayonIlinden,
  triaditsaOrg,
  krasnaPolyanaOrg,
  vrabnitsa,
  nadezhda,
  inspectoratSo,
  sofiaCapitalOfSport,
  serdikaEgovBg,
  sdvrMvrBg,
] as const;

/**
 * Source IDs passed to `pipeline --emergent` (the legacy ingest pipeline path).
 * Derived from the `emergent` flag on each source in this SOURCES assembly.
 * Note: Terraform scheduling is independent — it uses `emergent = true` in
 * the crawler's Terraform entry, not this list.
 */
export const EMERGENT_CRAWLERS: readonly string[] = SOURCES.filter(
  (s) => s.emergent,
).map((s) => s.id);
