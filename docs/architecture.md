# System Architecture

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React + TypeScript + Vite |
| Backend | Express + TypeScript |
| Database | PostgreSQL (Railway managed) |
| Styling | Tailwind CSS v3 |
| AI | Anthropic Claude Opus 4.8 |
| Email enrichment | Apollo People Match API |

## Deployment

The system is fully cloud-hosted — no local installation needed for team members.

| Service | Platform | URL |
|---|---|---|
| Frontend | Netlify | https://classy-pegasus-00cc40.netlify.app |
| Backend API | Railway | https://northstar-journalist-dossiers-production.up.railway.app |
| Database | Railway (PostgreSQL) | Internal — accessed only by the backend |

The frontend is a static React app deployed on Netlify's free tier. The backend is an Express server running on Railway (~$5/month). The PostgreSQL database is a managed Railway add-on with a persistent volume.

## Local development

To run locally, you need Node.js v20 and both services running:

```bash
# Backend (from /server)
npm run dev        # runs on :3001

# Frontend (from /client)
npm run dev        # runs on :5173
```

Set `DATABASE_URL` in `server/.env` to point at the Railway PostgreSQL instance (or a local Postgres).

## Data flow

```
RSS Feeds → RSS Scanner → Journalist Suggestions → (human review) → Journalist Profiles
                                                                            ↓
                                                              Claude AI Scoring
                                                                            ↓
                                                              Campaigns → Claude Drafts → Outreach Logs
```

## Key files

| File | Purpose |
|---|---|
| `server/src/db.ts` | PostgreSQL schema, migrations, and seed data |
| `server/src/routes/` | API endpoints (one file per resource) |
| `server/src/services/` | Background jobs, Claude calls, RSS parsing |
| `client/src/pages/` | One React component per page |
| `client/src/api.ts` | All frontend API calls (uses `VITE_API_URL` env var) |
| `client/src/types.ts` | Shared TypeScript interfaces |
| `CLAUDE.md` | Persistent context for Claude AI across sessions |
| `nixpacks.toml` | Pins Node.js 20 for Railway builds |
| `netlify.toml` | Netlify build config (base dir, redirects) |
| `railway.json` | Railway build and deploy config |
