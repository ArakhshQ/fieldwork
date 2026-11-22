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

## Accounts (optional)

Students can use everything without an account. Signing in by email link syncs their profile, saved opportunities and applications across devices through Supabase; anything saved in that browser beforehand is moved into the account on first sign-in, and signing out removes the browser's copy.

1. Create a Supabase project and run `supabase/001_accounts.sql` in its SQL Editor. It creates the three tables, row-level security (each student can only read or change their own rows), per-student row caps and `updated_at` triggers. It is safe to re-run.
2. In Supabase → Authentication → URL Configuration, set the Site URL to the deployed address and add `https://<your-site>/**` and `http://localhost:3000/**` as redirect URLs.
3. Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` (or the legacy anon key) on Render. Without them the Sign in button stays hidden and the app works locally as before.

The browser talks to Supabase directly with the publishable key; the server never needs the secret key for this phase. The CSP's `connect-src` is widened only to the configured Supabase origin, and only when it is a valid https URL. Supabase's built-in email sender is heavily rate-limited; connect a custom SMTP provider before launch.

## Live data (no redeploys)

Three free catalogs answer searches instantly. GitHub Actions on `main` rebuild them on a schedule and publish them to the `data` branch:

| File on `data` | Built by | Refresh | Source |
|---|---|---|---|
| `internships.json` | `scripts/collect-internships.mjs` | every 4 hours | Public Greenhouse, Lever and Ashby job boards for `data/employers.json` |
| `research.json` | `scripts/collect-research.mjs` | daily | NSF Award Search API (active REU sites, research grants from the last 120 days) and NIH RePORTER (undergraduate R25 programs, new research grants) |

In production the server downloads each file from `https://raw.githubusercontent.com/ArakhshQ/fieldwork/data/` every 20 minutes (`lib/datasets.mjs`). A failed or older download never replaces the copy in memory. Set `DATA_URL` to use another https location, or to an empty string to turn remote refresh off. Locally and in tests remote refresh is off unless `DATA_URL` is set.

Searches: `GET /api/internships` and `GET /api/research` (both take `q`, `city`, `state`, `radius`, `remote`, `season`). Neither calls a paid provider. The paid web search (`POST /api/search`) runs alongside for research and on request for internships.

Note: GitHub pauses scheduled workflows in public repositories after 60 days without repository activity. If the data stops updating, re-enable the workflows from the Actions tab.

## Pro: AI Studio

Pro students get a team of AI tools (`lib/tools.mjs`, routes in `lib/pro-routes.mjs`). All of them use the student's profile and résumé, fence fetched or pasted text as data, and clamp every output.

| Tool | Route | Model |
| --- | --- | --- |
| Lab briefing + professor email | `/api/pro/briefing`, `/api/pro/email` | Claude Opus 5.5 (effort medium) |
| Résumé / essay review (score, line fixes, tailoring or a revised essay) | `/api/pro/review` | Claude Opus 5.5 |
| Résumé import (PDF read by Claude; .docx unzipped on the server, never stored) | `/api/pro/resume-import` | Claude Haiku 5.5 for PDFs |
| Application builder (eligibility, deadline, checklist, drafted answers, plan) | `/api/pro/application` | Claude Opus 5.5 |
| Interview practice (5 questions, feedback per answer) | `/api/pro/interview/start`, `/answer` | Claude Sonnet 5.5 |
| Recommendation-letter kit (request email, brag sheet, timeline) | `/api/pro/letter` | Claude Sonnet 5.5 |
| Coach chat, streamed over SSE | `/api/pro/coach` | Claude Sonnet 5.5 |

The application builder only shows a deadline when its quote appears word for word on the page, and drops quotes it can't find. Lab emails are only shown when the address appears verbatim on an academic page. Fieldwork never sends email; drafts open in the student's own Gmail or Outlook.

Access (`lib/pro.mjs`): Pro preview codes (`PRO_PREVIEW_CODES`) work now; once accounts are on, an active Paddle subscription unlocks Pro. Monthly limits for Pro: 30 briefings, 60 emails, 15 reviews, 15 applications, 10 interviews, 10 letter kits, 10 imports and 150 chat messages (about half for preview codes), enforced in the database by `consume_ai_quota()` for subscribers. Inputs are validated before any allowance is used. `AI_DAILY_BUDGET_USD` (default 10) pauses all AI calls for the rest of the UTC day once reached. Each call's cost is logged to the server log.

Billing (`lib/paddle.mjs`, `/upgrade`): Paddle.js loads only on the checkout page, which has its own CSP. `POST /api/paddle/webhook` verifies the `Paddle-Signature` HMAC on the raw body and upserts the subscription into Supabase with the server-only `SUPABASE_SECRET_KEY`. Run `supabase/001_accounts.sql`, `002_billing.sql` and `003_tools.sql` in order.

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

Server-side API key; no secret keys in frontend assets. Static files are served only from `public/`, only for an allowlist of file types, with dotfiles and path traversal rejected. Fonts and the Supabase client are self-hosted, so no third-party script or font hosts are contacted. CSP, safe URL schemes, plain-text rendering, request limits and same-origin checks are included. No arbitrary URLs are fetched by the Node server; extraction is delegated to the search provider for returned public URLs.

Searches and preferences are sent to Tavily. Do not enter sensitive personal information. This app adds no analytics and logs neither query bodies nor credentials. Hosting and provider services may retain their own logs. Saved items remain in the student's browser.

The daily, concurrency and request-rate circuit breakers are **per server instance and reset on restart**. They are not billing guarantees. Set a provider quota and use durable shared rate limiting / real authentication before an unrestricted public launch. Forwarded IP headers are intentionally ignored rather than trusting spoofable values; behind a proxy, the per-minute limit can be shared across visitors. A beta access code is not a full user-account system.

## Verification

`npm run check` checks JS syntax. `npm test` uses the built-in Node test runner with a mocked provider to test live-call orchestration, no caching, tracking-URL deduplication, source/claim distinctions, partial failures, configuration errors, safe URLs, API secrecy and request controls. These tests do **not** prove the live API integration works with your account. After adding a real key, verify biology research, software internship, geography, remote, social leads, no-result queries and provider quota failures on Render.

## Files

- `server.mjs`: Node server, routes, guards and static assets
- `lib/search.mjs`: query planning, provider adapter, deduplication, evidence analysis
- `public/index.html`, `public/style.css`: the interface
- `public/js/`: ES modules — `main` (routing), `store` (local + synced data), `discover` (sentence search and results), `cards`, `saved` (compare), `applications` (drag-and-drop board), `profile` (profile and sign-in), `ui` (helpers)
- `public/vendor/`, `public/fonts/`: self-hosted Supabase client (v2.119.0) and fonts (Young Serif, Schibsted Grotesk; SIL Open Font License)
- `supabase/001_accounts.sql`: database tables and security rules
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
