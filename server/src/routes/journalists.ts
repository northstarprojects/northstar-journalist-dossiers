import { Router, Request, Response } from 'express';
import pool from '../db';
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
router.get('/', async (req: Request, res: Response) => {
  try {
    const { search, tier, publicationType, beat, outreachStatus, sortBy } = req.query;
    let query = 'SELECT * FROM journalists WHERE 1=1';
    const params: any[] = [];
    let n = 1;

    if (search) {
      query += ` AND (name ILIKE $${n} OR publication ILIKE $${n + 1} OR beat ILIKE $${n + 2})`;
      const s = `%${search}%`;
      params.push(s, s, s);
      n += 3;
    }
    if (tier) { query += ` AND "priorityTier" = $${n++}`; params.push(tier); }
    if (publicationType) { query += ` AND "publicationType" = $${n++}`; params.push(publicationType); }
    if (beat) { query += ` AND beat ILIKE $${n++}`; params.push(`%${beat}%`); }
    if (outreachStatus) { query += ` AND "outreachStatus" = $${n++}`; params.push(outreachStatus); }

    const allowed = ['totalScore', 'name', 'publication', 'priorityTier', 'createdAt'];
    const col = allowed.includes(String(sortBy)) ? `"${sortBy}"` : '"totalScore"';
    query += ` ORDER BY ${col} DESC`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET single journalist
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT * FROM journalists WHERE id = $1', [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
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
router.post('/', async (req: Request, res: Response) => {
  try {
    const b = { ...defaults, ...req.body };
    const { total, tier } = calcScore(b);
    const result = await pool.query(`
      INSERT INTO journalists (
        name, publication, "roleTitle", beat, location, "publicationType",
        "aiRelevanceScore", "startupRelevanceScore", "northStarFitScore",
        "publicationAuthorityScore", "audienceReachScore", "contactabilityScore",
        "totalScore", "priorityTier", email, "contactUrl", "linkedinUrl", "twitterUrl",
        "personalWebsite", "muckRackUrl", "bestPitchAngle", notes, "outreachStatus",
        "lastContactedDate", "nextFollowUpDate"
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25
      ) RETURNING id
    `, [
      b.name, b.publication, b.roleTitle, b.beat, b.location, b.publicationType,
      b.aiRelevanceScore, b.startupRelevanceScore, b.northStarFitScore,
      b.publicationAuthorityScore, b.audienceReachScore, b.contactabilityScore,
      total, tier, b.email, b.contactUrl, b.linkedinUrl, b.twitterUrl,
      b.personalWebsite, b.muckRackUrl, b.bestPitchAngle, b.notes, b.outreachStatus,
      b.lastContactedDate, b.nextFollowUpDate,
    ]);
    const created = (await pool.query('SELECT * FROM journalists WHERE id = $1', [result.rows[0].id])).rows[0];
    res.status(201).json(created);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update journalist
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const b = { ...defaults, ...req.body };
    const { total, tier } = calcScore(b);
    await pool.query(`
      UPDATE journalists SET
        name=$1, publication=$2, "roleTitle"=$3, beat=$4, location=$5, "publicationType"=$6,
        "aiRelevanceScore"=$7, "startupRelevanceScore"=$8, "northStarFitScore"=$9,
        "publicationAuthorityScore"=$10, "audienceReachScore"=$11, "contactabilityScore"=$12,
        "totalScore"=$13, "priorityTier"=$14, email=$15, "contactUrl"=$16,
        "linkedinUrl"=$17, "twitterUrl"=$18, "personalWebsite"=$19, "muckRackUrl"=$20,
        "bestPitchAngle"=$21, notes=$22, "outreachStatus"=$23,
        "lastContactedDate"=$24, "nextFollowUpDate"=$25, "updatedAt"=NOW()
      WHERE id=$26
    `, [
      b.name, b.publication, b.roleTitle, b.beat, b.location, b.publicationType,
      b.aiRelevanceScore, b.startupRelevanceScore, b.northStarFitScore,
      b.publicationAuthorityScore, b.audienceReachScore, b.contactabilityScore,
      total, tier, b.email, b.contactUrl, b.linkedinUrl, b.twitterUrl,
      b.personalWebsite, b.muckRackUrl, b.bestPitchAngle, b.notes, b.outreachStatus,
      b.lastContactedDate, b.nextFollowUpDate, req.params.id,
    ]);
    const updated = (await pool.query('SELECT * FROM journalists WHERE id = $1', [req.params.id])).rows[0];
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH toggle favourite
router.patch('/:id/favorite', async (req: Request, res: Response) => {
  try {
    const r = await pool.query('SELECT "isFavorite" FROM journalists WHERE id = $1', [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Not found' });
    const newVal = r.rows[0].isFavorite ? 0 : 1;
    await pool.query('UPDATE journalists SET "isFavorite" = $1, "updatedAt" = NOW() WHERE id = $2', [newVal, req.params.id]);
    res.json({ isFavorite: newVal });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE journalist
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await pool.query('DELETE FROM journalists WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST backfill articles from journalist notes field
router.post('/backfill-articles', async (_req: Request, res: Response) => {
  try {
    const journalists = (await pool.query(
      "SELECT id, name, publication, beat, notes FROM journalists WHERE notes LIKE '%Recent article:%'"
    )).rows;
    let seeded = 0;
    for (const j of journalists) {
      const existing = (await pool.query('SELECT id FROM articles WHERE "journalistId" = $1', [j.id])).rows[0];
      if (existing) continue;
      const match = (j.notes || '').match(/Recent article: (.+?) — (https?:\/\/\S+)/);
      if (!match) continue;
      await pool.query(`
        INSERT INTO articles ("journalistId", title, url, publication, topic)
        VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING
      `, [j.id, match[1].trim(), match[2].trim(), j.publication || '', j.beat || '']);
      seeded++;
    }
    res.json({ seeded, message: `Seeded articles for ${seeded} journalist${seeded !== 1 ? 's' : ''}.` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST bulk re-score with Claude (background)
router.post('/bulk-rescore', async (_req: Request, res: Response) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(400).json({ error: 'ANTHROPIC_API_KEY is not set on the server' });
  }
  try {
    const unscored = (await pool.query(
      'SELECT * FROM journalists WHERE "totalScore" = 0 OR "totalScore" IS NULL'
    )).rows;
    if (unscored.length === 0) return res.json({ count: 0, message: 'All journalists already have scores.' });

    res.json({
      count: unscored.length,
      message: `Re-scoring ${unscored.length} journalist${unscored.length !== 1 ? 's' : ''} with Claude in the background.`,
    });

    (async () => {
      for (const j of unscored) {
        try {
          const pub = (await pool.query('SELECT * FROM publications WHERE LOWER(name) = LOWER($1)', [j.publication])).rows[0];
          const pubTier = pub?.tier || 'B';
          let articleTitle = '';
          let articleUrl = '';
          const noteMatch = (j.notes || '').match(/Recent article: (.+?) — (https?:\/\/\S+)/);
          if (noteMatch) { articleTitle = noteMatch[1]; articleUrl = noteMatch[2]; }

          const analysis = await analyzeJournalist({
            name: j.name, publication: j.publication || '', publicationTier: pubTier,
            recentArticleTitle: articleTitle, recentArticleUrl: articleUrl, suggestedBeat: j.beat || '',
          });
          if (!analysis) continue;

          const total = analysis.scores.aiRelevanceScore + analysis.scores.startupRelevanceScore +
            analysis.scores.northStarFitScore + analysis.scores.publicationAuthorityScore +
            analysis.scores.audienceReachScore + analysis.scores.contactabilityScore;
          const tier = total >= 80 ? 1 : total >= 60 ? 2 : total >= 40 ? 3 : 4;

          await pool.query(`
            UPDATE journalists SET
              beat = CASE WHEN beat = '' OR beat IS NULL THEN $1 ELSE beat END,
              "bestPitchAngle"=$2, "aiRelevanceScore"=$3, "startupRelevanceScore"=$4,
              "northStarFitScore"=$5, "publicationAuthorityScore"=$6,
              "audienceReachScore"=$7, "contactabilityScore"=$8,
              "totalScore"=$9, "priorityTier"=$10, "updatedAt"=NOW()
            WHERE id=$11
          `, [
            analysis.beat, analysis.bestPitchAngle,
            analysis.scores.aiRelevanceScore, analysis.scores.startupRelevanceScore,
            analysis.scores.northStarFitScore, analysis.scores.publicationAuthorityScore,
            analysis.scores.audienceReachScore, analysis.scores.contactabilityScore,
            total, tier, j.id,
          ]);
          console.log(`[BulkRescore] ✓ ${j.name} → score ${total}, tier ${tier}`);
        } catch (err: any) {
          console.error(`[BulkRescore] ✗ ${j.name}:`, err.message);
        }
        await new Promise(r => setTimeout(r, 2000));
      }
      console.log(`[BulkRescore] Done — processed ${unscored.length} journalists.`);
    })();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
