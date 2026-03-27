import { Hono } from "hono";
import { z } from "../lib/zod-openapi";
import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from "@asteasolutions/zod-to-openapi";
import type { OpenAPIObject } from "openapi3-ts/oas30";
import {
  MessageSchema,
  SourceSchema,
  SourcesResponseSchema,
  MessagesResponseSchema,
  MessageResponseSchema,
  ErrorResponseSchema,
} from "../schema/index";

const sortRecord = <T>(record: Record<string, T>): Record<string, T> =>
  Object.keys(record)
    .sort()
    .reduce<Record<string, T>>((acc, key) => {
      acc[key] = record[key];
      return acc;
    }, {});

const sortOpenApiDocument = (document: OpenAPIObject): OpenAPIObject => ({
  ...document,
  paths: document.paths ? sortRecord(document.paths) : document.paths,
  components: document.components
    ? {
        ...document.components,
        schemas: document.components.schemas
          ? sortRecord(document.components.schemas)
          : document.components.schemas,
      }
    : document.components,
});

function buildOpenApiSpec(): OpenAPIObject {
  const registry = new OpenAPIRegistry();

  registry.registerComponent("securitySchemes", "ApiKeyAuth", {
    type: "apiKey",
    in: "header",
    name: "X-Api-Key",
    description:
      "API key created and managed in OboApp Settings. Create an API key in Settings and include it in the X-Api-Key header.",
  });

  const errorResponse = registry.register(
    "V1ErrorResponse",
    ErrorResponseSchema,
  );
  registry.register("V1Message", MessageSchema);
  registry.register("V1Source", SourceSchema);
  const sourcesResponse = registry.register(
    "V1SourcesResponse",
    SourcesResponseSchema,
  );
  const messagesResponse = registry.register(
    "V1MessagesResponse",
    MessagesResponseSchema,
  );
  const messageResponse = registry.register(
    "V1MessageResponse",
    MessageResponseSchema,
  );

  registry.registerPath({
    method: "get",
    path: "/v1/sources",
    description: "List all sources with logo URLs.",
    security: [{ ApiKeyAuth: [] }],
    responses: {
      200: {
        description: "Sources response",
        content: { "application/json": { schema: sourcesResponse } },
      },
      401: {
        description: "Invalid or missing API key",
        content: { "application/json": { schema: errorResponse } },
      },
      500: {
        description: "Server error",
        content: { "application/json": { schema: errorResponse } },
      },
    },
  });

  registry.registerPath({
    method: "get",
    path: "/v1/messages",
    description:
      "Fetch messages, optionally filtered by bounds and categories.",
    security: [{ ApiKeyAuth: [] }],
    request: {
      query: z.object({
        north: z.string().optional(),
        south: z.string().optional(),
        east: z.string().optional(),
        west: z.string().optional(),
        zoom: z.string().optional(),
        categories: z.string().optional(),
        sources: z.string().optional(),
        timespanEndGte: z.string().optional(),
      }),
    },
    responses: {
      200: {
        description: "Messages response",
        content: { "application/json": { schema: messagesResponse } },
      },
      400: {
        description: "Invalid query parameters",
        content: { "application/json": { schema: errorResponse } },
      },
      401: {
        description: "Invalid or missing API key",
        content: { "application/json": { schema: errorResponse } },
      },
      500: {
        description: "Server error",
        content: { "application/json": { schema: errorResponse } },
      },
    },
  });

  registry.registerPath({
    method: "get",
    path: "/v1/messages/by-id",
    description: "Fetch a single message by its ID.",
    security: [{ ApiKeyAuth: [] }],
    request: {
      query: z.object({
        id: z.string(),
      }),
    },
    responses: {
      200: {
        description: "Message response",
        content: { "application/json": { schema: messageResponse } },
      },
      400: {
        description: "Missing or invalid id parameter",
        content: { "application/json": { schema: errorResponse } },
      },
      401: {
        description: "Invalid or missing API key",
        content: { "application/json": { schema: errorResponse } },
      },
      404: {
        description: "Message not found",
        content: { "application/json": { schema: errorResponse } },
      },
      500: {
        description: "Server error",
        content: { "application/json": { schema: errorResponse } },
      },
    },
  });

  const generator = new OpenApiGeneratorV3(registry.definitions);

  const document = generator.generateDocument({
    openapi: "3.0.0",
    info: {
      title: "OboApp Public API",
      version: "1.0.0",
      description:
        "Read-only public API for external consumption of OboApp city-infrastructure data. All data endpoints require a registered API key sent via the X-Api-Key header. You can create and manage API keys from the OboApp Settings page.",
    },
    security: [{ ApiKeyAuth: [] }],
  });

  return sortOpenApiDocument(document);
}

let cachedSpec: OpenAPIObject | null = null;

export const openapiRoute = new Hono();

openapiRoute.get("/openapi", (c) => {
  if (!cachedSpec) {
    cachedSpec = buildOpenApiSpec();
  }
  return c.json(cachedSpec);
});

openapiRoute.get("/docs", (c) => {
  const html = `<!DOCTYPE html>
<html>
<head>
  <title>OboApp API Reference</title>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body>
  <script id="api-reference" data-url="/v1/openapi"></script>
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.25.59"></script>
</body>
</html>`;
  return c.html(html);
});
