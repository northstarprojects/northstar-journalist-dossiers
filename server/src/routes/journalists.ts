import { Router, Request, Response } from 'express';
import db from '../db';
import { analyzeJournalist } from '../services/journalistAnalysis';

const router = Router();

function calcScore(body: any) {
  const ai = Math.min(Number(body.aiRelevanceScore) || 0, 25);
  const startup = Math.min(Number(body.startupRelevanceScore) || 0, 20);
  const ns = Math.min(Number(body.northStarFitScore) || 0, 20);
  const pub = Math.min(Number(body.publicationAuthorityScore) || 0, 15);
  const reach = Math.min(Number(body.audienceReachScore) || 0, 10);
  const contact = Math.min(Number(body.contactabilityScore) || 0, 10);
  const total = ai + startup + ns + pub + reach + contact;
  const tier = total >= 80 ? 1 : total >= 60 ? 2 : total >= 40 ? 3 : 4;
  return { total, tier };
}

// GET all journalists
router.get('/', (req: Request, res: Response) => {
  const { search, tier, publicationType, beat, outreachStatus, sortBy } = req.query;
  let query = 'SELECT * FROM journalists WHERE 1=1';
  const params: any[] = [];

  if (search) {
    query += ' AND (name LIKE ? OR publication LIKE ? OR beat LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s);
  }
  if (tier) { query += ' AND priorityTier = ?'; params.push(tier); }
  if (publicationType) { query += ' AND publicationType = ?'; params.push(publicationType); }
  if (beat) { query += ' AND beat LIKE ?'; params.push(`%${beat}%`); }
  if (outreachStatus) { query += ' AND outreachStatus = ?'; params.push(outreachStatus); }

  const allowed = ['totalScore', 'name', 'publication', 'priorityTier', 'createdAt'];
  const col = allowed.includes(String(sortBy)) ? sortBy : 'totalScore';
  query += ` ORDER BY ${col} DESC`;

  res.json(db.prepare(query).all(...params));
});

// GET single journalist
router.get('/:id', (req: Request, res: Response) => {
  const j = db.prepare('SELECT * FROM journalists WHERE id = ?').get(req.params.id);
  if (!j) return res.status(404).json({ error: 'Not found' });
  res.json(j);
});

const defaults = {
  publication: '', roleTitle: '', beat: '', location: '', publicationType: '',
  aiRelevanceScore: 0, startupRelevanceScore: 0, northStarFitScore: 0,
  publicationAuthorityScore: 0, audienceReachScore: 0, contactabilityScore: 0,
  email: '', contactUrl: '', linkedinUrl: '', twitterUrl: '',
  personalWebsite: '', muckRackUrl: '', bestPitchAngle: '', notes: '',
  outreachStatus: 'Not Started', lastContactedDate: '', nextFollowUpDate: '',
};

