# Maintenance Guide

## What's automated

The system runs several background jobs that require no manual action:

| Job | When | What it does |
|---|---|---|
| RSS article refresh | Fridays 7am | Fetches new articles from all active publication feeds |
| Publication health check | Weekly | Checks RSS feed reachability, flags unreachable ones |
| AI publication suggestions | Weekly | Claude suggests new publications to consider tracking |

Alerts for stale journalists (no articles in 30+ days) and unreachable publications appear on the Dashboard automatically.

## What needs manual attention

| Task | How often | Where |
|---|---|---|
| Review journalist suggestions | Weekly | RSS Suggestions (Admin) |
| Review publication suggestions | Weekly | Publications (Admin) — amber banner |
| Log outreach after every contact | After each pitch | Journalist profile → Outreach tab |
| Add press coverage | When articles appear | Press Coverage page |
| Enrich emails via Apollo | When new journalists added | Journalists list → "Find emails via Apollo" |
| Update journalist notes / beat | When they change roles | Journalist profile → Edit |
| Update House Style | When tone/approach changes | House Style (Admin) |

## Keeping the system healthy

- **Stale journalists** — if a journalist hasn't had new articles in 30+ days, they'll be flagged on the dashboard. Check if they've changed beats or left the publication.
- **Unreachable publications** — RSS feeds occasionally go down or change URLs. The health check flags these; update the feed URL in the Publications admin.
- **Score freshness** — scores are generated once when a journalist is accepted. If their beat changes significantly, use "Re-score with Claude" on the Journalists list.

## Pushing updates to GitHub

After any session of changes:

```bash
git add -A
git commit -m "describe what changed"
git push
```

GitBook will automatically update the public docs site when changes are pushed to the `main` branch.

Railway (backend) and Netlify (frontend) also auto-deploy on every push to `main`.
