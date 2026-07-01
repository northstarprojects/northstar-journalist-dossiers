import { Router } from 'express';
import axios from 'axios';
import pool from '../db';

const router = Router();

// GET /api/enrichment/credits — SerpAPI remaining searches
router.get('/credits', async (_req, res) => {
  const apiKey = process.env.SERP_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'SERP_API_KEY not set' });
  try {
    const r = await axios.get('https://serpapi.com/account', { params: { api_key: apiKey } });
    const { plan_searches_left, total_searches_done, plan_monthly_searches } = r.data;
    res.json({ searches_left: plan_searches_left, searches_done: total_searches_done, searches_limit: plan_monthly_searches });
  } catch (err: any) {
    res.status(500).json({ error: err.response?.data?.error || err.message });
  }
});

// POST /api/enrichment/:id/profiles — find LinkedIn, MuckRack, Twitter via SerpAPI
router.post('/:id/profiles', async (req, res) => {
  const apiKey = process.env.SERP_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'SERP_API_KEY not set' });

  const journalist = (await pool.query(
    'SELECT id, name, publication FROM journalists WHERE id = $1', [req.params.id]
  )).rows[0];
  if (!journalist) return res.status(404).json({ error: 'Not found' });

  const query = `"${journalist.name}" "${journalist.publication}"`;
  try {
    const r = await axios.get('https://serpapi.com/search.json', {
      params: { q: query, api_key: apiKey, num: 10 },
      timeout: 15_000,
    });

    const results: { link: string }[] = r.data?.organic_results || [];
    let linkedinUrl = '', muckrackUrl = '', twitterUrl = '';

    for (const result of results) {
      const url = result.link || '';
      if (!linkedinUrl && /linkedin\.com\/in\//.test(url)) linkedinUrl = url;
      if (!muckrackUrl && /muckrack\.com\//.test(url)) muckrackUrl = url;
      if (!twitterUrl && /(?:twitter|x)\.com\/[^/]+$/.test(url)) twitterUrl = url;
    }

    const updates: string[] = [];
    const values: any[] = [];
    let i = 1;
    if (linkedinUrl) { updates.push(`"linkedinUrl" = $${i++}`); values.push(linkedinUrl); }
    if (muckrackUrl) { updates.push(`"muckRackUrl" = $${i++}`); values.push(muckrackUrl); }
    if (twitterUrl)  { updates.push(`"twitterUrl"  = $${i++}`); values.push(twitterUrl); }

    if (updates.length > 0) {
      values.push(journalist.id);
      await pool.query(
        `UPDATE journalists SET ${updates.join(', ')}, "updatedAt" = NOW() WHERE id = $${i}`,
        values
      );
    }

    res.json({ linkedinUrl, muckrackUrl, twitterUrl, saved: updates.length > 0 });
  } catch (err: any) {
    res.status(500).json({ error: err.response?.data?.error || err.message });
  }
});

// POST /api/enrichment/bulk/profiles — find profiles for all journalists missing them
router.post('/bulk/profiles', async (_req, res) => {
  const apiKey = process.env.SERP_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'SERP_API_KEY not set' });

  const missing = (await pool.query(`
    SELECT id, name, publication FROM journalists
    WHERE ("linkedinUrl" IS NULL OR "linkedinUrl" = '')
      AND ("muckRackUrl" IS NULL OR "muckRackUrl" = '')
  `)).rows;

  if (missing.length === 0) return res.json({ message: 'All journalists already have profiles.', count: 0 });

  res.json({ message: `Finding profiles for ${missing.length} journalists in the background…`, count: missing.length });

  (async () => {
    let found = 0;
    for (const j of missing) {
      await new Promise(r => setTimeout(r, 1500));
      try {
        const r = await axios.get('https://serpapi.com/search.json', {
          params: { q: `"${j.name}" "${j.publication}"`, api_key: apiKey, num: 10 },
          timeout: 15_000,
        });
        const results: { link: string }[] = r.data?.organic_results || [];
        let linkedinUrl = '', muckrackUrl = '', twitterUrl = '';
        for (const result of results) {
          const url = result.link || '';
          if (!linkedinUrl && /linkedin\.com\/in\//.test(url)) linkedinUrl = url;
          if (!muckrackUrl && /muckrack\.com\//.test(url)) muckrackUrl = url;
          if (!twitterUrl && /(?:twitter|x)\.com\/[^/]+$/.test(url)) twitterUrl = url;
        }
        const updates: string[] = [];
        const values: any[] = [];
        let i = 1;
        if (linkedinUrl) { updates.push(`"linkedinUrl" = $${i++}`); values.push(linkedinUrl); }
        if (muckrackUrl) { updates.push(`"muckRackUrl" = $${i++}`); values.push(muckrackUrl); }
        if (twitterUrl)  { updates.push(`"twitterUrl"  = $${i++}`); values.push(twitterUrl); }
        if (updates.length > 0) {
          values.push(j.id);
          await pool.query(
            `UPDATE journalists SET ${updates.join(', ')}, "updatedAt" = NOW() WHERE id = $${i}`,
            values
          );
          found++;
          console.log(`[SerpAPI] ${j.name} → linkedin:${!!linkedinUrl} muckrack:${!!muckrackUrl} twitter:${!!twitterUrl}`);
        }
      } catch (err: any) {
        console.error(`[SerpAPI] Error for ${j.name}:`, err.message);
      }
    }
    console.log(`[SerpAPI Bulk] Done. Found profiles for ${found}/${missing.length} journalists.`);
  })();
});

export default router;