// POST create journalist
router.post('/', (req: Request, res: Response) => {
  const b = { ...defaults, ...req.body };
  const { total, tier } = calcScore(b);
  const stmt = db.prepare(`
    INSERT INTO journalists (
      name, publication, roleTitle, beat, location, publicationType,
      aiRelevanceScore, startupRelevanceScore, northStarFitScore,
      publicationAuthorityScore, audienceReachScore, contactabilityScore,
      totalScore, priorityTier, email, contactUrl, linkedinUrl, twitterUrl,
      personalWebsite, muckRackUrl, bestPitchAngle, notes, outreachStatus,
      lastContactedDate, nextFollowUpDate
    ) VALUES (
      @name, @publication, @roleTitle, @beat, @location, @publicationType,
      @aiRelevanceScore, @startupRelevanceScore, @northStarFitScore,
      @publicationAuthorityScore, @audienceReachScore, @contactabilityScore,
      @totalScore, @priorityTier, @email, @contactUrl, @linkedinUrl, @twitterUrl,
      @personalWebsite, @muckRackUrl, @bestPitchAngle, @notes, @outreachStatus,
      @lastContactedDate, @nextFollowUpDate
    )
  `);
  const result = stmt.run({ ...b, totalScore: total, priorityTier: tier });
  const created = db.prepare('SELECT * FROM journalists WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(created);
});

// PUT update journalist
router.put('/:id', (req: Request, res: Response) => {
  const b = { ...defaults, ...req.body };
  const { total, tier } = calcScore(b);
  db.prepare(`
    UPDATE journalists SET
      name=@name, publication=@publication, roleTitle=@roleTitle, beat=@beat,
      location=@location, publicationType=@publicationType,
      aiRelevanceScore=@aiRelevanceScore, startupRelevanceScore=@startupRelevanceScore,
      northStarFitScore=@northStarFitScore, publicationAuthorityScore=@publicationAuthorityScore,
      audienceReachScore=@audienceReachScore, contactabilityScore=@contactabilityScore,
      totalScore=@totalScore, priorityTier=@priorityTier, email=@email,
      contactUrl=@contactUrl, linkedinUrl=@linkedinUrl, twitterUrl=@twitterUrl,
      personalWebsite=@personalWebsite, muckRackUrl=@muckRackUrl,
      bestPitchAngle=@bestPitchAngle, notes=@notes, outreachStatus=@outreachStatus,
      lastContactedDate=@lastContactedDate, nextFollowUpDate=@nextFollowUpDate,
      updatedAt=datetime('now')
    WHERE id=@id
  `).run({ ...b, id: req.params.id, totalScore: total, priorityTier: tier });
  res.json(db.prepare('SELECT * FROM journalists WHERE id = ?').get(req.params.id));
});

// PATCH toggle favourite
router.patch('/:id/favorite', (req: Request, res: Response) => {
  const j = db.prepare('SELECT isFavorite FROM journalists WHERE id = ?').get(req.params.id) as any;
  if (!j) return res.status(404).json({ error: 'Not found' });
  const newVal = j.isFavorite ? 0 : 1;
  db.prepare("UPDATE journalists SET isFavorite = ?, updatedAt = datetime('now') WHERE id = ?")
    .run(newVal, req.params.id);
  res.json({ isFavorite: newVal });
});

// DELETE journalist
router.delete('/:id', (req: Request, res: Response) => {
  db.prepare('DELETE FROM journalists WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// POST backfill articles from journalist notes field
// One-time utility: extracts "Recent article: Title — URL" from notes and seeds the articles table.
router.post('/backfill-articles', (_req: Request, res: Response) => {
  const journalists = db.prepare(
    "SELECT id, name, publication, beat, notes FROM journalists WHERE notes LIKE '%Recent article:%'"
  ).all() as any[];

  let seeded = 0;
  for (const j of journalists) {
    // Skip if already has articles
    const existing = db.prepare('SELECT id FROM articles WHERE journalistId = ?').get(j.id);
    if (existing) continue;

    const match = (j.notes || '').match(/Recent article: (.+?) — (https?:\/\/\S+)/);
    if (!match) continue;

    db.prepare(`
      INSERT INTO articles (journalistId, title, url, publication, topic)
      VALUES (@journalistId, @title, @url, @publication, @topic)
    `).run({
      journalistId: j.id,
      title: match[1].trim(),
      url: match[2].trim(),
      publication: j.publication || '',
      topic: j.beat || '',
    });
    seeded++;
  }

  res.json({ seeded, message: `Seeded articles for ${seeded} journalist${seeded !== 1 ? 's' : ''}.` });
});

// POST bulk re-score: runs Claude analysis for all journalists with totalScore = 0
// Responds immediately with count; scoring runs in background.
router.post('/bulk-rescore', (_req: Request, res: Response) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(400).json({ error: 'ANTHROPIC_API_KEY is not set on the server' });
  }

  const unscored = db.prepare(
    "SELECT * FROM journalists WHERE totalScore = 0 OR totalScore IS NULL"
  ).all() as any[];

  if (unscored.length === 0) {
    return res.json({ count: 0, message: 'All journalists already have scores.' });
  }

  // Respond immediately — scoring is async
  res.json({
    count: unscored.length,
    message: `Re-scoring ${unscored.length} journalist${unscored.length !== 1 ? 's' : ''} with Claude in the background. Scores will appear shortly.`,
  });

  // Fire-and-forget with a 2s delay between each to avoid API rate limits
  (async () => {
    for (const j of unscored) {
      try {
        const pub = db.prepare('SELECT * FROM publications WHERE name=? COLLATE NOCASE').get(j.publication) as any;
        const pubTier = pub?.tier || 'B';

        // Extract article info from notes field if present (format: "...Recent article: Title — URL")
        let articleTitle = '';
        let articleUrl = '';
        const noteMatch = (j.notes || '').match(/Recent article: (.+?) — (https?:\/\/\S+)/);
        if (noteMatch) {
          articleTitle = noteMatch[1];
          articleUrl = noteMatch[2];
        }

        const analysis = await analyzeJournalist({
          name: j.name,
          publication: j.publication || '',
          publicationTier: pubTier,
          recentArticleTitle: articleTitle,
          recentArticleUrl: articleUrl,
          suggestedBeat: j.beat || '',
        });

        if (!analysis) {
          console.log(`[BulkRescore] No analysis returned for ${j.name} — skipping`);
          continue;
        }

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
          id: j.id,
        });

        console.log(`[BulkRescore] ✓ ${j.name} (${j.publication}) → score ${total}, tier ${tier}`);
      } catch (err: any) {
        console.error(`[BulkRescore] ✗ ${j.name}:`, err.message);
      }

      // 2 second delay between requests to avoid hammering the API
      await new Promise(r => setTimeout(r, 2000));
    }
    console.log(`[BulkRescore] Done — processed ${unscored.length} journalists.`);
  })();
});

export default router;
