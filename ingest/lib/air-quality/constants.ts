/**
 * Air quality monitoring constants.
 */

/** sensor.community API endpoint. Coordinates: south,west,north,east */
export const SENSOR_COMMUNITY_API_URL =
  "https://data.sensor.community/airrohr/v1/filter/area=";

/** Target grid cell size in kilometers */
export const CELL_SIZE_KM = 4;

/**
 * Approximate degrees per km at mid-latitudes (~42.7° for Sofia).
 * Latitude: 1° ≈ 111 km (constant)
 * Longitude: 1° ≈ 111 × cos(lat) km (varies with latitude)
 */
export const KM_PER_DEGREE_LAT = 111.0;

/** Hard cap for PM values — readings above this are from malfunctioning sensors */
export const PM_HARD_CAP = 999.9;

/** EAQI threshold for immediate alert (single window) — 5 = Very Poor */
export const AQI_IMMEDIATE_THRESHOLD = 5;

/** EAQI threshold for sustained alert (both non-overlapping halves must exceed) — 4 = Poor */
export const AQI_SUSTAINED_THRESHOLD = 4;

/** Total evaluation window in hours */
export const EVALUATION_WINDOW_HOURS = 4;

/** Each non-overlapping half in hours */
export const HALF_WINDOW_HOURS = EVALUATION_WINDOW_HOURS / 2;

/** Data retention period in hours */
export const DATA_RETENTION_HOURS = 24;

/** Minimum number of sensors per grid cell AFTER outlier filtering */
export const MIN_SENSORS_PER_CELL = 3;

/** Minimum NowCast weight factor (floor) */
export const NOWCAST_MIN_WEIGHT = 0.5;

/** Minimum fraction of hours that must have data for a reliable NowCast computation */
export const MIN_HOUR_COVERAGE = 0.5;

/** Dedup window: 30 minutes in milliseconds */
export const DEDUP_WINDOW_MS = 1_800_000;

/** Maximum staleness: skip cell if newest reading in current half is older than this (ms) */
export const MAX_STALENESS_MS = 45 * 60 * 1000;

/** Source type identifier */
export const SOURCE_TYPE = "sensor-community";
