import { z } from "../zod-openapi";

export const SourceIncidentSchema = z.object({
  id: z.string().min(1),
  accidentId: z.string().min(1),
  name: z.string().min(1),
  addresses: z.string(),
  type: z.enum(["accident", "repair"]),
  status: z.number().int().nonnegative(),
  reportedStart: z.iso.datetime().nullable(),
  estimatedEnd: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime().nullable(),
});

export const SourceSnapshotSchema = z.object({
  sourceType: z.string().min(1),
  locality: z.string().min(1),
  count: z.number().int().nonnegative(),
  observedAt: z.iso.datetime(),
  incidents: z.array(SourceIncidentSchema).optional(),
}).superRefine((snapshot, context) => {
  if (!snapshot.incidents) {
    return;
  }

  const ids = new Set(snapshot.incidents.map((incident) => {
    return incident.id;
  }));
  const accidentIds = new Set(snapshot.incidents.map((incident) => {
    return incident.accidentId;
  }));

  if (
    snapshot.incidents.length !== snapshot.count ||
    ids.size !== snapshot.count ||
    accidentIds.size !== snapshot.count
  ) {
    context.addIssue({
      code: "custom",
      path: ["incidents"],
      message: "Incident identities must be unique and match the snapshot count",
    });
  }
});

export type SourceIncident = z.infer<typeof SourceIncidentSchema>;
export type SourceSnapshot = z.infer<typeof SourceSnapshotSchema>;
