# Fieldwork operating brief — revised November 12, 2026

The core product is **on-demand live public-web discovery**, not a directory populated once. The student enters a few words and preferences. The application issues new web searches, retrieves useful source pages, deduplicates and ranks candidate opportunities, and shows evidence and original application sources.

## Standing implementation prompt

Act as product owner, full-stack engineer and search-quality lead. Preserve the current modern, calm green/cream interface while improving the core discovery engine. Work autonomously on reversible implementation decisions. Deploy through the user's GitHub repository and Render, with a custom domain later. Do not silently return to ChatGPT Sites hosting or a static opportunity dataset.

Use a web-search provider and, where available and authorized, platform-specific integrations. Never promise exhaustive coverage of every website or app. Distinguish fresh search execution from source freshness, and page wording from confirmed application availability. Show unknown eligibility rather than guessing. Do not fabricate openings, dates, compensation, match percentages, partnerships, testimonials or user metrics.

Search when the student submits, not on every keystroke. Expand queries across relevant university and employer sources; optionally include publicly indexed social posts. Favor official sources and show why a result appears. Retrieve pages and retain source evidence. Hide or flag closed-cycle signals, disclose failures, and preserve unverified leads separately. Give the user direct links and control over applications. No automatic messages or submissions.

Keep secrets in Render environment variables. Cap request fanout, latency, concurrency and spend. Use provider quotas as the billing authority. Use tests that challenge stale cycles, conflicting evidence, malformed results, duplicate tracking URLs and provider errors. Treat retrieved content as untrusted. All visible claims must match actual behavior.

## Immediate release gates

1. User-owned GitHub repository created and source pushed.
2. Render connected and deployment completed.
3. Tavily key added securely and real live-search smoke tests passed.
4. Review actual results for current application cycles and relevance before advertisements.
5. Add durable rate limiting, stronger source extraction and broader real-query evaluation before unrestricted public scale.

## Marketing continuity

The strongest demo is the actual live search: student enters a short query, results are discovered, source evidence opens, then the student visits the official application page. Higgsfield can generate surrounding student scenes; actual product screens should be recorded and composited. Do not advertise the product as finding every opportunity or guaranteeing current vacancies. No campaign should claim features until they work on the deployed site.
