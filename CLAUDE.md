# North Star Media & Journalist Dossiers — Claude Context

This file gives Claude persistent context across sessions. Update it whenever the system architecture, conventions, or key decisions change.

---

## What this system is

An internal journalist CRM for **North Star AI Labs**. It helps the team track AI/tech journalists, manage outreach campaigns, and discover new publications to pitch to. All data is stored locally (SQLite). Not a public product.

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React + TypeScript + Vite (port 5173) |
| Backend | Express + TypeScript (port 3001) |
| Database | SQLite via `better-sqlite3` at `data/northstar.db` |
| Styling | Tailwind CSS v3 with custom `northstar` indigo palette |
| AI | Anthropic Claude Opus 4.8 with `thinking: { type: 'adaptive' }` |
| Node | v20 — use `~/.nvm/versions/node/v20.20.0/bin/node` |

**Important:** `verbatimModuleSyntax: true` in tsconfig — always use `import type` for type-only imports.

**Bash prefix:** Always prepend `CLAUDE_CODE_TMPDIR=/tmp` to bash commands (ENOSPC workaround on this machine).

---

## Running the project

```bash
# Backend (from /server)
npm run dev        # runs on :3001

# Frontend (from /client)
npm run dev        # runs on :5173
```

---

## Project structure

```
northstar-journalist-dossiers/
├── client/src/
│   ├── pages/           # One file per route/page
│   ├── components/      # Shared UI components
│   ├── api.ts           # All API calls (axios)
│   └── types.ts         # Shared TypeScript interfaces
├── server/src/
│   ├── routes/          # Express routers (one per resource)
│   ├── services/        # Background jobs, AI calls, discovery
│   ├── db.ts            # SQLite setup + schema migrations
│   └── index.ts         # Express app + route registration
├── data/
│   └── northstar.db     # SQLite database (gitignored)
├── docs/                # Project documentation (synced to GitBook)
└── CLAUDE.md            # This file
```

---

## Database schema (key tables)

| Table | Purpose |
|---|---|
| `journalists` | Core journalist profiles with scores |
| `articles` | Articles written by journalists |
| `outreach_logs` | Every pitch/contact logged |
| `publications` | Target outlets (Tier A/B/C) |
| `publication_feeds` | RSS feeds per publication |
| `publication_suggestions` | AI-suggested publications pending review |
| `journalist_suggestions` | RSS-discovered journalists pending review |
| `campaigns` | Outreach campaigns |
| `campaign_journalists` | Many-to-many: campaigns ↔ journalists + draft |
| `campaign_type_styles` | House style instructions per campaign type |
| `coverage` | Press articles written about North Star AI Labs |

**Migration pattern:** Use `PRAGMA table_info` to check if a column exists before ALTER TABLE.

---

## Key conventions

### Scoring (out of 100)
- AI Relevance: 25pts
- Startup Relevance: 20pts
- North Star Fit: 20pts
- Publication Authority: 15pts
- Audience Reach: 10pts
- Contactability: 10pts

### Journalist tiers (derived from score)
- Tier 1: 80–100
- Tier 2: 60–79
- Tier 3: 40–59
- Tier 4: below 40

### Publication tiers
- **A**: Major Tech & AI (TechCrunch, Wired, MIT Tech Review)
- **B**: Business / Mid-tier (Forbes, Fast Company, Bloomberg Tech)
- **C**: Regional & Niche (Hypepotamus, local outlets, newsletters)

### Outreach status flow
Not Started → Ready to Pitch → Pitched → Responded / No Response → Covered / Declined

Auto-synced from outreach_logs on every log entry.

---

## API conventions

- Base URL: `http://localhost:3001/api`
- All responses are JSON
- Errors return `{ error: string }` with appropriate HTTP status
- Background jobs respond immediately with `{ message: '...' }` then run async

### Route order matters (Express)
Specific routes before parameterised ones:
- `/campaigns/styles` before `/campaigns/:id`
- `/enrichment/bulk/run` before `/enrichment/:id`
- `/publications/discover` before `/publications/:id`

---

## AI integrations

### Claude (Anthropic)
- Model: `claude-opus-4-8` with `thinking: { type: 'adaptive' }`
- Used for: journalist scoring, campaign draft generation, publication discovery suggestions
- House style injected into every draft prompt from `campaign_type_styles` table
- File: `server/src/services/campaignDraftService.ts`

### Apollo People Match API
- Endpoint: `POST https://api.apollo.io/v1/people/match`
- Key stored in `server/.env` as `APOLLO_API_KEY`
- Used for email enrichment per journalist
- Rate limit: 1.2s delay between bulk calls
- File: `server/src/routes/enrichment.ts`

---

## Blog / publication discovery

Three sources queried in parallel via `Promise.allSettled`:
1. **Feedly** — `GET https://cloud.feedly.com/v3/search/feeds` (no auth)
2. **Substack** — `GET https://substack.com/api/v1/search` (no auth)
3. **Medium** — RSS tag feeds derived from query keywords

File: `server/src/services/blogDiscovery.ts`

---

## Automated jobs (cron)

| Job | Schedule | What it does |
|---|---|---|
| RSS article refresh | Fridays 7am | Fetches new articles from all active feeds |
| Publication health check | Weekly | Checks RSS feed reachability |
| Claude publication suggestions | Weekly | AI suggests new publications to track |

---

## Security constraints (non-negotiable)

- Do NOT scrape websites or automate email sending
- Do NOT guess private email addresses
- Only use public professional contact info entered manually or via Apollo API
- All AI/RSS suggestions require human approval before being added
- All outreach must be human-reviewed — no automated sending
- Never commit API keys or `.env` files

---

## Sidebar navigation

**Main:** Dashboard · Journalists · Campaigns · Activity Feed · Press Coverage

**Admin:** Publications · RSS Suggestions · House Style · Export Data

---

## Pages and routes

| Route | Page | Purpose |
|---|---|---|
| `/dashboard` | Dashboard | Stats, campaign pipeline, onboarding checklist |
| `/journalists` | JournalistsList | Filterable list with bulk Apollo enrichment |
| `/journalists/:id` | JournalistDetail | Profile, scores, outreach history, briefing tab |
| `/journalists/new` | JournalistForm | Add / edit journalist |
| `/campaigns` | CampaignList | All campaigns with status |
| `/campaigns/:id` | CampaignDetail | Journalist picker, draft review, email pack |
| `/campaigns/styles` | CampaignStyles | House style instructions per campaign type |
| `/activity` | ActivityFeed | Chronological outreach log across all journalists |
| `/coverage` | CoveragePage | Track press articles written about North Star |
| `/export` | ExportPage | CSV export of journalists / articles / outreach |
| `/admin/publications` | AdminPublications | Manage publications, feeds, discovery |
| `/admin/publications/:id` | PublicationDetail | Journalists at a specific publication |
| `/admin/journalist-suggestions` | AdminJournalistSuggestions | Review RSS-discovered journalists |

---

## Deployment plan (future)

- Frontend: Netlify
- Backend: Railway
- Database: Migrate from SQLite to PostgreSQL (Railway managed)
- Currently running fully local

---

## Last updated

2026-06-28 — UX audit pass: sidebar restructured, onboarding checklist added, Dossier tab replaced with Briefing tab, publication row actions consolidated, "Run Discovery" renamed to "Suggest with AI".
