// Import zod-openapi first to ensure z is extended before importing shared schemas
import { z } from "@/lib/zod-openapi";
import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from "@asteasolutions/zod-to-openapi";
import type { OpenAPIObject } from "openapi3-ts/oas30";
import {
  MessageSchema as SharedMessageSchema,
  AddressSchema as SharedAddressSchema,
  SourceSchema,
} from "@oboapp/shared";
// Public API contract — intentionally strips internal geocoding signals (qualitySignals)
// so that changes to internal quality schemas don't silently alter the public API contract.
const PublicAddressSchema = SharedAddressSchema.omit({
  qualitySignals: true,
});
// Explicitly exclude summary (internal-only) by spreading the shape without it
const { summary: _summaryField, ...publicMessageShape } =
  SharedMessageSchema.shape;
const MessageSchema = z.object({
  ...publicMessageShape,
  addresses: z.array(PublicAddressSchema).optional(),
});

const ErrorResponseSchema = z.object({
  error: z.string(),
});

export const v1Schemas = {
  errorResponse: ErrorResponseSchema,
  message: MessageSchema,
  sourcesResponse: z.object({ sources: z.array(SourceSchema) }),
  messagesResponse: z.object({ messages: z.array(MessageSchema) }),
  messageResponse: z.object({ message: MessageSchema }),
};

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

export const buildV1OpenApi = (): OpenAPIObject => {
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
    v1Schemas.errorResponse,
  );
  registry.register("V1Message", v1Schemas.message);
  const sourcesResponse = registry.register(
    "V1SourcesResponse",
    v1Schemas.sourcesResponse,
  );
  const messagesResponse = registry.register(
    "V1MessagesResponse",
    v1Schemas.messagesResponse,
  );
  const messageResponse = registry.register(
    "V1MessageResponse",
    v1Schemas.messageResponse,
  );

  registry.registerPath({
    method: "get",
    path: "/api/v1/sources",
    description: "List all sources with logo URLs.",
    security: [{ ApiKeyAuth: [] }],
    responses: {
      200: {
        description: "Sources response",
        content: {
          "application/json": {
            schema: sourcesResponse,
          },
        },
      },
      401: {
        description: "Invalid or missing API key",
        content: {
          "application/json": {
            schema: errorResponse,
          },
        },
      },
      500: {
        description: "Server error",
        content: {
          "application/json": {
            schema: errorResponse,
          },
        },
      },
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/messages",
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
      }),
    },
    responses: {
      200: {
        description: "Messages response",
        content: {
          "application/json": {
            schema: messagesResponse,
          },
        },
      },
      400: {
        description: "Invalid query parameters",
        content: {
          "application/json": {
            schema: errorResponse,
          },
        },
      },
      401: {
        description: "Invalid or missing API key",
        content: {
          "application/json": {
            schema: errorResponse,
          },
        },
      },
      500: {
        description: "Server error",
        content: {
          "application/json": {
            schema: errorResponse,
          },
        },
      },
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/messages/by-id",
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
        content: {
          "application/json": {
            schema: messageResponse,
          },
        },
      },
      400: {
        description: "Missing or invalid id parameter",
        content: {
          "application/json": {
            schema: errorResponse,
          },
        },
      },
      401: {
        description: "Invalid or missing API key",
        content: {
          "application/json": {
            schema: errorResponse,
          },
        },
      },
      404: {
        description: "Message not found",
        content: {
          "application/json": {
            schema: errorResponse,
          },
        },
      },
      500: {
        description: "Server error",
        content: {
          "application/json": {
            schema: errorResponse,
          },
        },
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
        "Read-only public API for external consumption of OboApp city-infrastructure data. All data endpoints in this specification require a registered API key sent via the X-Api-Key header. You can create and manage API keys from the OboApp Settings page.",
    },
    security: [{ ApiKeyAuth: [] }],
  });

  return sortOpenApiDocument(document);
};
