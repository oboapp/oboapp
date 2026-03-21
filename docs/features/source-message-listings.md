# Source Message Listings

## Overview

The source message listing feature provides dedicated pages for each data source, displaying the most recent 12 messages from that source. These pages are accessible at URLs like `https://oboapp.online/sources/{source-id}` and serve as focused views for monitoring activity from specific infrastructure providers.

## Access Patterns

### Navigation to Source Pages

**From Sources Index**: Users access source detail pages by clicking on source cards from the main sources listing at `/sources`.

**Direct URLs**: Source pages can be accessed directly via URL pattern `/sources/{source-id}` where `source-id` matches the identifier from the sources configuration.

## Page Structure

### Header Section

- **Logo**: Displays source-specific logo with fallback to generic document icon
- **Source Name**: Official name of the infrastructure provider
- **Source URL**: Clickable link to the original website
- **Back Navigation**: "Всички източници" link returns to `/sources`

### Messages Grid

- **Layout**: 3-column responsive grid (1 column mobile, 2 columns tablet, 3 columns desktop)
- **Message Count**: Shows up to 12 most recent messages
- **Sorting**: Messages ordered by `timespanEnd` descending (newest disruptions first)
- **Filtering**: Only displays finalized messages with valid GeoJSON geometry (cityWide messages bypass viewport bounds and are always visible)
- **Loading State**: Shows 12 skeleton card placeholders while data loads

### Message Cards

- **Content**: Same format as homepage - source logo, status indicator, text snippet, timestamp
- **Status Indicators**: Red circle for active disruptions, gray for past events
- **Click Behavior**: Opens message detail overlay while remaining on source page

## User Interactions

### Message Details

**Opening**: Click any message card to open detail overlay with full information, categories, locations, and addresses.

**Closing**: Click close button, press Escape key, or drag down (mobile) to close detail view and return to source message grid.

**URL State**: Detail view uses query parameter pattern `/sources/{source-id}?messageId={id}` for shareable links to specific messages.

### Address Navigation

**Map Integration**: Clicking addresses within the detail view navigates to homepage (`/`) with map centered on the clicked location.

**Behavior**: Detail view closes automatically when navigating to map to avoid blocking the map view.

**URL Parameters**: Uses `/?lat={latitude}&lng={longitude}` format for map centering.

## Error Handling

### Invalid Source IDs

**404 Response**: Accessing `/sources/invalid-id` displays custom 404 page with source-specific messaging.

**Error Page Content**:

- "Източникът не е намерен" heading
- Navigation options to view all sources or return home
- Consistent styling with application theme

### Empty States

**No Messages**: If source has no recent messages, displays "Няма налични съобщения" in grid area.

**Loading Failures**: Network errors during message fetching show empty grid after loading completes.

## Performance Considerations

### Data Freshness

**Query Window**: Only fetches messages with `timespanEnd` within relevance period (7 days by default).

**Firestore Indexing**: Uses composite index on `source` (ascending) + `timespanEnd` (descending) for efficient queries.

**Limit Enforcement**: Hard limit of 12 messages prevents excessive data loading and rendering.

### Caching Behavior

**Client-Side**: Messages refetch on each page load to ensure current data.

**API Response**: No explicit caching headers - relies on Firestore's internal optimizations.

## Analytics Tracking

The following user actions are tracked for operational monitoring:

- **Message Card Clicks**: `message_detail_opened` with source context
- **Address Clicks**: `address_clicked` from detail view
- **External Link Clicks**: When users visit original source websites
- **Navigation Events**: Tracking movement between source pages and main application

## Integration Points

### Homepage Consistency

**Shared Components**: Uses same `MessagesGrid` and `MessageDetailView` components as homepage for consistent user experience.

**Theme Adherence**: Follows application color scheme and responsive design patterns.

### Sources Management

**Configuration**: Source metadata managed centrally in `/lib/sources.json` file.

**Logo Assets**: Source logos expected at `/public/sources/{source-id}.png` with fallback handling.

## Operational Notes

### Monitoring

**Key Metrics**: Track source page visits, message engagement rates, and address click-through rates.

**Error Rates**: Monitor 404 rates for invalid source IDs and failed message fetches.

### Maintenance

**Source Updates**: Adding new sources requires updates to configuration file and logo assets.

**Index Management**: Changes to query patterns may require Firestore index updates via Firebase CLI.
