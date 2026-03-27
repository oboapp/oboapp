import { z } from "../lib/zod-openapi";
import { MessageSchema, SourceSchema } from "./contract";

export const SourcesResponseSchema = z.object({
  sources: z.array(SourceSchema),
});

export const MessagesResponseSchema = z.object({
  messages: z.array(MessageSchema),
});

export const MessageResponseSchema = z.object({
  message: MessageSchema,
});

export const ErrorResponseSchema = z.object({
  error: z.string(),
});

export type SourcesResponse = z.infer<typeof SourcesResponseSchema>;
export type MessagesResponse = z.infer<typeof MessagesResponseSchema>;
export type MessageResponse = z.infer<typeof MessageResponseSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
