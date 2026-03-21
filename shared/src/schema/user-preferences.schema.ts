import { z } from "../zod-openapi";
import { CategoryEnum } from "./category.schema";

/**
 * Allowed values for notification category filters.
 * Includes all real categories plus "uncategorized" for messages without categories.
 */
const notificationCategoryValues = [
  ...CategoryEnum.options,
  "uncategorized",
] as const;
const NotificationCategoryEnum = z.enum(notificationCategoryValues);

export const UserPreferencesSchema = z.object({
  id: z.string(),
  userId: z.string(),
  /** Categories to include in notifications (empty = allow all) */
  notificationCategories: z.array(NotificationCategoryEnum).default([]),
  /** Sources to include in notifications (empty = allow all) */
  notificationSources: z.array(z.string()).default([]),
  /** Whether the user has opted into experimental features */
  experimentalFeatures: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** Schema for PUT request body (only the filter fields) */
export const UserPreferencesRequestSchema = z.object({
  notificationCategories: z.array(NotificationCategoryEnum).default([]),
  notificationSources: z.array(z.string()).default([]),
  experimentalFeatures: z.boolean().default(false),
});

export type UserPreferences = z.infer<typeof UserPreferencesSchema>;
export type UserPreferencesRequest = z.infer<
  typeof UserPreferencesRequestSchema
>;
