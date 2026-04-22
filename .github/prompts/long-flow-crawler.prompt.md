---
description: "Plan the implementation of a new crawler that uses the long ingestion flow."
agent: Plan
---

**This prompt activates the Long-Flow Crawler Generator skill** (`skills/long-flow-crawler-generator/SKILL.md`).

Plan the implementation of a new crawler (/ingest/crawlers). It should work similar to sofia-bg, rayon-oborishte-bg and mladost-bg since it does not provide ready GeoJSON. This means that its output will go through the long ingestion flow. The addition of a source requires changes in both /ingest (for adding the crawler and documentation) and /web (for adding the source logo and metadata).

When planning pagination/feed retrieval, prefer first-page-only and small record limits by default when results are sorted newest-first. If uncertain between fetching many vs few records, choose few; historical coverage will accumulate over time.
