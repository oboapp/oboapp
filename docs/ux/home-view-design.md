# Home Views

The home page offers three views with a saved home preference.
See the [user journey graphs](user-journeys.md).

## Three Tabs on Desktop and Mobile

Use the same tabs above the event and zone list on every supported layout:

| Tab | Events shown | Map when entering the tab |
| --- | --- | --- |
| **Всички** | Events in the current map area | Configured city overview |
| **Около мен** | Events in the current map area after location succeeds | Current location, once |
| **Моите зони** | Events affecting saved zones | Fit all saved circles |

The default home is **Всички** (`all`) when no saved or migrated preference is
available. This choice needs no saved zones or location access. Only the My zones
branch waits for saved-zone data.

My zones follows the [event-matching specification](../features/multi-zone-support.md#matching-events)
and [saved-zone fitting specification](../features/multi-zone-support.md#fitting-saved-zones).

Category, source, and archive filters continue to apply. After entry, users can
pan and zoom freely. Background updates preserve the camera. Entering another
tab changes the current visit and leaves the saved home intact. Explicit event
and coordinate links keep their own navigation behavior.

On mobile, keep all three labels and the house action readable and reachable
above the list. Use at least 44 × 44 CSS px for each enabled action, with separate
targets for the label and house. Provide visible feedback for taps and
clear keyboard focus. Hover is an extra cue for devices that support it.
Balance horizontal padding with the target height and check fit with fallback
fonts. Label focus outlines the whole segment; house focus outlines its own target.
Resizing keeps the active tab and the user's camera. The nearby
tab supplies the location action, so the map has no separate floating Locate button.

## The Active Tab's House

Show a house action beside the active tab label, inside the same visual segment.
Hovering either action tints the whole active segment. The selection highlight
slides between tabs in a short transition while the selected view updates
immediately. The outgoing house shrinks away as the incoming house grows, and
the tab widths and label padding animate with them. Disable this movement when
reduced motion is requested.
When another tab becomes active, the house moves with it:

- **Outlined house:** the active tab can be saved as home.
- **Filled house:** the active tab is the selected home.
- **Filled house with pending state:** the new home is shown immediately while
  its save is in progress.

Use an **optimistic update**: clicking an outlined house immediately shows the
active tab as home, then saves the choice. Success clears the pending state and
keeps the house filled, with a toast explaining the next visit. Failure restores
the previous home and shows a concise error with a way to retry. A newer choice
takes priority over an older save result.
Keep the current tab and camera in place throughout. Clicking a confirmed filled
house keeps the existing choice and shows an explanation of the current home.

Use the existing toast system to make the outcome clear on mobile:

- **New home saved:** **При следващото отваряне на OboApp ще виждаш „{изглед}“.**
- **Current home tapped:** **„{изглед}“ е началният ти изглед в OboApp.**

The filled house remains an enabled information action. Tapping it does not save
the preference again. Show these messages only after a house action. Opening the
app and switching tabs leave them hidden. Replace the existing home-feedback
toast on repeated taps so messages do not stack, and preserve the toast system's
screen-reader announcements. Titles remain extra feedback for pointer users.

A subtle loading marker may indicate a pending save, with an accessible busy
state. Keep the icon position, hit area, title, hover, and focus feedback stable.
Respect reduced-motion preferences if the marker moves. The current browser save
is synchronous and settles within the click. Show pending feedback only while a
save is unresolved; do not add a minimum delay for it.

The tab label and house are separate keyboard-accessible actions. Give the house
a name such as **Направи „Моите зони“ начален изглед** and expose its saved state.
The filled shape and accessible state communicate the selection alongside color.
Use ordinary buttons for saving and showing information. A filled house stays
enabled and focusable, with a name for its information action and a description
of how to choose another home.
A failed save restores the previous home and presents a concise error.

The house is the direct way to save a home. Settings offers the same three
choices and optimistic saving behavior. Both save in the current browser on the
device. Ordinary tab changes leave this preference intact.

## My Zones Without Zones

The primary action is **Добави зона**. The user places and saves the first zone,
then sees its relevant events. The house remains available as a small secondary
action. Creating a zone is independent of notification enrollment. Keep failed
creation input available for retry and let cancellation return to the empty state.

Saving My zones as home is allowed before creating a zone. Deleting the last zone
also keeps that home choice. Its next visit shows the creation empty state.

## Nearby Location and Recovery

Selecting **Около мен** requests location once for that entry. Request browser
permission only through an explicit tab selection or the inline enable/retry
action. Show loading and permission guidance in the list. Keep the tab active
after refusal, timeout, unavailable location, or a position outside the supported
map area. Use the city overview as the fallback camera and offer an inline retry.
Keep unrelated event cards hidden while location is unavailable.

Saving Nearby as home records the user's intent, including when access has not
yet been granted. On startup, use existing permission to locate once. If access
needs granting again, show the inline action and wait for a click. Launching the
app never opens a permission dialog. Keep the saved home after location failures.

Switching away from Nearby cancels pending location results and stops location
tracking. Saving All or My zones as home stops automatic location on later
visits. Browser permission itself stays under browser controls. Selecting Nearby
for a temporary visit leaves the saved home intact. Re-select Nearby or use its
inline refresh action to locate again after moving the map.

## Existing Users and Related Work

Preserve an existing My zones home. For other returning users, preserve existing
automatic-location behavior as Nearby; users without that behavior start with
All. An explicit choice in the new UI always takes priority.

Related mobile work is included in [#654](https://github.com/oboapp/oboapp/issues/654)
(mobile bottom-sheet experience and access to saved places) and the broader
[#103 UI/UX redesign](https://github.com/oboapp/oboapp/issues/103). Neither issue
specifically requests this three-tab control.

## Validation

Cover the explicit All default, home saving and return visits for each tab,
immediate house fill, pending state, rollback, newer choices during a save,
temporary switching, storage failures, no zones, first-zone creation, location
denial and recovery, stale results, direct links, keyboard use, and 320 px reflow.
Check new-home and current-home toast messages, failure feedback, repeated taps,
and the absence of unsolicited messages on startup or ordinary tab selection.
Verify that desktop and mobile share the same behavior.
