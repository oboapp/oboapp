/**
 * Text sanitization and formatting utilities
 */

/**
 * Sanitize text by removing extra whitespace and trimming
 */
export function sanitizeText(text?: string | null): string | null {
  if (!text) return null;
  const trimmed = text.replaceAll(/\s+/g, " ").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Ensure a timestamp is converted to a valid Date or null
 */
export function ensureDate(timestamp?: number | null): Date | null {
  if (!timestamp && timestamp !== 0) {
    return null;
  }

  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Format a date using Bulgarian locale
 */
export function formatDate(
  date?: Date | null,
  formatter?: Intl.DateTimeFormat,
): string | null {
  if (!date) return null;

  const defaultFormatter = new Intl.DateTimeFormat("bg-BG", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Sofia",
  });

  return (formatter ?? defaultFormatter).format(date);
}

type LabelFormatter = (label: string, value: string) => string;

interface MessageFormat {
  fmtLabel: LabelFormatter;
  metadataJoin: string;
}

const PLAIN_FORMAT: MessageFormat = {
  fmtLabel: (l, v) => `${l}: ${v}`,
  metadataJoin: "\n",
};

const MARKDOWN_FORMAT: MessageFormat = {
  fmtLabel: (l, v) => `**${l}:** ${v}`,
  // Use 2 spaces + newline for proper markdown hard line breaks
  metadataJoin: "  \n",
};

function buildMessageInternal(
  attributes: Record<string, unknown> | undefined,
  layer: { name: string },
  format: MessageFormat,
  dateFormatter?: Intl.DateTimeFormat,
): string {
  const paragraphs: string[] = [];
  const location = sanitizeText(
    typeof attributes?.LOCATION === "string" ? attributes.LOCATION : null,
  );
  const description = sanitizeText(
    typeof attributes?.DESCRIPTION === "string" ? attributes.DESCRIPTION : null,
  );

  if (location) {
    paragraphs.push(location);
  }

  if (description && description !== location) {
    paragraphs.push(description);
  }

  const startDate = formatDate(
    ensureDate(typeof attributes?.START_ === "number" ? attributes.START_ : null),
    dateFormatter,
  );
  const endDate = formatDate(
    ensureDate(typeof attributes?.ALERTEND === "number" ? attributes.ALERTEND : null),
    dateFormatter,
  );
  const lastUpdate = formatDate(
    ensureDate(typeof attributes?.LASTUPDATE === "number" ? attributes.LASTUPDATE : null),
    dateFormatter,
  );

  const { fmtLabel } = format;
  const metadata = [
    fmtLabel("Категория", layer.name),
    attributes?.ACTIVESTATUS
      ? fmtLabel("Статус", String(attributes.ACTIVESTATUS))
      : null,
    startDate ? fmtLabel("Начало", startDate) : null,
    endDate ? fmtLabel("Край", endDate) : null,
    lastUpdate ? fmtLabel("Последно обновяване", lastUpdate) : null,
    attributes?.SOFIADISTRICT
      ? fmtLabel("Район на СО (ID)", String(attributes.SOFIADISTRICT))
      : null,
    attributes?.CONTACT
      ? fmtLabel("Контакт", String(attributes.CONTACT))
      : null,
  ].filter(Boolean);

  if (metadata.length) {
    paragraphs.push(metadata.join(format.metadataJoin));
  }

  return paragraphs.join("\n\n");
}

/**
 * Build plain text message from feature attributes (used for notifications and text field)
 */
export function buildPlainTextMessage(
  attributes: Record<string, unknown> | undefined,
  layer: { name: string },
  dateFormatter?: Intl.DateTimeFormat,
): string {
  return buildMessageInternal(attributes, layer, PLAIN_FORMAT, dateFormatter);
}

/**
 * Build markdown message from feature attributes (used for markdownText field)
 */
export function buildMarkdownMessage(
  attributes: Record<string, unknown> | undefined,
  layer: { name: string },
  dateFormatter?: Intl.DateTimeFormat,
): string {
  return buildMessageInternal(
    attributes,
    layer,
    MARKDOWN_FORMAT,
    dateFormatter,
  );
}
