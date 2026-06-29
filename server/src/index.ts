import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import pool, { initDb } from './db';
import journalistsRouter from './routes/journalists';
import articlesRouter from './routes/articles';
import outreachRouter from './routes/outreach';
import exportRouter from './routes/export';
import publicationsRouter from './routes/publications';
import suggestionsRouter from './routes/suggestions';
import journalistSuggestionsRouter from './routes/journalistSuggestions';
import { startSuggestionCron, runSuggestionJob } from './cron/suggestionJob';
import { startRssCron } from './cron/rssJob';
import { startHealthCheckCron, runHealthChecks } from './cron/healthCheckJob';
import { refreshAllJournalistArticles } from './services/refreshJournalistArticles';
import campaignsRouter from './routes/campaigns';
import enrichmentRouter from './routes/enrichment';
import campaignStylesRouter from './routes/campaignStyles';
import coverageRouter from './routes/coverage';
import cron from 'node-cron';

const app = express();

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  process.env.FRONTEND_URL,
].filter(Boolean) as string[];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    if (allowedOrigins.some(allowed => origin === allowed || origin.endsWith('.netlify.app'))) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

app.use(express.json());

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/journalists', journalistsRouter);
app.use('/api/articles', articlesRouter);
app.use('/api/outreach', outreachRouter);
app.use('/api/export', exportRouter);
app.use('/api/publications', publicationsRouter);
app.use('/api/suggestions', suggestionsRouter);
app.use('/api/journalist-suggestions', journalistSuggestionsRouter);
app.use('/api/campaigns', campaignsRouter);
app.use('/api/enrichment', enrichmentRouter);
app.use('/api/campaign-styles', campaignStylesRouter);
app.use('/api/coverage', coverageRouter);

// ── Dashboard ─────────────────────────────────────────────────────────────────
app.get('/api/dashboard', async (_req, res) => {
  try {
    const [
      totalRes, tiersRes, avgRes, followUpsRes, recentOutreachRes,
      staleRes, unreachableRes, activeCampaignsRes, draftsReadyRes,
      sentRes, recentCampaignsRes,
    ] = await Promise.all([
      pool.query('SELECT COUNT(*)::int as c FROM journalists'),
      pool.query('SELECT "priorityTier", COUNT(*)::int as count FROM journalists GROUP BY "priorityTier"'),
      pool.query('SELECT AVG("totalScore")::numeric(6,1) as avg FROM journalists'),
      pool.query(`
        SELECT * FROM journalists
        WHERE "nextFollowUpDate" IS NOT NULL AND "nextFollowUpDate" != ''
          AND "nextFollowUpDate"::DATE <= CURRENT_DATE + INTERVAL '7 days'
        ORDER BY "nextFollowUpDate" ASC LIMIT 10
      `),
      pool.query(`
        SELECT ol.*, j.name as "journalistName", j.publication
        FROM outreach_logs ol
        JOIN journalists j ON j.id = ol."journalistId"
        ORDER BY ol."createdAt" DESC LIMIT 10
      `),
      pool.query('SELECT COUNT(*)::int as c FROM journalists WHERE "staleFlag" = 1'),
      pool.query("SELECT COUNT(*)::int as c FROM publications WHERE \"healthStatus\" = 'unreachable'"),
      pool.query("SELECT COUNT(*)::int as c FROM campaigns WHERE status != 'completed'"),
      pool.query("SELECT COUNT(*)::int as c FROM campaign_journalists WHERE \"draftStatus\" IN ('ready','approved')"),
      pool.query(`
        SELECT COUNT(*)::int as c FROM campaign_journalists
        WHERE "draftStatus" = 'sent' AND "sentAt" != '' AND "sentAt"::DATE >= CURRENT_DATE - INTERVAL '7 days'
      `),
      pool.query(`
        SELECT c.id, c.name, c.type, c.status,
          COUNT(cj.id)::int as "journalistCount",
          SUM(CASE WHEN cj."draftStatus" = 'sent' THEN 1 ELSE 0 END)::int as "sentCount",
          SUM(CASE WHEN cj."draftStatus" IN ('ready','approved') THEN 1 ELSE 0 END)::int as "readyCount"
        FROM campaigns c
        LEFT JOIN campaign_journalists cj ON cj."campaignId" = c.id
        GROUP BY c.id
        ORDER BY c."updatedAt" DESC LIMIT 5
      `),
    ]);

    res.json({
      total: totalRes.rows[0].c,
      tiers: tiersRes.rows,
      avgScore: avgRes.rows[0].avg ? Math.round(Number(avgRes.rows[0].avg)) : 0,
      followUps: followUpsRes.rows,
      recentOutreach: recentOutreachRes.rows,
      staleJournalists: staleRes.rows[0].c,
      unreachablePubs: unreachableRes.rows[0].c,
      activeCampaigns: activeCampaignsRes.rows[0].c,
      draftsReady: draftsReadyRes.rows[0].c,
      sentThisWeek: sentRes.rows[0].c,
      recentCampaigns: recentCampaignsRes.rows,
    });
  } catch (err: any) {
    console.error('[Dashboard]', err.message);
    res.status(500).json({ error: 'Dashboard query failed' });
  }
});

// ── Healthcheck (Railway) ────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// ── Manual triggers (admin use) ───────────────────────────────────────────────
app.post('/api/suggestions/run-now', async (_req, res) => {
  res.json({ message: 'Suggestion job started' });
  runSuggestionJob().catch(console.error);
});

app.post('/api/health-check/run-now', async (_req, res) => {
  res.json({ message: 'Health check started' });
  runHealthChecks().catch(console.error);
});

app.get('/api/health-check/summary', async (_req, res) => {
  try {
    const [unreachable, stale, inactiveFeeds] = await Promise.all([
      pool.query("SELECT id, name, url, \"lastHealthCheck\" FROM publications WHERE \"healthStatus\" = 'unreachable'"),
      pool.query("SELECT id, name, publication, \"updatedAt\" FROM journalists WHERE \"staleFlag\" = 1 ORDER BY \"updatedAt\" ASC LIMIT 20"),
      pool.query("SELECT id, name, \"rssUrl\", \"rssLastChecked\" FROM publications WHERE \"rssStatus\" = 'inactive' AND active = 1"),
    ]);
    res.json({ unreachable: unreachable.rows, stale: stale.rows, inactiveFeeds: inactiveFeeds.rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/journalist-articles/refresh-now', async (_req, res) => {
  res.json({ message: 'Article refresh started — check server logs for progress.' });
  refreshAllJournalistArticles().catch(err => console.error('[ArticleRefresh] Error:', err));
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Unhandled error]', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      startSuggestionCron();
      startRssCron();
      startHealthCheckCron();

      // Fridays 7am ET — refresh articles for all tracked journalists
      cron.schedule('0 7 * * 5', () => {
        console.log('[ArticleRefresh] Weekly journalist article refresh starting...');
        refreshAllJournalistArticles().catch(err => console.error('[ArticleRefresh] Error:', err));
      }, { timezone: 'America/New_York' });
      console.log('[ArticleRefresh] Weekly article refresh cron scheduled — Fridays at 7am ET');
    });
  })
  .catch(err => {
    console.error('[DB] Failed to initialise database:', err);
    process.exit(1);
  });
