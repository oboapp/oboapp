## Multi-Zone Support

Users in guest (anonymous) or Google-authenticated sessions can create multiple named
zones of interest. Each zone has a label, a user-chosen color, and a configurable
radius (100–1000 m).

For guest-to-Google upgrade choices when both sides already have data, see
[Onboarding Flow](onboarding-flow.md).

See [User Journeys](../ux/user-journeys.md) for first-zone creation, home-view
selection, and location recovery.

### Sidebar UI

The home page has a view switch on desktop and mobile:

| Tab | Content |
| --- | --- |
| **Всички** | Events in the current map area; entering starts at the configured city overview |
| **Около мен** | Events around the current location after location succeeds |
| **Моите зони** | Saved zones with their color, label, and radius; matching event cards below the zones and matching events on the map |

### Matching Events

In **Моите зони**, an event matches when its affected geometry intersects at least
one saved zone circle. City-wide events match through the boundary of their
locality. Events that match several zones appear once. Category, source, and
archive filters continue to apply, and filter counts use the matching events.
City-wide events can appear as cards even when they have no event geometry.

My zones matches saved circles against the full recent message batch, independent
of the map viewport. Panning and zooming keep the event list in place without
refetching messages. Changing the source or category filters reloads the batch;
zone edits update its matches. All and Nearby load events for the current map area.
The existing card limit applies: more than ten results show six cards and a count
of the remaining events.

Panning and zooming keep this restriction active. Moving, adding, or deleting a
zone updates the matches. Zones remain visible when there are no matching events;
users with no saved zones see the add-zone prompt. If locality boundaries cannot
load, a message explains that some events may be missing.

### Fitting Saved Zones

Entering **Моите зони** centers and zooms the map around the saved circles,
including their radii, with a margin inside the map area. The fit waits until
the map and zones are ready and works even when no events match. It closes the filter panel
to keep the circles visible. The selected filters continue to apply. All tabs
keep the configured locality boundary and zoom limits. When the full spread of
zones exceeds those limits, the fit uses the closest allowed view. Panning,
zooming, zone edits, and background refreshes then preserve the camera. Re-entering
the tab fits the current zones again. With no zones, the camera stays where it is.
Explicit event links and zone placement keep their own camera behavior, and late automatic
geolocation results do not replace the zone view.

### Switching Views

Switching to **Всички** opens the configured city overview and the usual event
view. **Около мен** requests location once on entry. Users can then move the map
freely. Resizing the window keeps the selected tab and camera. The same three
tabs remain available above the list on mobile and desktop.

The "Добави зона" button puts the map into **target mode** for creating a new
zone. It is the primary action when the zones tab has no saved zones. A form
opens after the user places the zone on the map.

### Preferred Landing View

The active tab carries a house action. Clicking an outlined house immediately
shows that tab as home while saving the choice. Success clears the pending state;
its toast explains what opens on the next visit. Failure restores the previous
home and shows an error for retry. The filled house remains an enabled
information action: tapping it explains the current home in a toast and keeps
the choice, without saving again. Switching tabs moves the house and
updates its state without saving.
Home-feedback toasts appear after house actions; repeated taps replace the
existing message. See the [home-view design](../ux/home-view-design.md#the-active-tabs-house)
for message copy and accessible feedback.
Settings offers the same **Всички**, **Около мен**, and **Моите зони** choices.
The preference is saved in the current browser on the device and applies on the
next normal home-page visit. The default is **Всички** (`all`) when no saved or
migrated preference is available, because it needs no saved zones or location
access.

Startup reads the preference and waits for saved-zone data when My zones is
chosen. My zones uses the same event filtering and map fitting as a
manual switch. With no saved zones, it shows the add-zone empty state. Direct
event links and links to specific map coordinates keep their navigation behavior.
Settings uses the same optimistic saving behavior. The current browser save is
synchronous and settles within the click. Show pending feedback only while a
save is unresolved, with no artificial delay. The current tab and camera stay in
place when saving or restoring a home after failure.

Nearby can be saved before location access is granted. Opening the app uses
existing permission or waits for the inline enable action. Selecting Nearby or
its enable/retry action can request permission. Loading and failure stay in the
list, with unrelated cards hidden and a city fallback camera. The Nearby tab
replaces the floating map Locate button. Saving All or My zones stops automatic
location on later visits. Selecting another tab cancels stale location results
and stops tracking while preserving the saved home.

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
