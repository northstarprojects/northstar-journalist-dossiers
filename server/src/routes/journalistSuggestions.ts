import { Router, Request, Response } from 'express';
import db from '../db';
import { scanPublicationRss, scanAllRssFeeds } from '../services/rssService';
import { scanStaffPage } from '../services/staffPageScanner';
import { analyzeJournalist } from '../services/journalistAnalysis';

const router = Router();

// GET all pending suggestions
router.get('/', (_req: Request, res: Response) => {
  const rows = db.prepare(`
    SELECT * FROM journalist_suggestions WHERE status = 'pending' ORDER BY createdAt DESC
  `).all();
  res.json(rows);
});

// GET count of pending suggestions
router.get('/count', (_req: Request, res: Response) => {
  const result = db.prepare("SELECT COUNT(*) as c FROM journalist_suggestions WHERE status='pending'").get() as any;
  res.json({ count: result.c });
});

// GET suggestion history
router.get('/history', (_req: Request, res: Response) => {
  const rows = db.prepare(`
    SELECT * FROM journalist_suggestions WHERE status != 'pending' ORDER BY createdAt DESC LIMIT 100
  `).all();
  res.json(rows);
});

// POST accept — creates a draft journalist record, then runs Claude analysis in background
router.post('/:id/accept', async (req: Request, res: Response) => {
  const suggestion = db.prepare('SELECT * FROM journalist_suggestions WHERE id=?').get(req.params.id) as any;
  if (!suggestion) return res.status(404).json({ error: 'Not found' });

  // Check for duplicate journalist
  const existing = db.prepare("SELECT id FROM journalists WHERE LOWER(name)=LOWER(?) AND LOWER(publication)=LOWER(?)")
    .get(suggestion.name, suggestion.publicationName || '');
  if (existing) {
    db.prepare("UPDATE journalist_suggestions SET status='accepted' WHERE id=?").run(req.params.id);
    return res.json({ success: true, duplicate: true, message: 'Journalist already exists — marked accepted' });
  }

  // Create a draft journalist record
  const result = db.prepare(`
    INSERT INTO journalists (name, publication, beat, outreachStatus, notes)
    VALUES (@name, @publication, @beat, 'Researching', @notes)
  `).run({
    name: suggestion.name,
    publication: suggestion.publicationName || '',
    beat: suggestion.suggestedBeat || '',
    notes: suggestion.recentArticleUrl
      ? `Discovered via ${suggestion.sourceType === 'staffpage' ? 'staff page scan' : 'RSS'}. Recent article: ${suggestion.recentArticleTitle} — ${suggestion.recentArticleUrl}`
      : `Discovered via ${suggestion.sourceType === 'staffpage' ? 'staff page scan' : 'RSS scan'}.`,
  });

  db.prepare("UPDATE journalist_suggestions SET status='accepted' WHERE id=?").run(req.params.id);
  const created = db.prepare('SELECT * FROM journalists WHERE id=?').get(result.lastInsertRowid) as any;

  // Seed the Articles tab — use allArticles if available, fall back to single best article
  const insertArticle = db.prepare(`
    INSERT OR IGNORE INTO articles (journalistId, title, url, publication, publishDate, topic)
    VALUES (@journalistId, @title, @url, @publication, @publishDate, @topic)
  `);
  let latestDate = '';
  try {
    const allArticles: { title: string; url: string; date: string }[] =
      suggestion.allArticles ? JSON.parse(suggestion.allArticles) : [];

    if (allArticles.length > 0) {
      const seedMany = db.transaction(() => {
        for (const a of allArticles) {
          if (!a.title || !a.url) continue;
          insertArticle.run({
            journalistId: created.id,
            title: a.title,
            url: a.url,
            publication: suggestion.publicationName || '',
            publishDate: a.date || '',
            topic: suggestion.suggestedBeat || '',
          });
          if (a.date && a.date > latestDate) latestDate = a.date;
        }
      });
      seedMany();
    } else if (suggestion.recentArticleTitle && suggestion.recentArticleUrl) {
      // Fallback for older suggestions that didn't store allArticles
      insertArticle.run({
        journalistId: created.id,
        title: suggestion.recentArticleTitle,
        url: suggestion.recentArticleUrl,
        publication: suggestion.publicationName || '',
        publishDate: suggestion.recentArticleDate || '',
        topic: suggestion.suggestedBeat || '',
      });
      latestDate = suggestion.recentArticleDate || '';
    }
  } catch {
    // allArticles parse failed — silently skip article seeding
  }

  // Track the most recent article date on the journalist record
  if (latestDate) {
    db.prepare("UPDATE journalists SET lastArticleDate = ? WHERE id = ?").run(latestDate, created.id);
  }

  // Respond immediately with the journalist record
  res.status(201).json({ success: true, journalist: created });

  // Background: run Claude analysis and update the record with suggested scores + beat
  const pub = db.prepare('SELECT * FROM publications WHERE name=? COLLATE NOCASE').get(suggestion.publicationName) as any;
  const pubTier = pub?.tier || 'B';

  analyzeJournalist({
    name: suggestion.name,
    publication: suggestion.publicationName || '',
    publicationTier: pubTier,
    recentArticleTitle: suggestion.recentArticleTitle || '',
    recentArticleUrl: suggestion.recentArticleUrl || '',
    suggestedBeat: suggestion.suggestedBeat || '',
  }).then(analysis => {
    if (!analysis) return;
    const total =
      analysis.scores.aiRelevanceScore +
      analysis.scores.startupRelevanceScore +
      analysis.scores.northStarFitScore +
      analysis.scores.publicationAuthorityScore +
      analysis.scores.audienceReachScore +
      analysis.scores.contactabilityScore;
    const tier = total >= 80 ? 1 : total >= 60 ? 2 : total >= 40 ? 3 : 4;

    db.prepare(`
      UPDATE journalists SET
        beat = CASE WHEN beat = '' OR beat IS NULL THEN @beat ELSE beat END,
        bestPitchAngle = @bestPitchAngle,
        aiRelevanceScore = @air,
        startupRelevanceScore = @str,
        northStarFitScore = @nsf,
        publicationAuthorityScore = @pas,
        audienceReachScore = @aur,
        contactabilityScore = @cos,
        totalScore = @total,
        priorityTier = @tier,
        notes = notes || @reasonNote,
        updatedAt = datetime('now')
      WHERE id = @id
    `).run({
      beat: analysis.beat,
      bestPitchAngle: analysis.bestPitchAngle,
      air: analysis.scores.aiRelevanceScore,
      str: analysis.scores.startupRelevanceScore,
      nsf: analysis.scores.northStarFitScore,
      pas: analysis.scores.publicationAuthorityScore,
      aur: analysis.scores.audienceReachScore,
      cos: analysis.scores.contactabilityScore,
      total,
      tier,
      reasonNote: `\n\n[Auto-scored by Claude] ${analysis.reasoning} (Scores are suggestions — review and adjust.)`,
      id: created.id,
    });
    console.log(`[JournalistAnalysis] Scored "${suggestion.name}" → ${total} pts (Tier ${tier})`);
  }).catch(err => {
    console.error('[JournalistAnalysis] Error:', err.message);
  });
});

// POST reject
router.post('/:id/reject', (req: Request, res: Response) => {
  db.prepare("UPDATE journalist_suggestions SET status='rejected' WHERE id=?").run(req.params.id);
  res.json({ success: true });
});

// POST scan a single publication's RSS feed now
router.post('/scan/:publicationId', async (req: Request, res: Response) => {
  try {
    res.json({ message: 'RSS scan started' });
    await scanPublicationRss(Number(req.params.publicationId));
  } catch (err: any) {
    console.error('[RSS scan error]', err.message);
  }
});

// POST deep-scan a publication's staff/authors page (Cheerio, free)
router.post('/staff-scan/:publicationId', async (req: Request, res: Response) => {
  const pubId = Number(req.params.publicationId);
  const result = await scanStaffPage(pubId);
  res.json(result);
});

// POST scan all feeds now
router.post('/scan-all', async (_req: Request, res: Response) => {
  res.json({ message: 'Full RSS scan started' });
  scanAllRssFeeds().catch(console.error);
});

export default router;
