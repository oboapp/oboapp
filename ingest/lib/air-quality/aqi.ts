/**
 * EAQI calculation utilities — re-exported from @oboapp/shared.
 *
 * The pure math lives in shared so both ingest and web can use it.
 */
export {
  calculateNowCastAqi,
  getAqiLabel,
  getAqiCategory,
} from "@oboapp/shared";
export type { HourlyAverage } from "@oboapp/shared";
