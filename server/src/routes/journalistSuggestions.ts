import { Router, Request, Response } from 'express';
import pool from '../db';
import { scanPublicationRss, scanAllRssFeeds } from '../services/rssService';
import { scanStaffPage } from '../services/staffPageScanner';
import { analyzeJournalist } from '../services/journalistAnalysis';
import { inferArticleTopic } from '../services/rssService';

const router = Router();

// GET all pending suggestions
router.get('/', async (_req: Request, res: Response) => {
  try {
    const rows = (await pool.query(
      "SELECT * FROM journalist_suggestions WHERE status = 'pending' ORDER BY \"createdAt\" DESC"
    )).rows;
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET count of pending suggestions
router.get('/count', async (_req: Request, res: Response) => {
  try {
    const result = (await pool.query(
      "SELECT COUNT(*)::int as c FROM journalist_suggestions WHERE status='pending'"
    )).rows[0];
    res.json({ count: result.c });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET suggestion history
router.get('/history', async (_req: Request, res: Response) => {
  try {
    const rows = (await pool.query(
      "SELECT * FROM journalist_suggestions WHERE status != 'pending' ORDER BY \"createdAt\" DESC LIMIT 100"
    )).rows;
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST accept
router.post('/:id/accept', async (req: Request, res: Response) => {
  try {
    const suggestion = (await pool.query(
      'SELECT * FROM journalist_suggestions WHERE id=$1', [req.params.id]
    )).rows[0];
    if (!suggestion) return res.status(404).json({ error: 'Not found' });

    const existing = (await pool.query(
      'SELECT id FROM journalists WHERE LOWER(name)=LOWER($1) AND LOWER(publication)=LOWER($2)',
      [suggestion.name, suggestion.publicationName || '']
    )).rows[0];
    if (existing) {
      await pool.query("UPDATE journalist_suggestions SET status='accepted' WHERE id=$1", [req.params.id]);
      return res.json({ success: true, duplicate: true, message: 'Journalist already exists — marked accepted' });
    }

    const notes = suggestion.recentArticleUrl
      ? `Discovered via ${suggestion.sourceType === 'staffpage' ? 'staff page scan' : 'RSS'}. Recent article: ${suggestion.recentArticleTitle} — ${suggestion.recentArticleUrl}`
      : `Discovered via ${suggestion.sourceType === 'staffpage' ? 'staff page scan' : 'RSS scan'}.`;

    const result = await pool.query(`
      INSERT INTO journalists (name, publication, beat, "outreachStatus", notes)
      VALUES ($1,$2,$3,'Not Started',$4) RETURNING id
    `, [suggestion.name, suggestion.publicationName || '', suggestion.suggestedBeat || '', notes]);

    await pool.query("UPDATE journalist_suggestions SET status='accepted' WHERE id=$1", [req.params.id]);
    const created = (await pool.query('SELECT * FROM journalists WHERE id=$1', [result.rows[0].id])).rows[0];

    // Seed articles
    let latestDate = '';
    try {
      const allArticles: { title: string; url: string; date: string }[] =
        suggestion.allArticles ? JSON.parse(suggestion.allArticles) : [];

      if (allArticles.length > 0) {
        for (const a of allArticles) {
          if (!a.title || !a.url) continue;
          // Label each article by its own topic, not the journalist's overall beat
          const topic = inferArticleTopic(a.title, a.categories || []);
          await pool.query(`
            INSERT INTO articles ("journalistId", title, url, publication, "publishDate", topic)
            VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING
          `, [created.id, a.title, a.url, suggestion.publicationName || '', a.date || '', topic]);
          if (a.date && a.date > latestDate) latestDate = a.date;
        }
      } else if (suggestion.recentArticleTitle && suggestion.recentArticleUrl) {
        const topic = inferArticleTopic(suggestion.recentArticleTitle, []);
        await pool.query(`
          INSERT INTO articles ("journalistId", title, url, publication, "publishDate", topic)
          VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING
        `, [created.id, suggestion.recentArticleTitle, suggestion.recentArticleUrl,
            suggestion.publicationName || '', suggestion.recentArticleDate || '', topic]);
        latestDate = suggestion.recentArticleDate || '';
      }
    } catch { /* ignore article seeding failures */ }

    if (latestDate) {
      await pool.query('UPDATE journalists SET "lastArticleDate" = $1 WHERE id = $2', [latestDate, created.id]);
    }

    res.status(201).json({ success: true, journalist: created });

    // Background: Claude analysis
    const pub = (await pool.query('SELECT * FROM publications WHERE LOWER(name)=LOWER($1)', [suggestion.publicationName])).rows[0];
    const pubTier = pub?.tier || 'B';

    const allArticleTitles: string[] = allArticles.length > 0
      ? allArticles.map((a: { title: string }) => a.title).filter(Boolean)
      : suggestion.recentArticleTitle ? [suggestion.recentArticleTitle] : [];

    analyzeJournalist({
      name: suggestion.name, publication: suggestion.publicationName || '',
      publicationTier: pubTier,
      recentArticleTitle: suggestion.recentArticleTitle || '',
      recentArticleUrl: suggestion.recentArticleUrl || '',
      suggestedBeat: suggestion.suggestedBeat || '',
      allArticleTitles,
    }).then(async analysis => {
      if (!analysis) return;
      const total =
        analysis.scores.aiRelevanceScore + analysis.scores.startupRelevanceScore +
        analysis.scores.northStarFitScore + analysis.scores.publicationAuthorityScore +
        analysis.scores.audienceReachScore + analysis.scores.contactabilityScore;
      const tier = total >= 80 ? 1 : total >= 60 ? 2 : total >= 40 ? 3 : 4;

      await pool.query(`
        UPDATE journalists SET
          beat = $1,
          "bestPitchAngle"=$2, "aiRelevanceScore"=$3, "startupRelevanceScore"=$4,
          "northStarFitScore"=$5, "publicationAuthorityScore"=$6,
          "audienceReachScore"=$7, "contactabilityScore"=$8,
          "totalScore"=$9, "priorityTier"=$10,
          notes = notes || $11, "updatedAt"=NOW()
        WHERE id=$12
      `, [
        analysis.beat, analysis.bestPitchAngle,
        analysis.scores.aiRelevanceScore, analysis.scores.startupRelevanceScore,
        analysis.scores.northStarFitScore, analysis.scores.publicationAuthorityScore,
        analysis.scores.audienceReachScore, analysis.scores.contactabilityScore,
        total, tier,
        `\n\n[Auto-scored by Claude] ${analysis.reasoning} (Scores are suggestions — review and adjust.)`,
        created.id,
      ]);
      console.log(`[JournalistAnalysis] Scored "${suggestion.name}" → ${total} pts (Tier ${tier})`);
    }).catch(err => {
      console.error('[JournalistAnalysis] Error:', err.message);
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST reject
router.post('/:id/reject', async (req: Request, res: Response) => {
  try {
    await pool.query("UPDATE journalist_suggestions SET status='rejected' WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST scan a single publication's RSS feed
router.post('/scan/:publicationId', async (req: Request, res: Response) => {
  try {
    res.json({ message: 'RSS scan started' });
    await scanPublicationRss(Number(req.params.publicationId));
  } catch (err: any) {
    console.error('[RSS scan error]', err.message);
  }
});

// POST deep-scan a publication's staff page
router.post('/staff-scan/:publicationId', async (req: Request, res: Response) => {
  try {
    const result = await scanStaffPage(Number(req.params.publicationId));
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST scan all feeds
router.post('/scan-all', async (_req: Request, res: Response) => {
  res.json({ message: 'Full RSS scan started' });
  scanAllRssFeeds().catch(console.error);
});

export default router;
