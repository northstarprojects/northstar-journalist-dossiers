import { Router } from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';
import db from '../db';

const router = Router();

// ── Fetch metadata from a URL (title, publication, date) ─────────────────────
router.post('/fetch-meta', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });

  try {
    const response = await axios.get(url, {
      timeout: 10_000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NorthStarBot/1.0)',
        'Accept': 'text/html',
      },
      maxRedirects: 5,
    });

    const $ = cheerio.load(response.data);

    const og = (prop: string) =>
      $(`meta[property="og:${prop}"]`).attr('content') ||
      $(`meta[name="og:${prop}"]`).attr('content') || '';

    const meta = (name: string) =>
      $(`meta[name="${name}"]`).attr('content') || '';

    const title =
      og('title') ||
      $('title').text().trim().split('|')[0].split('–')[0].split('-')[0].trim() ||
      '';

    const siteName =
      og('site_name') ||
      meta('application-name') ||
      new URL(url).hostname.replace(/^www\./, '') ||
      '';

    // Try to extract publish date from common meta tags
    const rawDate =
      meta('article:published_time') ||
      $('time[datetime]').first().attr('datetime') ||
      og('article:published_time') ||
      meta('pubdate') ||
      meta('date') ||
      '';

    const publishDate = rawDate
      ? rawDate.split('T')[0]   // strip time component
      : '';

    const description = og('description') || meta('description') || '';

    return res.json({ title, publication: siteName, publishDate, description });
  } catch (err: any) {
    return res.status(422).json({
      error: `Could not fetch that URL: ${err.message}`,
      title: '', publication: '', publishDate: '', description: '',
    });
  }
});

// ── CRUD ──────────────────────────────────────────────────────────────────────

// GET /api/coverage — list all, with joined journalist name
router.get('/', (req, res) => {
  const { search, type, sentiment, journalistId } = req.query as Record<string, string>;

  let where = '1=1';
  const params: any[] = [];

  if (search) {
    where += ' AND (c.title LIKE ? OR c.publication LIKE ? OR c.journalistName LIKE ?)';
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  if (type)         { where += ' AND c.coverageType = ?'; params.push(type); }
  if (sentiment)    { where += ' AND c.sentiment = ?';    params.push(sentiment); }
  if (journalistId) { where += ' AND c.journalistId = ?'; params.push(journalistId); }

  const rows = db.prepare(`
    SELECT c.*, j.name AS linkedJournalistName, j.publication AS linkedPublication
    FROM coverage c
    LEFT JOIN journalists j ON j.id = c.journalistId
    WHERE ${where}
    ORDER BY c.publishDate DESC, c.createdAt DESC
  `).all(...params);

  res.json(rows);
});

// GET /api/coverage/:id
router.get('/:id', (req, res) => {
  const row = db.prepare(`
    SELECT c.*, j.name AS linkedJournalistName
    FROM coverage c
    LEFT JOIN journalists j ON j.id = c.journalistId
    WHERE c.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

// POST /api/coverage
router.post('/', (req, res) => {
  const {
    title, url = '', publication = '', publishDate = '',
    journalistId = null, journalistName = '',
    coverageType = 'mention', sentiment = 'neutral',
    summary = '', notes = '',
  } = req.body;

  if (!title?.trim()) return res.status(400).json({ error: 'title required' });

  const result = db.prepare(`
    INSERT INTO coverage
      (title, url, publication, publishDate, journalistId, journalistName,
       coverageType, sentiment, summary, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    title.trim(), url, publication, publishDate,
    journalistId || null, journalistName,
    coverageType, sentiment, summary, notes,
  );

  res.status(201).json(db.prepare('SELECT * FROM coverage WHERE id = ?').get(result.lastInsertRowid));
});

// PUT /api/coverage/:id
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT id FROM coverage WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const {
    title, url, publication, publishDate,
    journalistId, journalistName,
    coverageType, sentiment, summary, notes,
  } = req.body;

  db.prepare(`
    UPDATE coverage SET
      title = ?, url = ?, publication = ?, publishDate = ?,
      journalistId = ?, journalistName = ?,
      coverageType = ?, sentiment = ?, summary = ?, notes = ?,
      updatedAt = datetime('now')
    WHERE id = ?
  `).run(
    title, url, publication, publishDate,
    journalistId || null, journalistName || '',
    coverageType, sentiment, summary, notes,
    req.params.id,
  );

  res.json(db.prepare('SELECT * FROM coverage WHERE id = ?').get(req.params.id));
});

// DELETE /api/coverage/:id
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM coverage WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
