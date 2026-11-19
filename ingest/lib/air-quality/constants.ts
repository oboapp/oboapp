/**
 * Air quality monitoring constants.
 */

/** sensor.community API endpoint. Coordinates: south,west,north,east */
export const SENSOR_COMMUNITY_API_URL =
  "https://data.sensor.community/airrohr/v1/filter/area=";

/** Hard cap for PM values — readings above this are from malfunctioning sensors */
export const PM_HARD_CAP = 999.9;

/** Data retention period in hours */
export const DATA_RETENTION_HOURS = 24;

/** Source type identifier */
export const SOURCE_TYPE = "sensor-community";
