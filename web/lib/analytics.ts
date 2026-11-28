// Google Analytics utility functions

import { debounce, type DebouncedFunction } from "./debounce";

// Event names and their parameters
export type AnalyticsEvent =
  // Zone Management
  | { name: "zone_add_initiated"; params: { user_authenticated: boolean } }
  | { name: "zone_radius_changed"; params: { radius: number; is_new: boolean } }
  | { name: "zone_save_completed"; params: { radius: number; is_new: boolean } }
  | { name: "zone_save_cancelled"; params: { is_new: boolean } }
  | { name: "zone_clicked"; params: { zone_id: string; radius: number } }
  | {
      name: "zone_move_initiated";
      params: { zone_id: string; current_radius: number };
    }
  | { name: "zone_deleted"; params: { zone_id: string; radius: number } }
  // Authentication
  | {
      name: "login_initiated";
      params: { source: "prompt" | "header" | "settings" };
    }
  | { name: "login_prompt_dismissed"; params: {} }
  | { name: "logout_clicked"; params: { zones_count: number } }
  | { name: "guest_started"; params: {} }
  | { name: "guest_zone_created"; params: { radius: number } }
  | {
      name: "guest_push_enabled";
      params: { source: "onboarding" | "settings" };
    }
  | { name: "guest_push_failed"; params: { source: "onboarding" | "settings" } }
  | { name: "upgrade_prompt_shown"; params: {} }
  | {
      name: "upgrade_option_selected";
      params: { option: "import" | "keepSeparate" | "replace" };
    }
  | {
      name: "upgrade_outcome";
      params: {
        option: "import" | "keepSeparate" | "replace";
        status: "success" | "failure";
      };
    }
  // Notifications
  | {
      name: "notification_permission_accepted";
      params: { zones_count?: number };
    }
  | {
      name: "notification_permission_declined";
      params: { zones_count?: number };
    }
  // Geolocation
  | { name: "geolocation_prompt_shown"; params: {} }
  | { name: "geolocation_prompt_accepted"; params: {} }
  | { name: "geolocation_prompt_declined"; params: {} }
  | { name: "geolocation_permission_granted"; params: {} }
  | { name: "geolocation_permission_denied"; params: {} }
  | {
      name: "geolocation_location_centered";
      params: { had_cached_permission: boolean; auto_centered?: boolean };
    }
  | {
      name: "geolocation_error";
      params: {
        error_type: string;
        had_cached_permission: boolean;
        auto_centered?: boolean;
      };
    }
  // Onboarding
  | { name: "onboarding_notification_clicked"; params: {} }
  // Prompts
  | { name: "prompt_add_zones_clicked"; params: { prompt_type: "first_zone" } }
  | { name: "prompt_add_zones_dismissed"; params: {} }
  // Content Engagement
  | {
      name: "message_shared";
      params: { message_id: string; method: "native" | "copy" };
    }
  | {
      name: "message_clicked";
      params: { message_id: string; source_id: string; location: string };
    }
  | {
      name: "message_detail_closed";
      params: {
        message_id: string;
        close_method: "backdrop" | "esc" | "button" | "drag";
      };
    }
  | {
      name: "map_feature_clicked";
      params: {
        message_id: string;
        geometry_type: "Point" | "MultiPoint" | "LineString" | "Polygon";
        classification: "active" | "archived";
      };
    }
  | {
      name: "map_cluster_clicked";
      params: {
        classification: "active" | "archived";
      };
    }
  | {
      name: "address_clicked";
      params: { message_id: string; formatted_address: string };
    }
  // Source Card Clicks
  | {
      name: "source_card_clicked";
      params: {
        source_id: string;
        source_name: string;
        location: string;
      };
    }
  // External Links
  | {
      name: "external_link_clicked";
      params: {
        url: string;
        location: string;
        source_id?: string;
        source_name?: string;
        link_text?: string;
      };
    };

const CONSENT_KEY = "ga_consent";
const CONSENT_GRANTED = "granted";
const CONSENT_DENIED = "denied";

function readConsent(): string | null {
  try {
    return globalThis.window?.localStorage.getItem(CONSENT_KEY) ?? null;
  } catch {
    return null;
  }
}

export function hasConsent(): boolean {
  return readConsent() === CONSENT_GRANTED;
}

// Store consent decision
export function setConsent(granted: boolean): void {
  try {
    globalThis.window?.localStorage.setItem(
      CONSENT_KEY,
      granted ? CONSENT_GRANTED : CONSENT_DENIED,
    );
  } catch {
    // Private browsing can block storage. Only a saved decision enables analytics.
  }
}

// Check if user has made a consent decision
export function hasConsentDecision(): boolean {
  const consent = readConsent();
  return consent === CONSENT_GRANTED || consent === CONSENT_DENIED;
}

// Initialize Google Analytics
export function initGA(): void {
  const measurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

  if (!measurementId) {
    if (process.env.NODE_ENV === "development") {
      console.log("[GA] No measurement ID configured");
    }
    return;
  }

  if (!hasConsent()) {
    if (process.env.NODE_ENV === "development") {
      console.log("[GA] Consent not granted, skipping initialization");
    }
    return;
  }

  const browser = globalThis.window;
  if (browser?.gtag) {
    browser.gtag("consent", "update", {
      analytics_storage: "granted",
    });

    browser.gtag("config", measurementId, {
      page_path: browser.location.pathname,
    });

    if (process.env.NODE_ENV === "development") {
      console.log("[GA] Initialized with measurement ID:", measurementId);
    }
  }
}

// Track page view
export function trackPageView(url: string): void {
  const measurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

  if (!measurementId || !hasConsent()) {
    return;
  }

  const browser = globalThis.window;
  if (browser?.gtag) {
    browser.gtag("config", measurementId, {
      page_path: url,
    });

    if (process.env.NODE_ENV === "development") {
      console.log("[GA] Page view:", url);
    }
  }
}

// Track custom event
export function trackEvent<T extends AnalyticsEvent>(event: T): void {
  const measurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

  if (!measurementId) {
    if (process.env.NODE_ENV === "development") {
      console.log("[GA] Event (no ID):", event.name, event.params);
    }
    return;
  }

  if (!hasConsent()) {
    if (process.env.NODE_ENV === "development") {
      console.log("[GA] Event (no consent):", event.name, event.params);
    }
    return;
  }

  const browser = globalThis.window;
  if (browser?.gtag) {
    browser.gtag("event", event.name, event.params);

    if (process.env.NODE_ENV === "development") {
      console.log("[GA] Event:", event.name, event.params);
    }
  } else if (process.env.NODE_ENV === "development") {
    console.log("[GA] Event (gtag not loaded):", event.name, event.params);
  }
}

// Create a debounced version of trackEvent for high-frequency events
export const trackEventDebounced: DebouncedFunction<typeof trackEvent> =
  debounce(trackEvent, 300);
