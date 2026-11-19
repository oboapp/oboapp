# ERM Zapad compatibility fixtures

These synthetic inputs combine the provider shape and cases protected by
`ingest/crawlers/erm-zapad/index.contract.test.ts`, `extractors.test.ts`,
`builders.test.ts`, `deduplication.test.ts` and `grouping.test.ts` in
`vbuch/oboapp` at commit `0941e72a2d85d5af262af7c6eeb3c4ae45fb1e71`.
They are labelled test data and were not captured from a live incident.

The expected identifiers and content were transcribed from the legacy
implementation without importing the new package. Expected strings preserve the
legacy field order, blank lines, Bulgarian labels and disabled detail link.
Tests set `TZ=UTC` to freeze the legacy process-timezone date behavior.
The first municipality exposes a higher event ID; the
second supplies the matching lower ID and a second point for another event.
This protects global identity selection across municipality boundaries.

These application tests use `provider.json` and `expected.json`. Captured public
provider examples and parser coverage live in the released source package's
[test fixtures](https://github.com/oboapp/sources/tree/source-erm-zapad-v0.1.0/packages/source-erm-zapad/test/fixtures).
The application HTTP mock adds a synthetic UTF-8 BOM and the provider's
`text/html` content type to exercise the transport format.
