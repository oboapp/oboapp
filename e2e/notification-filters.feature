Feature: Notification Filters
  As a user of oboapp
  I want to filter which notifications I receive by category and source
  So that I only get notified about disruptions I care about

  Background:
    Given I am logged in
    And I have at least one interest circle on the map
    And I have an active push notification subscription

  # ─── Navigation ───────────────────────────────────────────────────────

  Scenario: Open Notification Filters from the notifications dropdown
    When I click the notification bell icon
    And I click the "Филтри" link in the notification dropdown header
    Then I am navigated to "/settings/notification-filters"
    And I see a "Категории" section with all 17 categories and an "Некатегоризирани" option
    And I see a "Източници" section with all sources for my locality

  Scenario: Open Notification Filters from the Settings page
    When I navigate to "/settings"
    And I click the "Филтри за известия" link in the Notifications section
    Then I am navigated to "/settings/notification-filters"

  # ─── Default State (No Filters) ──────────────────────────────────────

  Scenario: Default state shows no active filters
    When I navigate to "/settings/notification-filters"
    Then no categories are selected
    And no sources are selected
    And I see a note that "Промените ще се приложат само за бъдещи известия"

  Scenario: No filters means all notifications are delivered
    Given I have no notification filter preferences saved
    When a new message is ingested with category "water" from source "sofiyska-voda"
    And the message geographically intersects my interest circle
    Then a notification match is created for me
    And I receive a push notification

  # ─── Category Filtering ──────────────────────────────────────────────

  Scenario: Select a single category filter
    When I navigate to "/settings/notification-filters"
    And I select the "Вода" category
    And I click "Запази"
    Then my notification preferences are saved with categories ["water"]
    And I am navigated back to the settings page

  Scenario: Only matching category notifications are delivered
    Given I have notification category filter set to ["water"]
    When a message with category "water" intersects my interest circle
    Then a notification match is created for me
    When a message with category "electricity" intersects my interest circle
    Then no notification match is created for me

  Scenario: Message with multiple categories matches if any category is selected
    Given I have notification category filter set to ["water"]
    When a message with categories ["water", "construction-and-repairs"] intersects my interest circle
    Then a notification match is created for me

  Scenario: Filter for uncategorized messages
    Given I have notification category filter set to ["uncategorized"]
    When a message with no categories intersects my interest circle
    Then a notification match is created for me
    When a message with category "heating" intersects my interest circle
    Then no notification match is created for me

  Scenario: Select all categories
    When I navigate to "/settings/notification-filters"
    And I click "Избери всички" in the Категории section
    Then all 17 categories and "Некатегоризирани" are selected
    And the "Избери всички" button in the Категории section is disabled
    When I click "Запази"
    Then my preferences are saved with all categories selected

  Scenario: Deselect all categories
    Given I have notification category filter set to ["water", "electricity"]
    When I navigate to "/settings/notification-filters"
    And I click "Изчисти всички" in the Категории section
    Then no categories are selected
    And the "Изчисти всички" button in the Категории section is disabled
    When I click "Запази"
    Then my notification preferences are saved with categories []
    And all future messages pass the category filter (no restriction)

  Scenario: "Избери всички" button is disabled when all categories are already selected
    Given I have notification category filter set to all categories
    When I navigate to "/settings/notification-filters"
    Then the "Избери всички" button in the Категории section is disabled

  Scenario: "Изчисти всички" button is disabled when no categories are selected
    Given I have no notification filter preferences saved
    When I navigate to "/settings/notification-filters"
    Then the "Изчисти всички" button in the Категории section is disabled

  # ─── Source Filtering ────────────────────────────────────────────────

  Scenario: Select a single source filter
    When I navigate to "/settings/notification-filters"
    And I select the "Софийска вода" source
    And I click "Запази"
    Then my notification preferences are saved with sources ["sofiyska-voda"]

  Scenario: Only matching source notifications are delivered
    Given I have notification source filter set to ["sofiyska-voda"]
    When a message from source "sofiyska-voda" intersects my interest circle
    Then a notification match is created for me
    When a message from source "toplo-bg" intersects my interest circle
    Then no notification match is created for me

  Scenario: Select all sources
    When I navigate to "/settings/notification-filters"
    And I click "Избери всички" in the Източници section
    Then all sources for my locality are selected
    And the "Избери всички" button in the Източници section is disabled

  Scenario: Deselect all sources
    Given I have notification source filter set to ["sofiyska-voda", "toplo-bg"]
    When I navigate to "/settings/notification-filters"
    And I click "Изчисти всички" in the Източници section
    And I click "Запази"
    Then my notification preferences are saved with sources []
    And all future messages pass the source filter (no restriction)

  Scenario: "Избери всички" button is disabled when all sources are already selected
    Given I have notification source filter set to all sources for my locality
    When I navigate to "/settings/notification-filters"
    Then the "Избери всички" button in the Източници section is disabled

  Scenario: "Изчисти всички" button is disabled when no sources are selected
    Given I have no notification filter preferences saved
    When I navigate to "/settings/notification-filters"
    Then the "Изчисти всички" button in the Източници section is disabled

  # ─── Combined Filters ───────────────────────────────────────────────

  Scenario: Both category and source filters must match
    Given I have notification category filter set to ["water"]
    And I have notification source filter set to ["sofiyska-voda"]
    When a "water" message from "sofiyska-voda" intersects my interest circle
    Then a notification match is created for me
    When a "water" message from "toplo-bg" intersects my interest circle
    Then no notification match is created for me
    When an "electricity" message from "sofiyska-voda" intersects my interest circle
    Then no notification match is created for me

  # ─── Save / Cancel / Clear ──────────────────────────────────────────

  Scenario: Cancel discards unsaved changes
    Given I have notification category filter set to ["water"]
    When I navigate to "/settings/notification-filters"
    And I additionally select the "Електричество" category
    And I click "Отказ"
    Then I am navigated away from the filters page
    When I navigate back to "/settings/notification-filters"
    Then only "Вода" is selected in categories

  Scenario: Browser warns when navigating away with unsaved changes
    Given I have no notification filter preferences saved
    When I navigate to "/settings/notification-filters"
    And I select the "Вода" category
    And I try to close the browser tab without saving
    Then I see a browser confirmation dialog warning me about unsaved changes

  Scenario: Browser does not warn when there are no unsaved changes
    Given I have no notification filter preferences saved
    When I navigate to "/settings/notification-filters"
    And I try to close the browser tab without making any changes
    Then I do not see a browser confirmation dialog

  Scenario: Clear all filters removes all active filters
    Given I have notification category filter set to ["water", "electricity"]
    And I have notification source filter set to ["sofiyska-voda"]
    When I navigate to "/settings/notification-filters"
    And I click "Изчисти всички филтри"
    And I click "Запази"
    Then my notification preferences are saved with categories [] and sources []
    And all future messages are delivered without filtering

  # ─── Persistence & Cross-Device ─────────────────────────────────────

  Scenario: Filter preferences persist across page reloads
    Given I have saved notification filters with categories ["water"] and sources ["sofiyska-voda"]
    When I reload the page
    And I navigate to "/settings/notification-filters"
    Then "Вода" is selected in categories
    And "Софийска вода" is selected in sources

  Scenario: Filter preferences apply across all devices
    Given I have saved notification filters with categories ["water"]
    When I log in on a different device
    And a "water" message intersects my interest circle
    Then a notification match is created for me on both devices
    When an "electricity" message intersects my interest circle
    Then no notification match is created for me on either device

  # ─── Non-Retroactive Behavior ───────────────────────────────────────

  Scenario: Existing notification matches are not affected by new filters
    Given I previously received a notification match for an "electricity" message
    When I set notification category filter to ["water"]
    Then the existing "electricity" notification match still appears in my notification history
    And it is not deleted or hidden

  # ─── Edge Cases ─────────────────────────────────────────────────────

  Scenario: City-wide messages respect filters
    Given I have notification category filter set to ["weather"]
    When a city-wide message with category "weather" is ingested
    Then a notification match is created for me
    When a city-wide message with category "water" is ingested
    Then no notification match is created for me

  Scenario: User with no interest circles receives no notifications regardless of filters
    Given I have no interest circles on the map
    And I have notification category filter set to ["water"]
    When a "water" message is ingested
    Then no notification match is created for me

  Scenario: Unauthenticated user cannot access filters page
    Given I am not logged in
    When I navigate to "/settings/notification-filters"
    Then I am redirected to the home page

  # ─── Experimental Features ─────────────────────────────────────────

  Scenario: Experimental features toggle defaults to disabled
    When I navigate to "/settings/notification-filters"
    Then I see an "Експериментални функции" section with a toggle
    And the toggle is disabled by default

  Scenario: Enable experimental features shows feature list or empty message
    When I navigate to "/settings/notification-filters"
    And I enable "Експериментални функции"
    Then I see a list of experimental sources or a message that there are none currently
    And the "Запази" button is enabled

  Scenario: Experimental source notifications are blocked by default
    Given I have no experimental features enabled
    When a message from an experimental source intersects my interest circle
    Then no notification match is created for me

  Scenario: Experimental source notifications are delivered when opted in
    Given I have enabled experimental features
    When a message from an experimental source intersects my interest circle
    Then a notification match is created for me
