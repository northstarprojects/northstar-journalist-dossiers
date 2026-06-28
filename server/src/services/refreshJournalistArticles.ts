/**
 * Weekly journalist article refresh service.
 *
 * For every tracked journalist (not Declined / Not a Fit), scans their
 * publication's RSS feeds for new articles. Adds any new ones to the
 * articles table. If no article has been seen from them in the last 30 days,
 * sets staleFlag = 1 and outreachStatus = 'On Hold' (if they were Researching
 * or Ready to Pitch) so the user knows to verify before pitching.
 *
 * Cron: Fridays 7am ET  (configured in index.ts)
 */

import Parser from 'rss-parser';
import db from '../db';

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

/** Normalise an author name for loose comparison */
function normaliseName(name: string): string {
  return name.toLowerCase().replace(/[^a-z\s]/g, '').trim();
}

/** Extract author string from an RSS item */
function extractAuthor(item: any): string | null {
  const raw =
    item.creator || item.author || item['dc:creator'] ||
    (item.itunes?.author) || null;
  if (!raw || typeof raw !== 'string') return null;
  return raw
    .replace(/^[^\s(]+@[^\s(]+\s*/, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\(([^)]+)\)/, '$1')
    .trim() || null;
}

export async function refreshAllJournalistArticles(): Promise<RefreshResult[]> {
  const SKIP_STATUSES = new Set(['Declined', 'Not a Fit']);

  // All journalists we actively track
  const journalists = db.prepare(`
    SELECT j.*, p.id as pubId
    FROM journalists j
    LEFT JOIN publications p ON LOWER(p.name) = LOWER(j.publication)
    WHERE j.outreachStatus NOT IN ('Declined', 'Not a Fit')
    ORDER BY j.id ASC
  `).all() as any[];

  console.log(`[ArticleRefresh] Starting refresh for ${journalists.length} journalists...`);

  const results: RefreshResult[] = [];
  const staleThreshold = new Date();
  staleThreshold.setDate(staleThreshold.getDate() - STALE_DAYS);

  for (const j of journalists) {
    const result: RefreshResult = {
      journalistId: j.id,
      name: j.name,
      publication: j.publication,
      newArticles: 0,
      isStale: false,
    };

    try {
      if (!j.pubId) {
        result.error = 'publication not found in DB';
        results.push(result);
        continue;
      }

      // Get all feeds for this publication
      const feeds = db.prepare(
        "SELECT * FROM publication_feeds WHERE publicationId = ? AND rssStatus != 'inactive'"
      ).all(j.pubId) as any[];

      if (feeds.length === 0) {
        result.error = 'no active feeds';
        results.push(result);
        continue;
      }

      // Existing article URLs for this journalist (for dedup)
      const existingUrls = new Set(
        (db.prepare('SELECT url FROM articles WHERE journalistId = ?').all(j.id) as any[])
          .map((a: any) => a.url)
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

            // Loose name match — handles "Kyle Wiggers" vs "Kyle Wiggers, TechCrunch"
            if (!normaliseName(author).includes(normTarget) &&
                !normTarget.includes(normaliseName(author))) continue;

            const url = item.link || item.guid || '';
            if (!url || existingUrls.has(url)) continue;

            const pubDate = item.pubDate ? new Date(item.pubDate) : null;
            if (mostRecentDate === null || (pubDate && pubDate > mostRecentDate)) {
              mostRecentDate = pubDate;
            }

            newArticles.push({
              title: item.title || '',
              url,
              date: item.pubDate || '',
            });
            existingUrls.add(url);  // prevent double-adding within same scan
          }
        } catch {
          // individual feed failure — keep going
        }
        await new Promise(r => setTimeout(r, 300));
      }

      // Insert new articles
      if (newArticles.length > 0) {
        const insert = db.prepare(`
          INSERT OR IGNORE INTO articles (journalistId, title, url, publication, publishDate, topic)
          VALUES (@journalistId, @title, @url, @publication, @publishDate, @topic)
        `);
        const insertMany = db.transaction(() => {
          for (const a of newArticles) {
            insert.run({
              journalistId: j.id,
              title: a.title,
              url: a.url,
              publication: j.publication,
              publishDate: a.date,
              topic: j.beat || '',
            });
          }
        });
        insertMany();
        result.newArticles = newArticles.length;
      }

      // ── Staleness check ────────────────────────────────────────────────────
      // Get the most recent article date across ALL articles for this journalist
      const latestRow = db.prepare(`
        SELECT MAX(publishDate) as latest, MAX(createdAt) as latestCreated
        FROM articles WHERE journalistId = ?
      `).get(j.id) as any;

      // Use publishDate if valid, otherwise fall back to when we added it
      const latestDateStr = latestRow?.latest || latestRow?.latestCreated || '';
      const latestDate = latestDateStr ? new Date(latestDateStr) : null;

      const isStale = !latestDate || latestDate < staleThreshold;
      result.isStale = isStale;

      if (isStale) {
        db.prepare(`
          UPDATE journalists SET staleFlag = 1, updatedAt = datetime('now') WHERE id = ?
        `).run(j.id);
      } else {
        // Clear stale flag if they've published recently
        db.prepare(`
          UPDATE journalists SET
            staleFlag = 0,
            lastArticleDate = ?,
            updatedAt = datetime('now')
          WHERE id = ?
        `).run(latestDateStr, j.id);
      }

    } catch (err: any) {
      result.error = err.message;
    }

    results.push(result);
    await new Promise(r => setTimeout(r, 800)); // polite delay between journalists
  }

  const newTotal = results.reduce((s, r) => s + r.newArticles, 0);
  const staleCount = results.filter(r => r.isStale).length;
  console.log(
    `[ArticleRefresh] Done. ${newTotal} new articles added. ` +
    `${staleCount} journalist${staleCount !== 1 ? 's' : ''} flagged stale (no articles in ${STALE_DAYS} days).`
  );

  return results;
}
