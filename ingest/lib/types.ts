import type { Timestamp } from "firebase-admin/firestore";
import type { GeoJsonGeometry } from "@oboapp/shared";

// Re-export shared types
export type {
  Address,
  Timespan,
  Pin,
  StreetSection,
  CadastralProperty,
  ExtractedLocations,
  ExtractedData, // Legacy alias for ExtractedLocations
  Coordinates,
  GeoJsonPoint,
  GeoJsonMultiPoint,
  GeoJsonLineString,
  GeoJsonPolygon,
  GeoJsonGeometry,
  GeoJsonFeature,
  GeoJsonFeatureCollection,
  IngestError,
  IngestErrorType,
  Message,
  InternalMessage,
} from "@oboapp/shared";

// Re-export with GeoJSON prefix for backward compatibility
export type {
  GeoJsonPoint as GeoJSONPoint,
  GeoJsonMultiPoint as GeoJSONMultiPoint,
  GeoJsonLineString as GeoJSONLineString,
  GeoJsonPolygon as GeoJSONPolygon,
  GeoJsonGeometry as GeoJSONGeometry,
  GeoJsonFeature as GeoJSONFeature,
  GeoJsonFeatureCollection as GeoJSONFeatureCollection,
} from "@oboapp/shared";

// Intersection coordinates
export interface IntersectionCoordinates {
  lat: number;
  lng: number;
}

// User Interest (area of interest on the map)
export interface Interest {
  id?: string;
  userId: string;
  coordinates: {
    lat: number;
    lng: number;
  };
  radius: number; // in meters (min: 100, max: 1000, default: 500)
  label?: string;
  color?: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

// Notification Subscription
export interface NotificationSubscription {
  id?: string;
  userId: string;
  token: string; // FCM token
  endpoint: string; // Push subscription endpoint
  createdAt: Date | string;
  updatedAt: Date | string;
  deviceInfo?: {
    userAgent?: string;
    platform?: string;
  };
}

// Device Notification (tracking individual device send)
export interface DeviceNotification {
  subscriptionId: string; // Reference to notificationSubscription doc
  deviceInfo?: {
    userAgent?: string;
  };
  sentAt: Date | string;
  success: boolean;
  error?: string; // Error message if failed
}

// Message Snapshot (denormalized message data)
export interface MessageSnapshot {
  text: string;
  source?: string;
  sourceUrl?: string;
  createdAt: string;
}

// Notification Match (message matched to user's interest)
export interface NotificationMatch {
  id?: string;
  userId: string;
  messageId: string;
  interestId: string;
  matchedAt: Date | string;
  notified: boolean; // Whether notification was sent
  notifiedAt?: Date | string;
  notificationError?: string; // Error if notification failed
  distance?: number; // Distance in meters from interest center to closest point
  deviceNotifications?: DeviceNotification[]; // Array of device-specific sends
  messageSnapshot?: MessageSnapshot; // Denormalized message data
  clickedAt?: Date | string; // First push-notification click event timestamp
  openedAt?: Date | string; // First explicit open/read action by the user
}

// Source Configuration
export interface SourceConfig {
  id: string;
  url: string;
  name: string;
}

// Firebase Types
export interface FirestoreTimestamp {
  _seconds: number;
  _nanoseconds: number;
  toDate(): Date;
}

export type FirestoreValue = FirestoreTimestamp | Timestamp | string | Date;

export interface FirebaseNotificationPayload {
  notification?: {
    title?: string;
    body?: string;
    icon?: string;
  };
  data?: Record<string, string>;
}

// Overpass API Types
export interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  geometry?: OverpassGeometry[];
  tags?: Record<string, string>;
}

export interface OverpassGeometry {
  lat: number;
  lon: number;
}

export interface OverpassResponse {
  version: number;
  generator: string;
  elements: OverpassElement[];
}

export interface SnapPoint {
  lat: number;
  lng: number;
  distance: number;
}

export interface CadastralGeometryCollection {
  features: Array<{
    geometry: GeoJsonGeometry;
    properties: Record<string, unknown>;
  }>;
}

export interface IngestOptions {
  boundariesPath?: string;
  dryRun?: boolean;
  sourceType?: string;
  sourceName?: string;
  limit?: number;
  since?: Date;
  until?: Date;
}

export interface FirestoreDocumentData {
  text: string;
  sourceUrl?: string;
  sourceDocumentId?: string;
  createdAt: Date;
  [key: string]: unknown;
}

// Cadastre Service Types
export interface CadastreProperty {
  identifier: string;
  geometry?: GeoJsonGeometry;
  [key: string]: unknown;
}
