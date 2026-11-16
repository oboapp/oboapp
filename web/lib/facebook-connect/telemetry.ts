import type { Breadcrumb, Event, spanToJSON } from "@sentry/nextjs";
import { FACEBOOK_SESSION_COOKIE } from "./config";

type SpanJSON = ReturnType<typeof spanToJSON>;

function protectedText(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  const text = value.toLowerCase();
  return text.includes("graph.facebook.com") || text.includes("/api/integrations/facebook") ||
    text.includes("/connect/facebook") ||
    (text.includes("facebook.com/") && text.includes("/dialog/oauth"));
}

function protectedValue(value: unknown, depth = 0): boolean {
  if (protectedText(value)) {
    return true;
  }
  if (!value || typeof value !== "object" || depth > 4) {
    return false;
  }
  return Object.values(value).some((entry) => {
    return protectedValue(entry, depth + 1);
  });
}

/** Provider breadcrumbs can include credentials in URLs, headers, or response bodies. */
export function scrubFacebookBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  if (protectedText(breadcrumb.message) || protectedValue(breadcrumb.data)) {
    return null;
  }
  return breadcrumb;
}

/** beforeSendSpan cannot discard spans, so retain only fixed tracing fields. */
export function scrubFacebookSpan(span: SpanJSON): SpanJSON {
  if (protectedText(span.description) || protectedValue(span.data)) {
    return {
      trace_id: span.trace_id,
      span_id: span.span_id,
      start_timestamp: span.start_timestamp,
      ...(span.timestamp === undefined ? {} : { timestamp: span.timestamp }),
      ...(span.parent_span_id === undefined ? {} : { parent_span_id: span.parent_span_id }),
      ...(span.op === undefined ? {} : { op: span.op }),
      ...(span.status === undefined ? {} : { status: span.status }),
      description: "Facebook authorization request",
      data: {},
    };
  }
  return span;
}

/** OAuth events are excluded because their request context contains session credentials. */
export function scrubFacebookEvent<T extends Event>(event: T): T | null {
  if (protectedText(event.request?.url) || protectedText(event.transaction) ||
      protectedText(event.message) || protectedText(event.logentry?.message) ||
      event.exception?.values?.some((exception) => protectedText(exception.value))) {
    return null;
  }
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.flatMap((breadcrumb) => {
      const safe = scrubFacebookBreadcrumb(breadcrumb);
      return safe === null ? [] : [safe];
    });
  }
  if (event.spans) {
    event.spans = event.spans.map(scrubFacebookSpan);
  }
  if (event.request?.cookies) {
    delete event.request.cookies[FACEBOOK_SESSION_COOKIE];
  }
  if (event.request?.headers) {
    for (const [name, value] of Object.entries(event.request.headers)) {
      if (name.toLowerCase() === "cookie" && value.includes(`${FACEBOOK_SESSION_COOKIE}=`)) {
        delete event.request.headers[name];
      }
    }
  }
  return event;
}
