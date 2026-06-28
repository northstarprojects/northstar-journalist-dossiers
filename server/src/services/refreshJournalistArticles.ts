/**
 * Weekly journalist article refresh service.
 * Scans RSS feeds for new articles per journalist, flags stale ones.
 */

import Parser from 'rss-parser';
import pool from '../db';

const parser = new Parser({
  timeout: 10000,
  customFields: { item: [['dc:creator', 'creator'], ['author', 'author']] },
});

const STALE_DAYS = 30;

export interface RefreshResult {
  journalistId: number;
  name: string;
  publication: string;
  newArticles: number;
  isStale: boolean;
  error?: string;
}

function normaliseName(name: string): string {
  return name.toLowerCase().replace(/[^a-z\s]/g, '').trim();
}
function extractAuthor(item: any): string | null {
  const raw = item.creator || item.author || item['dc:creator'] || (item.itunes?.author) || null;
  if (!raw || typeof raw !== 'string') return null;
  return raw.replace(/^[^\s(]+@[^\s(]+\s*/, '').replace(/<[^>]+>/g, '').replace(/\(([^)]+)\)/, '$1').trim() || null;
}

export async function refreshAllJournalistArticles(): Promise<RefreshResult[]> {
  const journalists = (await pool.query(`
    SELECT j.*, p.id as "pubId"
    FROM journalists j
    LEFT JOIN publications p ON LOWER(p.name) = LOWER(j.publication)
    WHERE j."outreachStatus" NOT IN ('Declined', 'Not a Fit')
    ORDER BY j.id ASC
  `)).rows;

  console.log(`[ArticleRefresh] Starting refresh for ${journalists.length} journalists...`);
  const results: RefreshResult[] = [];
  const staleThreshold = new Date();
  staleThreshold.setDate(staleThreshold.getDate() - STALE_DAYS);

  for (const j of journalists) {
    const result: RefreshResult = { journalistId: j.id, name: j.name, publication: j.publication, newArticles: 0, isStale: false };
    try {
      if (!j.pubId) { result.error = 'publication not found in DB'; results.push(result); continue; }

      const feeds = (await pool.query(
        "SELECT * FROM publication_feeds WHERE \"publicationId\" = $1 AND \"rssStatus\" != 'inactive'",
        [j.pubId]
      )).rows;
      if (feeds.length === 0) { result.error = 'no active feeds'; results.push(result); continue; }

      const existingUrls = new Set(
        (await pool.query('SELECT url FROM articles WHERE "journalistId" = $1', [j.id])).rows.map((a: any) => a.url)
      );

      const normTarget = normaliseName(j.name);
      const newArticles: { title: string; url: string; date: string }[] = [];
      let mostRecentDate: Date | null = null;

      for (const feed of feeds) {
        try {
          const parsed = await parser.parseURL(feed.feedUrl);
          for (const item of parsed.items ?? []) {
            const author = extractAuthor(item);
            if (!author) continue;
            if (!normaliseName(author).includes(normTarget) && !normTarget.includes(normaliseName(author))) continue;
            const url = item.link || item.guid || '';
            if (!url || existingUrls.has(url)) continue;
            const pubDate = item.pubDate ? new Date(item.pubDate) : null;
            if (mostRecentDate === null || (pubDate && pubDate > mostRecentDate)) mostRecentDate = pubDate;
            newArticles.push({ title: item.title || '', url, date: item.pubDate || '' });
            existingUrls.add(url);
          }
        } catch { /* individual feed failure — keep going */ }
        await new Promise(r => setTimeout(r, 300));
      }

      if (newArticles.length > 0) {
        for (const a of newArticles) {
          await pool.query(`
            INSERT INTO articles ("journalistId", title, url, publication, "publishDate", topic)
            VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING
          `, [j.id, a.title, a.url, j.publication, a.date, j.beat || '']);
        }
        result.newArticles = newArticles.length;
      }

      const latestRow = (await pool.query(
        'SELECT MAX("publishDate") as latest, MAX("createdAt") as "latestCreated" FROM articles WHERE "journalistId" = $1',
        [j.id]
      )).rows[0];
      const latestDateStr = latestRow?.latest || '';
      const latestDate = latestDateStr ? new Date(latestDateStr) : null;
      const isStale = !latestDate || latestDate < staleThreshold;
      result.isStale = isStale;

      if (isStale) {
        await pool.query('UPDATE journalists SET "staleFlag" = 1, "updatedAt" = NOW() WHERE id = $1', [j.id]);
      } else {
        await pool.query(
          'UPDATE journalists SET "staleFlag" = 0, "lastArticleDate" = $1, "updatedAt" = NOW() WHERE id = $2',
          [latestDateStr, j.id]
        );
      }
    } catch (err: any) {
      result.error = err.message;
    }
    results.push(result);
    await new Promise(r => setTimeout(r, 800));
  }

  const newTotal = results.reduce((s, r) => s + r.newArticles, 0);
  const staleCount = results.filter(r => r.isStale).length;
  console.log(`[ArticleRefresh] Done. ${newTotal} new articles. ${staleCount} stale journalist(s).`);
  return results;
}
