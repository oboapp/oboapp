Feature: Message ingestion and notification delivery
  As the oboapp system
  I want to ingest source content, extract structured data via the AI pipeline,
  and notify users whose interests match the event location and category
  So that users receive timely, relevant, and non-stale notifications

  # ─── Scenario group 1: Content from the source ──────────────────────────────

  Scenario: Fresh current-day announcement is ingested and produces a valid timespan
    Given a source publishes an announcement about an event happening today
    And the announcement includes a full date (DD.MM.YYYY HH:MM) in the text
    When the crawler fetches the announcement
    And the ingest pipeline runs the AI extract-locations step
    Then the stored message has a "timespanStart" equal to the event date
    And the stored message has a "timespanEnd" equal to or after the event date
    And neither "timespanStart" nor "timespanEnd" equals "crawledAt"

  Scenario: Announcement mentions only day and month without a year
    Given a source publishes an announcement about an event on "16 май от 16:00"
    And the announcement does not include the year in the date
    When the ingest pipeline runs the AI extract-locations step with the crawl date as context
    Then the stored "timespanStart" uses the current year (not a past year like 2024)
    And the stored "timespanEnd" uses the current year

  Scenario: Stale article crawled late — event date is in the past
    Given a source published an announcement about an event that happened 3 days ago
    And the crawler fetches this article today (after the event has passed)
    And the AI pipeline correctly extracts the past event date
    When the notification job runs
    Then no push notification is sent for this message
    And the message is logged as skipped due to "timespanEnd in the past"

  Scenario: Announcement with no extractable date falls back to crawledAt
    Given a source publishes an announcement with no date information in the text
    When the ingest pipeline runs the AI extract-locations step
    Then the stored "timespanStart" equals "crawledAt"
    And the stored "timespanEnd" equals "crawledAt"

  # ─── Scenario group 2: AI pipeline correctly parses content ──────────────────

  Scenario: AI pipeline extracts location pin from a point-address announcement
    Given a crawled message contains "ул. Оборище 15 от 08:00 до 18:00 на 25.12.2026 г."
    When the ingest pipeline runs the AI extract-locations step
    Then the result contains exactly 1 pin with address "ул. Оборище 15"
    And the pin has a timespan with start "25.12.2026 08:00" and end "25.12.2026 18:00"

  Scenario: AI pipeline marks city-wide messages correctly
    Given a crawled message describes a restriction that applies across the entire city
    When the ingest pipeline runs the AI extract-locations step
    Then the result has "cityWide" set to true
    And the result has no pins and no streets

  Scenario: AI pipeline produces no timespan for open-ended event
    Given a crawled message says the restriction is "до отпадане на необходимостта"
    When the ingest pipeline runs the AI extract-locations step
    Then the pin or street timespan has "end" set to null
    And the stored "timespanEnd" is set to "timespanStart" plus 7 days

  # ─── Scenario group 3: Notifications based on user interests ─────────────────

  Scenario: User with a matching interest circle receives a notification
    Given a finalized message with a GeoJSON point inside a user's interest circle
    And the message category matches the user's notification category filter
    And the message "timespanEnd" is in the future
    When the notification job runs
    Then a notification match is stored for that user
    And a push notification is sent to the user's registered device

  Scenario: User with a non-matching interest circle does not receive a notification
    Given a finalized message with a GeoJSON point outside all of a user's interest circles
    When the notification job runs
    Then no notification match is stored for that user
    And no push notification is sent to that user

  Scenario: User with category filter that excludes the message category is not notified
    Given a finalized message categorized as "traffic"
    And the user's notification filter includes only the "water" category
    When the notification job runs
    Then no notification match is stored for that user

  Scenario: User with matching interest but event already past is not notified
    Given a finalized message with a GeoJSON point inside a user's interest circle
    And the message "timespanEnd" is 2 days in the past
    When the notification job runs
    Then no notification match is stored for that user
    And the message is logged as skipped due to "timespanEnd in the past"

  Scenario: Two users — one matching, one not — receive independent outcomes
    Given a finalized, non-stale message near user A's interest circle
    And the same message is far from user B's interest circle
    When the notification job runs
    Then user A receives a push notification
    And user B does not receive a push notification
