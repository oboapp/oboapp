## Multi-Zone Support

Users in guest (anonymous) or Google-authenticated sessions can create multiple named
zones of interest. Each zone has a label, a user-chosen color, and a configurable
radius (100–1000 m).

For guest-to-Google upgrade choices when both sides already have data, see
[Onboarding Flow](onboarding-flow.md).

### Sidebar UI

On wide-desktop layouts, users see a segmented control header with two tabs:

| Tab            | Content                                                               |
| -------------- | --------------------------------------------------------------------- |
| **Моите зони** | Saved zones with their color, label, and radius; matching event cards below the zones and matching events on the map |
| **Събития**    | Events in the current map area, subject to the selected filters |

In **Моите зони**, an event matches when its affected geometry intersects at least
one saved zone circle. City-wide events match through the boundary of their
locality. Events that match several zones appear once. Category, source, and
archive filters continue to apply, and filter counts use the matching events.
City-wide events can appear as cards even when they have no event geometry.

The results remain a preview of the current map area. The existing card limit
applies: more than ten results show six cards and a count of the remaining events.

Panning and zooming keep this restriction active. Moving, adding, or deleting a
zone updates the matches. Zones remain visible when there are no matching events;
users with no saved zones see the add-zone prompt. If locality boundaries cannot
load, a message explains that some events may be missing.

Switching to **Събития** restores the usual event view. Mobile and narrower
layouts use the Events view, including when resizing from the wide desktop layout.
They show zone badges above the event cards. Tapping a badge centers the map on
that zone, and the cards continue to show events from the current map area.

The "Добави зона" button puts the map into **target mode** for creating a new
zone. On wide desktop it appears in the zones tab; on narrower layouts it appears
with the zone badges. A form opens after the user places the zone on the map.

### Zone Creation Flow

1. User clicks "Добави зона" → the map enters **target mode** for placing a new zone.
2. User clicks the map to place the zone (no preview circle until first click).
3. Control panel shows coordinates, radius slider, and save/cancel buttons.
4. On save, a form opens where the user picks a label and color.
5. On confirm, the zone is persisted via `POST /api/interests` with `label` and `color`.

### Zone Editing & Deletion

- **Desktop (wide layout):** Move/Delete actions are available from each zone's menu
  in the "Моите зони" side panel.
- **Mobile and narrower layouts:** tapping a zone circle on the map opens a menu
  with **Move** and **Delete**.

Move re-enters target mode with the existing radius pre-filled.

### Interest Data Model

Zones are stored in the `interests` collection with these fields:

| Field         | Type      | Description                               |
| ------------- | --------- | ----------------------------------------- |
| `userId`      | string    | Owner                                     |
| `coordinates` | {lat,lng} | Center of the zone                        |
| `radius`      | number    | Radius in meters (100–1000)               |
| `label`       | string?   | Zone type label (e.g. "Вкъщи")            |
| `color`       | string?   | Hex color from zone type (e.g. "#4285F4") |
| `createdAt`   | datetime  | Creation timestamp                        |
| `updatedAt`   | datetime  | Last update timestamp                     |

### Notifications

The notification pipeline matches messages against **all** of a user's zones.
A user receives at most one notification per message regardless of how many
zones it intersects (deduplicated by closest match distance).

### Map Rendering

Zone circles use native `google.maps.Circle` instances managed imperatively
(not via the `@react-google-maps/api` `<Circle>` component) to ensure
deterministic cleanup when a zone is deleted or its radius changes.
Each circle is color-coded to match its zone type.
