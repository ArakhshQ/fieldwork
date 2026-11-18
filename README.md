# Fieldwork: live opportunity search

A portable, dependency-free Node.js app for **GitHub → Render**, replacing the earlier fixed-list prototype. Every submitted search invokes public-web search, then reads discovered pages. No prefilled opportunity database, hard-coded company list or app-level search-result cache is used.

## Run locally

Requires Node 22 or 24.

```sh
npm ci
cp .env.example .env
# Set TAVILY_API_KEY in .env using your editor.
npm test
npm start
```

Visit http://localhost:3000. Without a key the interface works, but live search returns a clear setup error. It never substitutes demonstration listings.

## Deploy to Render

1. Create a GitHub repository, e.g. `fieldwork`, and push this directory's contents to it. Private is suitable for initial development. Do not upload a ZIP as the repository's sole file; Render needs `package.json` at the repository root.
2. In Render, choose **New → Blueprint**, connect the repository and use the included `render.yaml`. Alternatively choose **New → Web Service** and set:
   - Runtime: Node
   - Build command: `npm ci && npm run check && npm test`
   - Start command: `npm start`
   - Health check: `/health`
   - Node version: `22.16.0`
3. Add **TAVILY_API_KEY** through Render's environment settings. Get a key from https://app.tavily.com . Keep it out of GitHub, the browser and chat.
4. Optionally set `SEARCH_ACCESS_CODE` for a small private beta. The page will request this code; the Tavily key is never exposed.
5. Deploy. Open the resulting `onrender.com` address and run a real search before inviting students. A successful health check proves the server runs; it does not prove the provider key or billing works.
6. Later add the purchased domain in Render's Custom Domains settings and configure the exact DNS records Render gives you. No domain purchase is required now.

The blueprint requests Render's free web-service plan. Confirm current availability and limits in your account. Search API usage may incur charges; set provider-side quotas/spend controls before a public launch. The application makes 2–4 search calls plus up to one extract call per request, with at most 16 pages submitted for extraction. Provider credits are not equivalent to HTTP call counts.

## Search flow

1. Validate a short query and preferences for type, geography, remote work, funding, and optional public social discovery.
2. Generate broad opportunity, university-research and employer-internship queries as applicable, using the current year and next year unless the student specifies a year.
3. Call Tavily Search in parallel; merge canonical URLs and remove tracking parameters.
4. Request full text for up to 16 relevant results via Tavily Extract.
5. Return short source excerpts, source type, discovery time, retrieval time and cautious availability signals. Rank by provider relevance, domain hints and explicit open wording.
6. Let the student follow the source, inspect evidence or save a browser-local snapshot.

Preferences shape queries, not strict eligibility filters. The page has separate local filters for open wording and closed wording. Social posts remain leads, even when they say applications are open.

## What “live” does and does not mean

- Each submitted search contacts the provider anew. The provider uses its own search index and extraction infrastructure, whose freshness is outside this app's control.
- It cannot search every website, private group, login-only app or unindexed post. “Include public social leads” is a domain-targeted public-web query, not a native authenticated social API integration.
- “Open wording found” is **not “verified open.”** Pages may contain old cycles, multiple programs or conflicting information. The algorithm is conservative and rules-based; it does not infer personal eligibility.
- The current app does not use an LLM or automatically extract reliable structured deadlines/locations. Source excerpts are shown instead of fabricated fields. Add model-based structured extraction only with evidence validation, adversarial tests and additional provider configuration.
- Pages that cannot be read remain unverified leads. Partial query failures are disclosed. Total provider failure is an error, not stale cached results.
- Saving does not recheck a page. Saved snapshots include their original discovery time.

## Security and privacy

Server-side API key; no keys embedded in frontend assets. An explicit static-file allowlist prevents serving `.env` or source files. CSP, safe URL schemes, plain-text rendering, request limits and same-origin checks are included. No arbitrary URLs are fetched by the Node server; extraction is delegated to the search provider for returned public URLs.

Searches and preferences are sent to Tavily. Do not enter sensitive personal information. This app adds no analytics and logs neither query bodies nor credentials. Hosting and provider services may retain their own logs. Saved items remain in the student's browser.

The daily, concurrency and request-rate circuit breakers are **per server instance and reset on restart**. They are not billing guarantees. Set a provider quota and use durable shared rate limiting / real authentication before an unrestricted public launch. Forwarded IP headers are intentionally ignored rather than trusting spoofable values; behind a proxy, the per-minute limit can be shared across visitors. A beta access code is not a full user-account system.

## Verification

`npm run check` checks JS syntax. `npm test` uses the built-in Node test runner with a mocked provider to test live-call orchestration, no caching, tracking-URL deduplication, source/claim distinctions, partial failures, configuration errors, safe URLs, API secrecy and request controls. These tests do **not** prove the live API integration works with your account. After adding a real key, verify biology research, software internship, geography, remote, social leads, no-result queries and provider quota failures on Render.

## Files

- `server.mjs`: Node server, routes, guards and static assets
- `lib/search.mjs`: query planning, provider adapter, deduplication, evidence analysis
- `public/`: responsive interface, filters, evidence dialogs and local bookmarks
- `test/`: behavior and API tests
- `render.yaml`: Render deployment blueprint
- `.github/workflows/test.yml`: GitHub CI
- `PRODUCT_BRIEF.md`: updated autonomous build specification

## Primary documentation

- Tavily Search: https://docs.tavily.com/documentation/api-reference/endpoint/search
- Tavily Extract: https://docs.tavily.com/documentation/api-reference/endpoint/extract
- Render Node deployment: https://render.com/docs/deploy-node-express-app
- Render Blueprint: https://render.com/docs/blueprint-spec

## Student workspace v2

Free: expanded discovery preferences, source-evidence result filters, sorting, local profile, saved-opportunity comparison, manual application tracking, export and deletion. Workspace information stays in the browser. No authentication, billing, cloud sync or AI submissions are enabled.

Basic and Pro are explicitly planned. Pro includes a working manual preparation checklist preview, not a running agent. Before commercial launch: establish the operator identity and private contact channel; review policy pages for the actual jurisdictions and data flows; implement secure accounts, document storage, per-user entitlements, provider cost limits and durable job processing. Choose and connect an AI provider. Support application destinations individually, request missing materials, and require review of the exact application before submission. Record a real destination receipt before reporting a submission as successful. Never infer sensitive demographic answers or fabricate qualifications.
