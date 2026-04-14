import { z } from "../lib/zod-openapi";
import { MessageV2Schema, SourceSchema } from "./contract.v2";

export const V2SourcesResponseSchema = z.object({
  sources: z.array(SourceSchema),
});

export const V2MessagesResponseSchema = z.object({
  messages: z.array(MessageV2Schema),
});

export const V2MessageResponseSchema = z.object({
  message: MessageV2Schema,
});

export type V2SourcesResponse = z.infer<typeof V2SourcesResponseSchema>;
export type V2MessagesResponse = z.infer<typeof V2MessagesResponseSchema>;
export type V2MessageResponse = z.infer<typeof V2MessageResponseSchema>;
