import { Router, Request, Response } from 'express';
import * as cheerio from 'cheerio';
import pool from '../db';
import { discoverRssUrl } from '../services/rssDiscovery';
import { discoverAndSaveFeeds } from '../services/categoryFeedDiscovery';
import { discoverPublications } from '../services/blogDiscovery';

const router = Router();

// GET all publications
router.get('/', async (_req: Request, res: Response) => {
  try {
    const rows = (await pool.query(`
      SELECT p.*, COUNT(pf.id)::int as "feedCount"
      FROM publications p
      LEFT JOIN publication_feeds pf ON pf."publicationId" = p.id
      GROUP BY p.id
      ORDER BY p.active DESC, p.tier ASC, p.name ASC
    `)).rows;
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET single publication
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const row = (await pool.query('SELECT * FROM publications WHERE id = $1', [req.params.id])).rows[0];
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST create publication
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, url = '', tier = 'B', focus = '', notes = '', active = 1, rssUrl = '', rssStatus = 'unknown' } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });

    const result = await pool.query(`
      INSERT INTO publications (name, url, tier, focus, notes, active, "rssUrl", "rssStatus")
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id
    `, [name, url, tier, focus, notes, active, rssUrl, rssStatus]);

    const created = (await pool.query('SELECT * FROM publications WHERE id = $1', [result.rows[0].id])).rows[0];
    res.status(201).json(created);

    // Background: auto-discover RSS
    if (!rssUrl && url) {
      discoverRssUrl(url).then(async discovered => {
        if (discovered) {
          await pool.query(
            'UPDATE publications SET "rssUrl"=$1, "rssStatus"=\'active\', "updatedAt"=NOW() WHERE id=$2',
            [discovered, created.id]
          );
          console.log(`[RssDiscovery] Auto-filled RSS for "${name}": ${discovered}`);
        } else {
          await pool.query("UPDATE publications SET \"rssStatus\"='none' WHERE id=$1", [created.id]);
        }
      }).catch(err => console.error(`[RssDiscovery] Failed for "${name}":`, err.message));
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update publication
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const existing = (await pool.query('SELECT * FROM publications WHERE id = $1', [req.params.id])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const {
      name = existing.name, url = existing.url, tier = existing.tier,
      focus = existing.focus, notes = existing.notes ?? '', active = existing.active,
      rssUrl = existing.rssUrl ?? '', rssStatus = existing.rssStatus ?? 'unknown',
    } = req.body;

    await pool.query(`
      UPDATE publications SET name=$1, url=$2, tier=$3, focus=$4, notes=$5, active=$6,
        "rssUrl"=$7, "rssStatus"=$8, "updatedAt"=NOW()
      WHERE id=$9
    `, [name, url, tier, focus, notes, active, rssUrl, rssStatus, req.params.id]);

    const updated = (await pool.query('SELECT * FROM publications WHERE id = $1', [req.params.id])).rows[0];
    res.json(updated);

    const urlChanged = url !== existing.url;
    if ((urlChanged || !rssUrl) && url && !rssUrl) {
      discoverRssUrl(url).then(async discovered => {
        if (discovered) {
          await pool.query(
            'UPDATE publications SET "rssUrl"=$1, "rssStatus"=\'active\', "updatedAt"=NOW() WHERE id=$2',
            [discovered, req.params.id]
          );
          console.log(`[RssDiscovery] Auto-filled RSS for "${name}": ${discovered}`);
        }
      }).catch(() => {});
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST discover RSS for a specific publication
router.post('/:id/discover-rss', async (req: Request, res: Response) => {
  try {
    const pub = (await pool.query('SELECT * FROM publications WHERE id = $1', [req.params.id])).rows[0];
    if (!pub) return res.status(404).json({ error: 'Not found' });
    if (!pub.url) return res.status(400).json({ error: 'Publication has no URL' });

    res.json({ message: 'RSS discovery started' });

    discoverRssUrl(pub.url).then(async discovered => {
      if (discovered) {
        await pool.query(
          'UPDATE publications SET "rssUrl"=$1, "rssStatus"=\'active\', "updatedAt"=NOW() WHERE id=$2',
          [discovered, pub.id]
        );
        console.log(`[RssDiscovery] Found for "${pub.name}": ${discovered}`);
      } else {
        await pool.query("UPDATE publications SET \"rssStatus\"='none' WHERE id=$1", [pub.id]);
        console.log(`[RssDiscovery] No feed found for "${pub.name}"`);
      }
    }).catch(console.error);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET journalists at a publication
router.get('/:id/journalists', async (req: Request, res: Response) => {
  try {
    const pub = (await pool.query('SELECT name FROM publications WHERE id = $1', [req.params.id])).rows[0];
    if (!pub) return res.status(404).json({ error: 'Not found' });

    const journalists = (await pool.query(`
      SELECT j.*, COUNT(ol.id)::int AS "logCount", MAX(ol.date) AS "latestContact"
      FROM journalists j
      LEFT JOIN outreach_logs ol ON ol."journalistId" = j.id
      WHERE j.publication = $1
      GROUP BY j.id
      ORDER BY j."totalScore" DESC
    `, [pub.name])).rows;

    res.json(journalists);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET feeds for a publication
router.get('/:id/feeds', async (req: Request, res: Response) => {
  try {
    const feeds = (await pool.query(
      'SELECT * FROM publication_feeds WHERE "publicationId" = $1 ORDER BY "feedType" ASC, id ASC',
      [req.params.id]
    )).rows;
    res.json(feeds);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST discover category feeds (background)
router.post('/:id/discover-feeds', async (req: Request, res: Response) => {
  try {
    const pub = (await pool.query('SELECT * FROM publications WHERE id = $1', [req.params.id])).rows[0];
    if (!pub) return res.status(404).json({ error: 'Not found' });
    if (!pub.url) return res.status(400).json({ error: 'Publication has no homepage URL' });

    res.json({ message: 'Feed discovery started', publicationName: pub.name });

    discoverAndSaveFeeds(pub.id)
      .then(r => console.log(`[FeedDiscovery] ${r.publicationName}: ${r.feedsAdded} new feeds saved`))
      .catch(err => console.error(`[FeedDiscovery] Error for pub ${pub.id}:`, err.message));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST add a feed URL manually
router.post('/:id/feeds', async (req: Request, res: Response) => {
  try {
    const { feedUrl, feedLabel = 'Manual', feedType = 'category' } = req.body;
    if (!feedUrl) return res.status(400).json({ error: 'feedUrl is required' });
    const pub = (await pool.query('SELECT id FROM publications WHERE id = $1', [req.params.id])).rows[0];
    if (!pub) return res.status(404).json({ error: 'Not found' });

    const result = await pool.query(`
      INSERT INTO publication_feeds ("publicationId", "feedUrl", "feedLabel", "feedType")
      VALUES ($1,$2,$3,$4) RETURNING id
    `, [req.params.id, feedUrl, feedLabel, feedType]);

    const created = (await pool.query('SELECT * FROM publication_feeds WHERE id = $1', [result.rows[0].id])).rows[0];
    res.status(201).json(created);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE a feed
router.delete('/:id/feeds/:feedId', async (req: Request, res: Response) => {
  try {
    await pool.query(
      'DELETE FROM publication_feeds WHERE id = $1 AND "publicationId" = $2',
      [req.params.feedId, req.params.id]
    );
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /discover — fan out to Feedly, Substack, Medium
router.post('/discover', async (req: Request, res: Response) => {
  try {
    const { query } = req.body;
    if (!query?.trim()) return res.status(400).json({ error: 'query required' });

    const tracked = (await pool.query("SELECT url FROM publications WHERE url IS NOT NULL AND url != ''")).rows;
    const existingDomains = new Set<string>(
      tracked.map(p => {
        try { return new URL(p.url).hostname.replace(/^www\./, '').toLowerCase(); }
        catch { return ''; }
      }).filter(Boolean)
    );

    const results = await discoverPublications(query.trim(), existingDomains);
    res.json(results);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE publication
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await pool.query('DELETE FROM publications WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST import OPML
router.post('/import-opml', async (req: Request, res: Response) => {
  try {
    const { opmlContent } = req.body as { opmlContent: string };
    if (!opmlContent || typeof opmlContent !== 'string') {
      return res.status(400).json({ error: 'opmlContent is required' });
    }

    const $ = cheerio.load(opmlContent, { xmlMode: true });

    interface FeedEntry { name: string; rssUrl: string; url: string; category: string }
    const feeds: FeedEntry[] = [];
    $('outline[xmlUrl]').each((_i, el) => {
      const rssUrl = $(el).attr('xmlUrl') || '';
      const name = ($(el).attr('title') || $(el).attr('text') || '').trim();
      const url = $(el).attr('htmlUrl') || '';
      const parent = $(el).parent();
      const category = (parent.attr('title') || parent.attr('text') || '').trim();
      if (rssUrl && name) feeds.push({ name, rssUrl, url, category });
    });

    if (feeds.length === 0) {
      return res.status(400).json({ error: 'No RSS feeds found in this OPML file.' });
    }

    const existingPubs = (await pool.query('SELECT name, url, "rssUrl" FROM publications')).rows;
    const existingUrls = new Set(existingPubs.map(p => (p.url || '').toLowerCase().replace(/\/$/, '')));
    const existingRss = new Set(existingPubs.map(p => (p.rssUrl || '').toLowerCase()));
    const existingNames = new Set(existingPubs.map(p => p.name.toLowerCase()));

    const pendingSuggestions = (await pool.query("SELECT name, url FROM publication_suggestions WHERE status='pending'")).rows;
    const pendingUrls = new Set(pendingSuggestions.map(p => (p.url || '').toLowerCase().replace(/\/$/, '')));
    const pendingNames = new Set(pendingSuggestions.map(p => (p.name || '').toLowerCase()));

    let added = 0;
    let skippedDuplicate = 0;
    let skippedPending = 0;
    const addedNames: string[] = [];

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const feed of feeds) {
        const normUrl = (feed.url || '').toLowerCase().replace(/\/$/, '');
        const normRss = feed.rssUrl.toLowerCase();
        const normName = feed.name.toLowerCase();

        if (existingUrls.has(normUrl) || existingRss.has(normRss) || existingNames.has(normName)) {
          skippedDuplicate++; continue;
        }
        if (pendingUrls.has(normUrl) || pendingNames.has(normName)) {
          skippedPending++; continue;
        }

        const cat = feed.category.toLowerCase();
        let tier = 'C';
        if (/techcrunch|wired|verge|venturebeat|ars technica|mit tech|bloomberg|wsj|forbes|fortune|fast company|inc\.|reuters|ap |associated press/i.test(feed.name)) {
          tier = 'A';
        } else if (/business|enterprise|finance|economy|market|investor/i.test(cat)) {
          tier = 'B';
        } else if (/major|top tier|tier a|tier 1/i.test(cat)) {
          tier = 'A';
        }

        const reason = `Imported from OPML${feed.category ? ` (category: ${feed.category})` : ''}. RSS: ${feed.rssUrl}`;
        await client.query(
          'INSERT INTO publication_suggestions (name, url, tier, focus, reason, status) VALUES ($1,$2,$3,$4,$5,\'pending\')',
          [feed.name, feed.url || '', tier, feed.category || '', reason]
        );
        added++;
        addedNames.push(feed.name);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.json({
      total: feeds.length, added, skippedDuplicate, skippedPending,
      message: added > 0
        ? `${added} new publication${added !== 1 ? 's' : ''} added to your review queue.`
        : 'All feeds already exist in your list or are pending review.',
      preview: addedNames.slice(0, 10),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
