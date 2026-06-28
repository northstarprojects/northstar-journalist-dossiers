import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import db from './db';
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
app.use(cors());
app.use(express.json());

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

app.get('/api/dashboard', (_req, res) => {
  const total = (db.prepare('SELECT COUNT(*) as c FROM journalists').get() as any).c;
  const tiers = db.prepare('SELECT priorityTier, COUNT(*) as count FROM journalists GROUP BY priorityTier').all();
  const avgScore = (db.prepare('SELECT AVG(totalScore) as avg FROM journalists').get() as any).avg;
  const followUps = db.prepare(`SELECT * FROM journalists WHERE nextFollowUpDate <= date('now', '+7 days') AND nextFollowUpDate IS NOT NULL AND nextFollowUpDate != '' ORDER BY nextFollowUpDate ASC LIMIT 10`).all();
  const recentOutreach = db.prepare(`
    SELECT ol.*, j.name as journalistName, j.publication
    FROM outreach_logs ol
    JOIN journalists j ON j.id = ol.journalistId
    ORDER BY ol.createdAt DESC LIMIT 10
  `).all();
  const staleJournalists = (db.prepare("SELECT COUNT(*) as c FROM journalists WHERE staleFlag=1").get() as any).c;
  const unreachablePubs = (db.prepare("SELECT COUNT(*) as c FROM publications WHERE healthStatus='unreachable'").get() as any).c;

  // Campaign pipeline stats
  const activeCampaigns = (db.prepare("SELECT COUNT(*) as c FROM campaigns WHERE status != 'completed'").get() as any).c;
  const draftsReady = (db.prepare("SELECT COUNT(*) as c FROM campaign_journalists WHERE draftStatus IN ('ready','approved')").get() as any).c;
  const sentThisWeek = (db.prepare("SELECT COUNT(*) as c FROM campaign_journalists WHERE draftStatus='sent' AND sentAt >= date('now','-7 days')").get() as any).c;
  const recentCampaigns = db.prepare(`
    SELECT c.id, c.name, c.type, c.status,
      COUNT(cj.id) as journalistCount,
      SUM(CASE WHEN cj.draftStatus='sent' THEN 1 ELSE 0 END) as sentCount,
      SUM(CASE WHEN cj.draftStatus IN ('ready','approved') THEN 1 ELSE 0 END) as readyCount
    FROM campaigns c
    LEFT JOIN campaign_journalists cj ON cj.campaignId = c.id
    GROUP BY c.id
    ORDER BY c.updatedAt DESC LIMIT 5
  `).all();

  res.json({ total, tiers, avgScore: avgScore ? Math.round(avgScore) : 0, followUps, recentOutreach, staleJournalists, unreachablePubs, activeCampaigns, draftsReady, sentThisWeek, recentCampaigns });
});

// Manual triggers (admin use)
app.post('/api/suggestions/run-now', async (_req, res) => {
  res.json({ message: 'Suggestion job started' });
  runSuggestionJob();
});

app.post('/api/health-check/run-now', async (_req, res) => {
  res.json({ message: 'Health check started' });
  runHealthChecks();
});

// Health check summary (for admin UI)
app.get('/api/health-check/summary', (_req, res) => {
  const unreachable = db.prepare("SELECT id, name, url, lastHealthCheck FROM publications WHERE healthStatus='unreachable'").all();
  const stale = db.prepare("SELECT id, name, publication, updatedAt FROM journalists WHERE staleFlag=1 ORDER BY updatedAt ASC LIMIT 20").all();
  const inactiveFeeds = db.prepare("SELECT id, name, rssUrl, rssLastChecked FROM publications WHERE rssStatus='inactive' AND active=1").all();
  res.json({ unreachable, stale, inactiveFeeds });
});

// Manual trigger for article refresh
app.post('/api/journalist-articles/refresh-now', async (_req, res) => {
  res.json({ message: 'Article refresh started — check server logs for progress.' });
  refreshAllJournalistArticles().catch(err => console.error('[ArticleRefresh] Error:', err));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  startSuggestionCron();
  startRssCron();
  startHealthCheckCron();

  // Fridays 7am ET — refresh articles for all tracked journalists, flag stale at 30 days
  cron.schedule('0 7 * * 5', () => {
    console.log('[ArticleRefresh] Weekly journalist article refresh starting...');
    refreshAllJournalistArticles().catch(err => console.error('[ArticleRefresh] Error:', err));
  }, { timezone: 'America/New_York' });
  console.log('[ArticleRefresh] Weekly article refresh cron scheduled — Fridays at 7am ET');
});
