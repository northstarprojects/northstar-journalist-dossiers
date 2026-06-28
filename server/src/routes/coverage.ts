import { Router } from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';
import pool from '../db';

const router = Router();

// POST /fetch-meta
router.post('/fetch-meta', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });

  try {
    const response = await axios.get(url, {
      timeout: 10_000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NorthStarBot/1.0)', 'Accept': 'text/html' },
      maxRedirects: 5,
    });
    const $ = cheerio.load(response.data);
    const og = (prop: string) =>
      $(`meta[property="og:${prop}"]`).attr('content') || $(`meta[name="og:${prop}"]`).attr('content') || '';
    const meta = (name: string) => $(`meta[name="${name}"]`).attr('content') || '';

    const title = og('title') || $('title').text().trim().split('|')[0].split('–')[0].split('-')[0].trim() || '';
    const siteName = og('site_name') || meta('application-name') || new URL(url).hostname.replace(/^www\./, '') || '';
    const rawDate = meta('article:published_time') || $('time[datetime]').first().attr('datetime') ||
      og('article:published_time') || meta('pubdate') || meta('date') || '';
    const publishDate = rawDate ? rawDate.split('T')[0] : '';
    const description = og('description') || meta('description') || '';

    return res.json({ title, publication: siteName, publishDate, description });
  } catch (err: any) {
    return res.status(422).json({ error: `Could not fetch that URL: ${err.message}`, title: '', publication: '', publishDate: '', description: '' });
  }
});

// GET /api/coverage
router.get('/', async (req, res) => {
  try {
    const { search, type, sentiment, journalistId } = req.query as Record<string, string>;
    let where = '1=1';
    const params: any[] = [];
    let n = 1;

    if (search) {
      where += ` AND (c.title ILIKE $${n} OR c.publication ILIKE $${n + 1} OR c."journalistName" ILIKE $${n + 2})`;
      const like = `%${search}%`;
      params.push(like, like, like);
      n += 3;
    }
    if (type)         { where += ` AND c."coverageType" = $${n++}`; params.push(type); }
    if (sentiment)    { where += ` AND c.sentiment = $${n++}`;       params.push(sentiment); }
    if (journalistId) { where += ` AND c."journalistId" = $${n++}`;  params.push(journalistId); }

    const result = await pool.query(`
      SELECT c.*, j.name AS "linkedJournalistName", j.publication AS "linkedPublication"
      FROM coverage c
      LEFT JOIN journalists j ON j.id = c."journalistId"
      WHERE ${where}
      ORDER BY c."publishDate" DESC, c."createdAt" DESC
    `, params);
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/coverage/:id
router.get('/:id', async (req, res) => {
  try {
    const row = (await pool.query(`
      SELECT c.*, j.name AS "linkedJournalistName"
      FROM coverage c LEFT JOIN journalists j ON j.id = c."journalistId"
      WHERE c.id = $1
    `, [req.params.id])).rows[0];
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/coverage
router.post('/', async (req, res) => {
  try {
    const {
      title, url = '', publication = '', publishDate = '',
      journalistId = null, journalistName = '',
      coverageType = 'mention', sentiment = 'neutral', summary = '', notes = '',
    } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'title required' });

    const result = await pool.query(`
      INSERT INTO coverage (title, url, publication, "publishDate", "journalistId", "journalistName",
        "coverageType", sentiment, summary, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id
    `, [title.trim(), url, publication, publishDate, journalistId || null, journalistName, coverageType, sentiment, summary, notes]);

    const created = (await pool.query('SELECT * FROM coverage WHERE id = $1', [result.rows[0].id])).rows[0];
    res.status(201).json(created);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/coverage/:id
router.put('/:id', async (req, res) => {
  try {
    const existing = (await pool.query('SELECT id FROM coverage WHERE id = $1', [req.params.id])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const { title, url, publication, publishDate, journalistId, journalistName, coverageType, sentiment, summary, notes } = req.body;
    await pool.query(`
      UPDATE coverage SET title=$1, url=$2, publication=$3, "publishDate"=$4,
        "journalistId"=$5, "journalistName"=$6, "coverageType"=$7, sentiment=$8,
        summary=$9, notes=$10, "updatedAt"=NOW()
      WHERE id=$11
    `, [title, url, publication, publishDate, journalistId || null, journalistName || '',
        coverageType, sentiment, summary, notes, req.params.id]);

    res.json((await pool.query('SELECT * FROM coverage WHERE id = $1', [req.params.id])).rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/coverage/:id
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM coverage WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
