// Re-export all schemas from a single entry point
export * from "./address.schema";
export * from "./api-client.schema";
export * from "./category.schema";
export * from "./coordinates.schema";
export * from "./event.schema";
export * from "./event-message.schema";
export * from "./extracted-data.schema";
export * from "./geojson.schema";
export * from "./ingest-error.schema";
export * from "./interest-coverage.schema";
export * from "./message.schema";
export * from "./message-snapshot.schema";
export * from "./notification-history.schema";
export * from "./notification-subscription.schema";
export * from "./pin.schema";
export * from "./source.schema";
export * from "./street-section.schema";
export * from "./timespan.schema";
export * from "./user-preferences.schema";

// Re-export the zod instance
export { z } from "zod";
