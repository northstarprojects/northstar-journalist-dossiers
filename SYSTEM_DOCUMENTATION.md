# North Star Media & Journalist Dossiers — System Documentation

**Version:** MVP v1.4
**Organization:** North Star AI Labs  
**Last Updated:** June 2026

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture](#2-architecture)
3. [Publication Management](#3-publication-management)
4. [Publication Discovery](#4-publication-discovery)
5. [Journalist Discovery](#5-journalist-discovery)
6. [Journalist Records & Scoring](#6-journalist-records--scoring)
7. [Contact Information](#7-contact-information)
8. [Outreach Workflow](#8-outreach-workflow)
9. [Data Health & Maintenance](#9-data-health--maintenance)
10. [Data Storage & Export](#10-data-storage--export)
11. [Ethics & Constraints](#11-ethics--constraints)
12. [Roadmap](#12-roadmap)

---

## 1. System Overview

**North Star Media & Journalist Dossiers** is a journalist CRM built for North Star AI Labs' PR and communications team. It combines automated discovery with human review to build and maintain a high-quality list of journalists to pitch.

**Core capabilities:**
- Manage a curated list of publications with tier classification, per-publication RSS feed registry, and health monitoring
- Automatically discover new publications via Claude AI (weekly) and OPML import
- Automatically discover AI/tech category-specific RSS feeds within publications (on-demand)
- Automatically discover journalists via RSS feed scanning (weekly) and staff page crawling (on-demand), scored for relevance
- Score and prioritize journalists based on AI/startup relevance and overall reach
- Track all outreach — every email, pitch, and follow-up in one place
- Export data for use in broader communications workflows

**Design principle:** Every journalist record is human-reviewed before being added. Every outreach message is written and sent by a person. Automation handles discovery and suggestions — humans make all final decisions.

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                           FRONTEND                               │
│             React + TypeScript + Vite (port 5173)                │
│                                                                  │
│  Dashboard · Journalists List · Journalist Detail                │
│  Add/Edit Journalist · Export                                    │
│  Admin → Publications  (feeds, discovery, OPML import)          │
│  Admin → RSS Suggestions  (journalist review queue)              │
└─────────────────────────────┬────────────────────────────────────┘
                              │ REST API (Axios)
                              │ http://localhost:3001/api
┌─────────────────────────────▼────────────────────────────────────┐
│                           BACKEND                                │
│                 Express + TypeScript (port 3001)                 │
│                                                                  │
│  /api/journalists            CRUD for journalist records         │
│  /api/articles               Articles per journalist             │
│  /api/outreach               Outreach log per journalist         │
│  /api/dashboard              Stats, follow-up queue             │
│  /api/publications           CRUD, feeds, OPML, discovery        │
│  /api/suggestions            Publication suggestion review       │
│  /api/journalist-suggestions Journalist suggestion review        │
│  /api/health-check           Publication & journalist health     │
│                                                                  │
│  Cron #1  Monday 8am ET    — Claude publication discovery        │
│  Cron #2  Wednesday 7am ET — RSS journalist discovery            │
│  Cron #3  1st of month 6am — Health checks & stale flags        │
└─────────────────────────────┬────────────────────────────────────┘
                              │ better-sqlite3
┌─────────────────────────────▼────────────────────────────────────┐
│                  SQLite  (data/northstar.db)                     │
│                                                                  │
│  journalists · articles · outreach_logs                          │
│  publications · publication_feeds                                │
│  publication_suggestions · journalist_suggestions                │
└───────────────┬──────────────────────────┬───────────────────────┘
                │                          │
         ┌──────▼──────┐           ┌───────▼──────┐
         │  Claude API  │           │  RSS + HTTP  │
         │  Opus 4.8    │           │  cheerio     │
         │  (Anthropic) │           │  rss-parser  │
         └─────────────┘           └──────────────┘
```

### Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS v3 |
| Backend | Express, TypeScript, Node.js |
| Database | SQLite via better-sqlite3 |
| AI | Anthropic Claude Opus 4.8 (adaptive thinking) |
| RSS parsing | rss-parser, cheerio, axios |
| Scheduling | node-cron |

### Environment variables

```bash
ANTHROPIC_API_KEY=sk-ant-...   # Required for Claude AI features
PORT=3001                       # Optional, defaults to 3001
```

The system runs without `ANTHROPIC_API_KEY` — Claude features log an error and skip, everything else works normally.

---

## 3. Publication Management

### 3.1 Tier System

Every publication is classified as Tier A, B, or C. Tier drives outreach prioritisation — which publications to research first, and how to weight a journalist's authority score.

---

**Tier A — Major Tech & AI**

Large-audience national publications where AI and tech is the primary editorial focus. High domain authority, broad reach across investors, journalists, hires, and customers simultaneously.

*Examples: TechCrunch, Wired, MIT Technology Review, The Verge, VentureBeat, Ars Technica*  
*Best for: Major funding, product launches, research breakthroughs — anything with broad industry significance.*

---

**Tier B — Business / Mid-Tier**

Business publications with a dedicated tech or AI desk. Audience skews toward executives, decision-makers, and investors. Less technical depth, more business and strategy focus.

*Examples: Forbes Technology, Fortune Tech, Fast Company, Inc. Magazine, Bloomberg Technology, WSJ Tech*  
*Best for: Funding rounds, leadership profiles, enterprise AI adoption stories.*

---

**Tier C — Regional & Niche**

Regional outlets (especially Southeast US and Atlanta), AI-specific newsletters, and emerging vertical publications. Smaller but highly targeted audiences.

*Examples: Hypepotamus, Atlanta Business Chronicle, AJC, GeekWire, AI newsletters*  
*Best for: Local ecosystem stories, Southeast startup coverage, targeted AI audience outreach.*

> Tier C is not lower priority — it is more targeted. For a Southeast-based AI startup, a Hypepotamus story often generates more relevant local buzz than a brief mention in a national Tier B outlet.

---

### 3.2 Publication Record Fields

| Field | Description |
|---|---|
| **Name** | Display name |
| **URL** | Homepage — used for feed discovery, health checks, and staff page scanning |
| **Tier** | A, B, or C |
| **Focus** | Short beat description |
| **Notes** | Internal admin notes |
| **RSS Status** | Aggregated status across all feeds: `active` / `inactive` / `none` / `unknown` |
| **Health Status** | `healthy` / `unreachable` / `unknown` — updated monthly |
| **Active** | Toggle — inactive publications are hidden from the journalist form dropdown |
| **Virtual** | Flag for Google News RSS feeds and other synthetic sources |

### 3.3 Publication Feeds (`publication_feeds` table)

Each publication can have **multiple RSS feeds** — a main feed and any number of category/section feeds. This is stored in the `publication_feeds` table (one-to-many from publications).

| Feed type | Description |
|---|---|
| **Main** | The publication's primary RSS feed (e.g. `techcrunch.com/feed/`) |
| **Category** | A topic-specific section feed (e.g. `/ai-artificial-intelligence/rss/index.xml`) |

**Why category feeds matter:** The main feed for a large publication like The Verge contains everything — consumer gadgets, gaming, entertainment, and AI. The AI section feed (`/ai-artificial-intelligence`) only contains AI articles. Scanning the section feed produces far higher-quality journalist suggestions with less noise.

**Feed panel:** Click the **Feeds** counter on any publication row to expand an inline panel showing all configured feeds, their type, RSS status, and URL. Individual feeds can be removed from the panel.

### 3.4 Virtual Publications

Three **Virtual** publications are pre-seeded. They are Google News RSS search feeds, processed by the same journalist discovery pipeline as real publications:

| Virtual Publication | Search Query |
|---|---|
| Google News: AI Startups | `AI startup funding` |
| Google News: Atlanta Tech | `Atlanta tech startup` |
| Google News: Generative AI | `generative AI LLM` |

Virtual publications are marked with a purple **Virtual** badge in the table. You can edit their RSS URL to change the search query at any time. They do not support category feed discovery (no homepage to scan).

### 3.5 RSS Auto-Discovery

When a publication is saved without an RSS URL, the system automatically tries to find one in the background:

1. Reads the publication's homepage HTML and looks for `<link rel="alternate" type="application/rss+xml">`
2. Tries 8 common feed paths: `/feed`, `/rss`, `/feed.xml`, `/atom.xml`, `/rss.xml`, `/feed/rss2`, `/?feed=rss2`, `/index.xml`
3. Validates each candidate by actually parsing it as RSS
4. If found, saves it to `publication_feeds` as the Main feed
5. If not found, sets status to `none`

### 3.6 Row Actions (hover a row to reveal buttons on the right)

| Button | When to use |
|---|---|
| **⚡ Discover feeds** | First thing to do on any new publication. Scans the homepage for AI/tech/startup section pages (e.g. `/ai-artificial-intelligence`) and checks each one for an RSS feed. Takes ~20 seconds. After it runs, the Feeds count on the row updates and you can expand the panel to see what was found. Run this once per publication, then again if the site adds new sections. |
| **⬛ Scan journalists** | After feeds are set up, click this to scan all feeds for that publication right now and add journalist suggestions to your queue. Useful if you just added a new category feed and want to see results immediately without waiting for Wednesday's cron job. |
| **📖 Deep scan** | Alternative discovery method — crawls the publication's `/staff`, `/authors`, or `/team` page to find journalists who haven't published recently and wouldn't appear in RSS. Use this when RSS scanning returns few results for a publication. Does not work on JavaScript-rendered pages. |
| **✏️ Edit** | Update the publication's name, URL, tier, focus, or RSS feed URL manually. |
| **🗑️ Delete** | Remove the publication. Journalist records already accepted from this publication are unaffected. |

**Typical workflow for a new publication:**
1. Add it (or accept it from the suggestions banner)
2. Click **⚡** to discover category feeds — wait 20s
3. Click **⬛** to scan for journalists immediately, or wait for Wednesday's automatic scan
4. Go to **RSS Suggestions** to review what was found

---

## 4. Publication Discovery

Publications can be added manually, suggested by Claude, or imported in bulk via OPML.

### 4.1 Category Feed Discovery (On-Demand)

Many publications segment their content by topic and expose a dedicated RSS feed for each section. For example:

| Publication | Section | Category RSS |
|---|---|---|
| The Verge | `/ai-artificial-intelligence` | `/ai-artificial-intelligence/rss/index.xml` |
| TechCrunch | `/category/artificial-intelligence` | `/category/artificial-intelligence/feed/` |
| Wired | `/tag/artificial-intelligence` | `/feed/tag/artificial-intelligence/rss` |
| Ars Technica | `/ai` | `/ai/feed` |

**How to trigger:** Hover a publication row → click the **⚡ button** → wait ~20 seconds → click **Feeds** to see what was found.

**How it works:**

1. Fetches the publication's homepage HTML
2. Extracts all `<a>` link hrefs and text, filtering to same-domain links whose path or anchor text matches an AI/startup/tech keyword set:
   - AI keywords: `ai`, `artificial-intelligence`, `machine-learning`, `generative-ai`, `llm`, etc.
   - Startup keywords: `startup`, `funding`, `venture`, `enterprise`, `fintech`
   - Tech keywords: `tech`, `technology`, `software`, `developer`, `innovation`
3. For each matching section URL, probes 10 common RSS suffix patterns: `/feed/`, `/rss/index.xml`, `?format=rss`, `?rss=y`, etc.
4. Validates each candidate by parsing it — only URLs that return real feed items are saved
5. Saves up to 6 new category feeds per publication to `publication_feeds`
6. Deduplicates against existing feeds (same URL won't be added twice)

Discovered feeds are immediately included in future RSS scans alongside the main feed.

### 4.2 Weekly Claude Publication Discovery (Mondays 8am ET)

Claude Opus 4.8 runs every Monday morning and suggests up to 5 new publications. It receives the full current list, tier definitions, and North Star AI Labs' mission context, then proposes publications not already tracked.

**Quality filter:** Claude is instructed to return fewer suggestions (or none) if no genuinely strong candidates exist. An empty result produces no notification.

**Deduplication:** Suggestions are filtered against existing publications, already-pending suggestions, and anything rejected within the last 30 days.

**Admin review:** Pending suggestions appear as an amber banner on the Publications page. Each suggestion shows name, URL, tier, focus, and Claude's reasoning. Accept → added immediately to the publications list. Reject → archived for 30 days.

**Manual trigger:** The **"Run Discovery"** button runs the same Claude job immediately.

### 4.3 OPML Import

Import feeds in bulk from any RSS reader or publication directory.

**How to get an OPML file:**
- **Feedspot:** Go to a curated list (e.g. [feedspot.com/ai_blogs](https://blog.feedspot.com/ai_blogs/)) → scroll to the bottom → click "OPML"
- **Feedly:** Settings → Organize → Export OPML
- **Inoreader:** Settings → Export → OPML
- **NewsBlur:** Profile → Download OPML

**How to import:**
1. Click **"Import OPML"** in the Publications page header
2. Select your `.opml` file
3. The system parses all `<outline type="rss">` entries and cross-checks against existing publications
4. New feeds are added to the **pending suggestions queue** (same amber banner as Claude suggestions)
5. Accept or reject each one individually

**Tier inference:** OPML imports default to Tier C. Well-known outlet names (TechCrunch, Wired, etc.) are auto-detected and assigned Tier A. Adjust when reviewing.

### 4.4 Manual Add

Click **"Add Publication"** to add a single publication directly. Leave the RSS Feed URL blank and the system will attempt auto-discovery after saving. After it's created, use ⚡ to discover category feeds.

---

## 5. Journalist Discovery

Journalists are discovered automatically via RSS and staff page scanning, then reviewed before being added to your database.

### 5.1 Relevance Scoring

Every journalist suggestion is **scored 0–10** for AI/startup relevance before you ever see it. Scoring runs across up to 10 recent articles per author, using two signals:

**Category tag scoring** (high confidence — used when articles have category tags, e.g. TechCrunch):

| Tag match | Points |
|---|---|
| AI tag: `ai`, `machine learning`, `llm`, `openai`, `anthropic`, `ai agents`, etc. | +3 per article |
| Startup tag: `startups`, `funding`, `venture capital`, `series a/b/c`, `saas`, etc. | +3 per article |
| Noise tag: `gaming`, `entertainment`, `deals`, `sports`, `fashion`, etc. | −2 per article |

**Title keyword scoring** (used for all articles; weighted 1.5× when categories are absent, e.g. The Verge):

| Keyword match | Points |
|---|---|
| AI title: "AI", "machine learning", "LLM", "OpenAI", "Anthropic", "Claude", etc. | +2 per article (×1.5 if no categories) |
| Startup title: "startup", "raises", "Series A/B/C", "funding", "venture" | +2 per article |
| Enterprise title: "enterprise", "SaaS", "B2B", "cloud", "devops" | +1 per article |
| Noise title: "deal", "gaming", "movie", "sports", "fashion" | −2 per article |

Points are summed across all articles, then clamped to 0–10.

**Score bands:**
- 🟢 **High (6–10):** Strong AI/startup coverage — likely worth adding
- 🟡 **Mid (3–5):** Mixed signal — review their article before deciding
- ⚪ **Low (0–2):** Little to no AI/startup coverage — probably skip

The **best article** (highest-scoring single article across all scanned articles) is shown as evidence for each journalist, not just the most recent one.

### 5.2 Weekly RSS Scan (Wednesdays 7am ET)

Every Wednesday, the system scans all active publication feeds from `publication_feeds`:

1. For each publication, fetches all its feeds (main + any category feeds)
2. Merges items across all feeds for that publication
3. Filters to articles published in the last 90 days
4. Extracts author bylines using `dc:creator`, `author`, and `item.creator` fields
5. Cleans author names: strips email prefixes (e.g. `"user@email.com (Ben Dickson)"` → `"Ben Dickson"`), filters student bylines (e.g. `"Jane Smith '25"`), rejects non-person-name patterns
6. Collects up to 10 articles per author, scores all of them
7. Cross-references against existing journalists, pending suggestions, and recent rejections (30-day cooldown)
8. Saves scored suggestions to `journalist_suggestions`

**Category feeds dramatically improve quality.** A journalist who writes 8 AI articles and 2 gaming articles will score much higher when scanned from a publication's AI section feed than from the main feed where gaming articles dilute their signal.

**Beat inference** — the suggested beat is inferred from matched tags and title keywords across all collected articles:

| Signal | Beat |
|---|---|
| AI tags/keywords | AI / Machine Learning |
| Startup/funding tags | Startups / Funding |
| Policy/regulation keywords | Tech Policy |
| Cybersecurity keywords | Cybersecurity |
| Crypto/blockchain keywords | Crypto / Web3 |
| Enterprise/SaaS keywords | Enterprise Tech |
| Default | Technology |

**Google News virtual publications** participate in this scan automatically — journalist bylines from the AI Startups, Atlanta Tech, and Generative AI search feeds are surfaced every Wednesday alongside bylines from real publications.

### 5.3 Staff Page Scan (On-Demand)

The **Deep Scan** button (📖) on each publication row crawls the publication's public staff or author index page. This catches journalists who haven't published a recent article and wouldn't appear in RSS feeds.

The scanner tries these paths in order: `/authors`, `/staff`, `/team`, `/about/team`, `/contributors`, `/writers`, `/reporters`, `/people`, `/newsroom/staff`.

It extracts names using three strategies: author profile link text, CSS class patterns (`[class*="name"]`, `[class*="author"]`), and JSON-LD structured data (`@type: Person`). Names that pass the person-name format check are saved to the journalist suggestions queue.

**Limitation:** Only works for server-rendered HTML. JS-rendered author pages (React/Next.js) will return empty results. Firecrawl (paid) is the upgrade path for those sites.

### 5.4 Reviewing Journalist Suggestions

Navigate to **Admin → RSS Suggestions** (or click the green badge in the sidebar).

Suggestions are grouped by publication and sorted by relevance score — highest-scoring publications first, highest-scoring journalists within each group first.

**Filter tabs:**
- **All** — every pending suggestion
- **🟢 High signal** — score ≥ 6 (prioritize these)
- **🟡 Mid signal** — score 3–5 (review article before deciding)
- **⚪ Low signal** — score < 3 (bulk-skip with one click)

Each row shows:
- Journalist name + article count scanned
- Relevance score badge
- Matched tags (e.g. `anthropic`, `ai agents`, `startups`)
- Best article (highest-scoring article across all scanned — linked to source)

**Actions:**
- **Accept** → Creates a draft journalist record (`outreachStatus = Researching`). Claude immediately runs in the background and pre-fills beat, all 6 scoring dimensions, priority tier, and best pitch angle. A flash banner links directly to the new record.
- **Skip** → Archives the suggestion; won't resurface for 30 days
- **Skip all low-signal** → Bulk-skips every suggestion scoring < 3 in one click
- **Scan All Feeds Now** → Triggers a full RSS scan immediately
- **History** → Modal showing all past accepted/rejected suggestions with scores

### 5.5 Claude Auto-Scoring on Accept

When you accept a journalist suggestion, Claude Opus 4.8 analyses the journalist's name, publication, tier, recent article title, and beat in the background. It returns:

- Refined beat description
- Scores for all 6 dimensions (see Section 6.2)
- Total score and priority tier
- Best pitch angle suggestion

These are written to the journalist record with a note: `[Auto-scored by Claude] ... (Scores are suggestions — review and adjust.)` — they are starting points, not final values. Always review before acting on them.

### 5.6 On-Demand Triggers

| Trigger | Location | What it does |
|---|---|---|
| ⚡ Discover category feeds | Publications → row hover | Scans homepage for AI/tech section RSS feeds (~20s) |
| RSS Scan (single pub) | Publications → row hover → Scan icon | Scans all feeds for one publication now |
| Deep Scan (single pub) | Publications → row hover → Book icon | Crawls staff/authors page now |
| Scan All Feeds | RSS Suggestions page → button | Scans all active feeds across all publications |
| Run Discovery | Publications page → button | Runs Claude publication suggestions now |

### 5.7 Manual Discovery

When automated methods don't surface someone:

1. **Staff pages** — Visit `[publication.com]/staff`, `/authors`, `/team`
2. **Byline search** — `site:techcrunch.com "artificial intelligence" 2025..2026`
3. **Google News** — `"AI startup" "Series A" site:venturebeat.com`
4. **LinkedIn** — Search `journalist [publication name] technology`

---

## 6. Journalist Records & Scoring

### 6.1 Record Fields

**Identity:** name, publication, roleTitle, beat, location  
**Contact:** email, twitterUrl, linkedinUrl, personalWebsite, muckRackUrl, contactUrl  
**Scoring:** 6 dimension scores + totalScore + priorityTier  
**Status:** outreachStatus, lastContactedDate, nextFollowUpDate, bestPitchAngle, notes  
**System:** staleFlag (auto-set when not updated in 90+ days)

The **Articles** tab logs individual articles written by the journalist — title, URL, publish date, topic, relevance to North Star. This builds a track record of their AI coverage history.

### 6.2 Scoring

Every journalist receives a **composite score out of 100 points** across 6 dimensions:

| Dimension | Max | What it measures |
|---|---|---|
| AI Relevance | 25 | How closely their beat matches AI/ML/LLM topics |
| Startup Relevance | 20 | Coverage of the startup and VC ecosystem |
| North Star Fit | 20 | Alignment with North Star AI Labs specifically |
| Publication Authority | 15 | Reach and credibility of their publication |
| Audience Reach | 10 | Readership and social following |
| Contactability | 10 | How reachable and responsive they are |

**Score ranges:**
- AI Relevance: 20–25 (primary AI beat) · 12–19 (regular AI pieces) · 6–11 (occasional) · 0–5 (rare)
- Startup Relevance: 16–20 (regular) · 10–15 (occasional) · 5–9 (secondary) · 0–4 (rare)
- North Star Fit: 16–20 (directly relevant) · 10–15 (strong overlap) · 5–9 (adjacent) · 0–4 (unlikely)
- Publication Authority: 12–15 (major national) · 8–11 (strong mid-tier) · 4–7 (regional) · 0–3 (niche)
- Audience Reach: 8–10 (10K+ following) · 5–7 (moderate) · 2–4 (limited) · 0–1 (minimal)
- Contactability: 8–10 (email listed, known to respond) · 5–7 (findable) · 2–4 (hard to reach) · 0–1 (no info)

**Priority tiers:**

| Tier | Score | Action |
|---|---|---|
| **1** | 80–100 | Personalized, high-effort pitch |
| **2** | 60–79 | Tailored pitch with relevant angle |
| **3** | 40–59 | Periodic news updates |
| **4** | < 40 | Monitor — add to press list, no active outreach |

Scores auto-suggested by Claude on accept are pre-filled but should be reviewed before acting on them.

---

## 7. Contact Information

> **Policy:** Only store contact information that is publicly available and professionally intended for media contact. Do not guess private emails, purchase contact lists, or use data brokers. Email discovery is manual.

### Finding an email

1. **Author page** — most publications list a tip line or contact email
2. **Twitter/X bio** — many journalists include: `"Tips: name@techcrunch.com"`
3. **Publication tips page** — e.g. `techcrunch.com/tips`, `wired.com/about/contact`
4. **Common patterns** (verify before use): `firstname@pub.com`, `firstname.lastname@pub.com`

### Verifying an email

Before sending, verify deliverability using any of:
- [Hunter.io](https://hunter.io) — free email verification (no account needed for single checks)
- [NeverBounce](https://neverbounce.com)
- [ZeroBounce](https://zerobounce.com)

### Finding social profiles

- **Twitter/X:** Check article bylines or search `"[name]" journalist`
- **LinkedIn:** Search by name + current employer

---

## 8. Outreach Workflow

### The cycle

```
IDENTIFY → RESEARCH → PITCH → FOLLOW UP → RESPOND → MAINTAIN
```

### Logging outreach

Every contact attempt is logged in the **Outreach** tab of the journalist detail page:

| Field | Description |
|---|---|
| Message Type | Email · Phone · LinkedIn · Twitter DM · In-person |
| Subject Line | Exact subject of your email |
| Message Body | The pitch or message text |
| Status | Sent → Opened → Replied → Covered → Declined → No Response |
| Follow-up Date | When to check back if no response |
| Notes | Context from the interaction |

### Follow-up rules

- First follow-up: **5–7 business days** after initial pitch
- Second follow-up: **7–10 business days** after first follow-up
- **Stop after 2 follow-ups** with no response — respect their inbox
- Exception: a major news hook (new funding, product launch) justifies a fresh outreach even after a previous no-response

### Outreach status definitions

| Status | Meaning |
|---|---|
| Sent | Delivered; awaiting response |
| Opened | Email opened (if tracked); no reply yet |
| Replied | Journalist responded |
| Covered | Journalist published a story |
| Declined | Journalist explicitly passed |
| No Response | Follow-up window passed with no engagement |

---

## 9. Data Health & Maintenance

### Automated health checks (1st of every month, 6am ET)

The monthly health check cron job runs three checks:

1. **Publication URL ping** — HTTP HEAD request to every active publication URL. Marks `healthy` or `unreachable`. Unreachable publications appear in a warning banner on the Publications page.

2. **RSS staleness check** — Any active RSS feed with no new articles in 30+ days is marked `inactive`.

3. **Journalist stale flag** — Journalist records not updated in 90+ days are flagged (`staleFlag = 1`). Stale records are visible in the dashboard health summary.

A **"Run Health Check Now"** endpoint (`POST /api/health-check/run-now`) allows manual triggering.

### Keeping journalist records fresh

| Priority Tier | Re-verify cadence |
|---|---|
| Tier 1 | Every 60 days |
| Tier 2 | Every 90 days |
| Tier 3 / 4 | Every 6 months |

Use the `nextFollowUpDate` field for re-verification reminders, not just outreach. Check:
- Still at the same publication? (Recent bylines, LinkedIn)
- Still covering AI? (`author:"[name]" site:[pub.com]` — last 5–10 articles)
- Email still valid?

---

## 10. Data Storage & Export

### Database tables

**`journalists`** — Core records (name, publication, beat, scores, contact, outreach status)  
**`articles`** — Articles per journalist (title, URL, publish date, topic, relevance)  
**`outreach_logs`** — Full outreach history per journalist  
**`publications`** — Publication sources (name, URL, tier, RSS status, health, isVirtual)  
**`publication_feeds`** — RSS feeds per publication (feedUrl, feedLabel, feedType: main/category, rssStatus)  
**`publication_suggestions`** — Pending/accepted/rejected publication suggestions from Claude and OPML imports  
**`journalist_suggestions`** — Pending/accepted/rejected journalist suggestions from RSS and staff page scans, with relevance scores and matched tags  

### Automated schedule

| Job | When | What it does |
|---|---|---|
| Claude publication discovery | Monday 8am ET | Suggests new publications |
| RSS journalist discovery | Wednesday 7am ET | Scans all feeds in `publication_feeds`, scores bylines |
| Health checks | 1st of month, 6am ET | Pings publications, flags stale records |

All three can also be triggered manually via buttons in the admin UI.

### Exporting

The **Export Data** page downloads the full journalist list as:
- **CSV** — for spreadsheets or importing into other CRMs
- **JSON** — for programmatic use

---

## 11. Ethics & Constraints

These constraints are non-negotiable and must be preserved in all future versions of this system.

| Rule | Reason |
|---|---|
| ❌ No scraping personal contact data | Privacy violation; legal risk |
| ❌ No guessing or purchasing email lists | Privacy violation; damages sender reputation; may violate GDPR/CAN-SPAM |
| ❌ No mass automated outreach | Destroys journalist relationships at scale |
| ✅ Public professional contacts only | Journalists share contact info specifically to receive professional pitches |
| ✅ All outreach is human-written and human-sent | Authenticity and personalisation are non-negotiable |
| ✅ All AI/RSS suggestions require human approval | Nothing is added to the database automatically |
| ✅ Reading public pages is permitted | Staff pages and RSS feeds exist specifically to be read — no personal data is extracted, only professional names and published work |
| ✅ Track opt-outs | If a journalist declines, mark them and do not re-pitch |

**On RSS and staff page scanning:** These features read information that publications intentionally make public — article bylines and staff listings. No contact information is harvested. The journalist's name, employer, and published work are already in the public domain by the time the system reads them.

**On category feed discovery:** The system fetches a publication's public homepage and follows links that are already visible to any browser. No authentication, no scraping of gated content, no rate violation — it's the same as a user navigating the site.

---

## 12. Roadmap

### Pending improvements (no additional cost)
- OPML import: auto-copy RSS URL from reason field when accepting a suggestion; bulk accept by category
- Category feed discovery: manually add a feed URL directly from the feeds panel (endpoint exists, no UI yet)
- Re-scan existing journalist suggestions with updated scoring after new category feeds are discovered

### Potential paid integrations (discuss before building)

| Tool | Use case | Cost |
|---|---|---|
| **Firecrawl** | Crawl JS-rendered staff pages that Cheerio can't parse | ~$15/mo |
| **Apollo.io** | Email discovery (50 free/month, then paid) | Free tier → paid |
| **Hunter.io** | Email discovery and verification | $49/mo |

### Future phases

**AI-assisted research**
- Per-journalist Claude research button — reads recent articles, returns beat summary, pitch angle, and red flags before you decide to add them
- Pitch drafting — Claude reads a journalist's recent articles and drafts a personalised pitch
- Pitch quality checker — Claude reviews a draft before sending

**Enrichment integrations**
- Google News API — auto-pull recent articles into the Articles tab
- Twitter/X API — pull follower count (currently too expensive)

**Team collaboration**
- Migrate from SQLite to PostgreSQL for multi-user access
- User accounts with role assignment
- Shared outreach calendar — conflict detection when two people pitch the same journalist

**Analytics**
- Coverage tracking (which pitches led to stories)
- Journalist ROI dashboard (time invested vs. coverage received)
- Discovery yield rate (accepted journalist suggestions per RSS scan)

---

*North Star Media & Journalist Dossiers — v1.4. For questions, contact the North Star AI Labs communications team.*
