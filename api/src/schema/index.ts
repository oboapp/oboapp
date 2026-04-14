export {
  // Contract types
  MessageSchema,
  SourceSchema,
  CategoryEnum,
  CoordinatesSchema,
  TimespanSchema,
  GeoJsonFeatureCollectionSchema,
  GeoJsonFeatureSchema,
  GeoJsonGeometrySchema,
  GeoJsonPointSchema,
  GeoJsonLineStringSchema,
  GeoJsonPolygonSchema,
  GeoJsonMultiPointSchema,
  PinSchema,
  StreetSectionSchema,
  AddressSchema,
  CadastralPropertySchema,
  type Message,
  type Source,
  type Category,
  type Coordinates,
  type Pin,
  type StreetSection,
  type Address,
  type CadastralProperty,
  type GeoJsonFeatureCollection,
  type GeoJsonFeature,
  type GeoJsonGeometry,
  type GeoJsonPoint,
} from "./contract";

// Response schemas
export {
  SourcesResponseSchema,
  MessagesResponseSchema,
  MessageResponseSchema,
  ErrorResponseSchema,
  type SourcesResponse,
  type MessagesResponse,
  type MessageResponse,
  type ErrorResponse,
} from "./response";

// Query schemas
export { messagesQuerySchema, type MessagesQuery } from "./query";

// v2 contract types
export {
  MessageV2Schema,
  SourceSchema as SourceV2Schema,
  CategoryEnum as CategoryV2Enum,
  GeoJsonFeatureCollectionSchema as GeoJsonFeatureCollectionV2Schema,
  GeoJsonFeatureSchema as GeoJsonFeatureV2Schema,
  GeoJsonGeometrySchema as GeoJsonGeometryV2Schema,
  GeoJsonPointSchema as GeoJsonPointV2Schema,
  GeoJsonLineStringSchema as GeoJsonLineStringV2Schema,
  GeoJsonPolygonSchema as GeoJsonPolygonV2Schema,
  GeoJsonMultiPointSchema as GeoJsonMultiPointV2Schema,
  type MessageV2,
  type Source as SourceV2,
  type Category as CategoryV2,
  type GeoJsonFeatureCollection as GeoJsonFeatureCollectionV2,
  type GeoJsonFeature as GeoJsonFeatureV2,
  type GeoJsonGeometry as GeoJsonGeometryV2,
  type GeoJsonPoint as GeoJsonPointV2,
} from "./contract.v2";

// v2 response schemas
export {
  V2SourcesResponseSchema,
  V2MessagesResponseSchema,
  V2MessageResponseSchema,
  type V2SourcesResponse,
  type V2MessagesResponse,
  type V2MessageResponse,
} from "./response.v2";
