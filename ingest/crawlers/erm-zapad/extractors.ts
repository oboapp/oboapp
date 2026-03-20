import { roundCoordinate } from "@/geocoding/shared/coordinate-utils";
import type { PinRecord, RawIncident } from "./types";

/**
 * Extract pin record from incident center point
 * The incident.points field contains polygon vertices for map visualization, not customer locations
 */
export function extractPinRecords(incident: RawIncident): PinRecord[] {
  const centerLat = Number.parseFloat(incident.lat);
  const centerLon = Number.parseFloat(incident.lon);

  if (Number.isNaN(centerLat) || Number.isNaN(centerLon)) {
    return [];
  }

  return [
    {
      lat: roundCoordinate(centerLat, 6),
      lon: roundCoordinate(centerLon, 6),
      eventId: incident.ceo,
      typedist: incident.typedist,
      begin_event: incident.begin_event,
      end_event: incident.end_event,
      city_name: incident.city_name,
      cities: incident.cities,
    },
  ];
}
