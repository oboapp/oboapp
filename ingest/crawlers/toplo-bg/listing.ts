import { SourceIncidentSchema, type SourceIncident } from "@oboapp/shared";

function nullableDate(value: unknown): string | null {
  const date = SourceIncidentSchema.shape.reportedStart.safeParse(value);
  return date.success ? date.data : null;
}

function incidentName(info: object, id: string): string {
  for (const field of ["Name", "Region"]) {
    const value: unknown = Reflect.get(info, field);
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return id;
}

function parseIncident(json: string): SourceIncident {
  const info: unknown = JSON.parse(json);

  if (
    typeof info !== "object" ||
    info === null ||
    !("AccidentId" in info) ||
    typeof info.AccidentId !== "string" ||
    info.AccidentId.trim().length === 0 ||
    !("ContentItemId" in info) ||
    typeof info.ContentItemId !== "string" ||
    info.ContentItemId.trim().length === 0
  ) {
    throw new Error("Toplo listing contains an incident without a valid identity");
  }

  if (!("Type" in info) || (info.Type !== 0 && info.Type !== 1)) {
    throw new Error("Toplo listing contains an unknown incident type");
  }
  return SourceIncidentSchema.parse({
    id: info.ContentItemId,
    accidentId: info.AccidentId,
    name: incidentName(info, info.ContentItemId),
    addresses: Reflect.get(info, "Addresses") ?? "",
    type: info.Type === 0 ? "accident" : "repair",
    status: Reflect.get(info, "Status"),
    reportedStart: nullableDate(Reflect.get(info, "FromDate")),
    estimatedEnd: nullableDate(Reflect.get(info, "UntilDate")),
    createdAt: nullableDate(Reflect.get(info, "CreatedOn")),
  });
}

function readListedIds(html: string): Set<string> {
  const listedIds = new Set<string>();

  for (const [tag] of html.matchAll(/<li\b[^>]*>/gi)) {
    const classes = /\sclass\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (!classes?.split(/\s+/).includes("accident-container")) {
      continue;
    }

    const id = /\sdata-accidentid\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (!id?.trim()) {
      throw new Error("Toplo listing contains a row without an incident ID");
    }

    listedIds.add(id);
  }

  return listedIds;
}

/** Read the complete source listing before geometry or ingestion filtering. */
export function parseListingIncidents(html: string): SourceIncident[] {
  const scripts = html.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi);
  const incidentScript = scripts?.find((script) => {
    return script.includes("function parseAll()");
  });

  if (
    !incidentScript ||
    !html.includes("accident-list-homepage") ||
    !/\sid\s*=\s*["']accidentMap["']/i.test(html) ||
    !/<\/html\s*>/i.test(html)
  ) {
    throw new Error("Toplo response does not contain a complete incident listing");
  }

  const declaredCount = [...incidentScript.matchAll(/\bvar\s+info\s*=/g)].length;
  const records = [...incidentScript.matchAll(/\bvar\s+info\s*=\s*({[\s\S]*?})\s*if\s*\(geoJsonString/g)];

  if (records.length !== declaredCount) {
    throw new Error("Toplo listing contains incomplete incident metadata");
  }

  const listedIds = readListedIds(html);
  const accidentIds = new Set<string>();
  const contentIds = new Set<string>();
  const incidents = new Map<string, SourceIncident>();

  for (const record of records) {
    const incident = parseIncident(record[1]);
    const previous = incidents.get(incident.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(incident)) {
      throw new Error("Toplo listing contains conflicting incident metadata");
    }
    accidentIds.add(incident.accidentId);
    contentIds.add(incident.id);
    incidents.set(incident.id, incident);
  }

  if (
    accidentIds.size !== contentIds.size ||
    accidentIds.size !== listedIds.size ||
    [...accidentIds].some((id) => {
      return !listedIds.has(id);
    })
  ) {
    throw new Error("Toplo incident metadata does not match the visible listing");
  }

  return [...incidents.values()];
}

/** Count every listed incident, including entries without usable map geometry. */
export function countListingIncidents(html: string): number {
  return parseListingIncidents(html).length;
}
