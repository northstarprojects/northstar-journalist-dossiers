import { Router, Request, Response } from 'express';
import * as cheerio from 'cheerio';
import db from '../db';
import { discoverRssUrl } from '../services/rssDiscovery';
import { discoverAndSaveFeeds } from '../services/categoryFeedDiscovery';
import { discoverPublications } from '../services/blogDiscovery';

const router = Router();

// GET all publications (active first, then by tier then name)
// Includes feedCount from publication_feeds for UI display
router.get('/', (_req: Request, res: Response) => {
  const rows = db.prepare(`
    SELECT p.*, COUNT(pf.id) as feedCount
    FROM publications p
    LEFT JOIN publication_feeds pf ON pf.publicationId = p.id
    GROUP BY p.id
    ORDER BY p.active DESC, p.tier ASC, p.name ASC
  `).all();
  res.json(rows);
});

// GET single publication
router.get('/:id', (req: Request, res: Response) => {
  const row = db.prepare('SELECT * FROM publications WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

// POST create publication
// If no rssUrl is provided, attempt auto-discovery in the background
router.post('/', async (req: Request, res: Response) => {
  const { name, url = '', tier = 'B', focus = '', notes = '', active = 1, rssUrl = '', rssStatus = 'unknown' } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });

  const result = db.prepare(`
    INSERT INTO publications (name, url, tier, focus, notes, active, rssUrl, rssStatus)
    VALUES (@name, @url, @tier, @focus, @notes, @active, @rssUrl, @rssStatus)
  `).run({ name, url, tier, focus, notes, active, rssUrl, rssStatus });

  const created = db.prepare('SELECT * FROM publications WHERE id = ?').get(result.lastInsertRowid) as any;
  res.status(201).json(created);

  // Background: auto-discover RSS if no URL was provided and we have a publication URL
  if (!rssUrl && url) {
    discoverRssUrl(url).then(discovered => {
      if (discovered) {
        db.prepare(`
          UPDATE publications SET rssUrl=@rssUrl, rssStatus='active', updatedAt=datetime('now')
          WHERE id=@id
        `).run({ rssUrl: discovered, id: created.id });
        console.log(`[RssDiscovery] Auto-filled RSS for "${name}": ${discovered}`);
      } else {
        db.prepare(`UPDATE publications SET rssStatus='none' WHERE id=?`).run(created.id);
      }
    }).catch(err => {
      console.error(`[RssDiscovery] Failed for "${name}":`, err.message);
    });
  }
});

// PUT update publication
// If rssUrl was just added (previously empty), re-attempt discovery if still empty
router.put('/:id', async (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM publications WHERE id = ?').get(req.params.id) as any;
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const {
    name = existing.name, url = existing.url, tier = existing.tier,
    focus = existing.focus, notes = existing.notes ?? '', active = existing.active,
    rssUrl = existing.rssUrl ?? '', rssStatus = existing.rssStatus ?? 'unknown',
  } = req.body;

  db.prepare(`
    UPDATE publications SET name=@name, url=@url, tier=@tier, focus=@focus,
    notes=@notes, active=@active, rssUrl=@rssUrl, rssStatus=@rssStatus,
    updatedAt=datetime('now') WHERE id=@id
  `).run({ name, url, tier, focus, notes, active, rssUrl, rssStatus, id: req.params.id });

  res.json(db.prepare('SELECT * FROM publications WHERE id = ?').get(req.params.id));

  // Background: if URL changed and rssUrl is still blank, try auto-discovery
  const urlChanged = url !== existing.url;
  const stillNoRss = !rssUrl;
  if ((urlChanged || stillNoRss) && url && !rssUrl) {
    discoverRssUrl(url).then(discovered => {
      if (discovered) {
        db.prepare(`
          UPDATE publications SET rssUrl=@rssUrl, rssStatus='active', updatedAt=datetime('now')
          WHERE id=@id
        `).run({ rssUrl: discovered, id: req.params.id });
        console.log(`[RssDiscovery] Auto-filled RSS for "${name}": ${discovered}`);
      }
    }).catch(() => {});
  }
});

// POST discover RSS for a specific publication (manual trigger)
router.post('/:id/discover-rss', async (req: Request, res: Response) => {
  const pub = db.prepare('SELECT * FROM publications WHERE id = ?').get(req.params.id) as any;
  if (!pub) return res.status(404).json({ error: 'Not found' });
  if (!pub.url) return res.status(400).json({ error: 'Publication has no URL' });

  res.json({ message: 'RSS discovery started' });

  discoverRssUrl(pub.url).then(discovered => {
    if (discovered) {
      db.prepare(`
        UPDATE publications SET rssUrl=@rssUrl, rssStatus='active', updatedAt=datetime('now')
        WHERE id=@id
      `).run({ rssUrl: discovered, id: pub.id });
      console.log(`[RssDiscovery] Found for "${pub.name}": ${discovered}`);
    } else {
      db.prepare(`UPDATE publications SET rssStatus='none' WHERE id=?`).run(pub.id);
      console.log(`[RssDiscovery] No feed found for "${pub.name}"`);
    }
  }).catch(console.error);
});

// GET feeds for a publication
// GET /:id/journalists — all journalists tracked at this publication with outreach stats
router.get('/:id/journalists', (req: Request, res: Response) => {
  const pub = db.prepare('SELECT name FROM publications WHERE id = ?').get(req.params.id) as any;
  if (!pub) return res.status(404).json({ error: 'Not found' });

  const journalists = db.prepare(`
    SELECT
      j.*,
      COUNT(ol.id)  AS logCount,
      MAX(ol.date)  AS latestContact
    FROM journalists j
    LEFT JOIN outreach_logs ol ON ol.journalistId = j.id
    WHERE j.publication = ?
    GROUP BY j.id
    ORDER BY j.totalScore DESC
  `).all(pub.name);

  res.json(journalists);
});

router.get('/:id/feeds', (req: Request, res: Response) => {
  const feeds = db.prepare('SELECT * FROM publication_feeds WHERE publicationId = ? ORDER BY feedType ASC, id ASC').all(req.params.id);
  res.json(feeds);
});

// POST discover category feeds for a publication (manual trigger — runs in background)
router.post('/:id/discover-feeds', async (req: Request, res: Response) => {
  const pub = db.prepare('SELECT * FROM publications WHERE id = ?').get(req.params.id) as any;
  if (!pub) return res.status(404).json({ error: 'Not found' });
  if (!pub.url) return res.status(400).json({ error: 'Publication has no homepage URL' });

  // Respond immediately; discovery runs in background
  res.json({ message: 'Feed discovery started', publicationName: pub.name });

  discoverAndSaveFeeds(pub.id)
    .then(r => console.log(`[FeedDiscovery] ${r.publicationName}: ${r.feedsAdded} new feeds saved`))
    .catch(err => console.error(`[FeedDiscovery] Error for pub ${pub.id}:`, err.message));
});

// POST add a feed URL manually to a publication
router.post('/:id/feeds', (req: Request, res: Response) => {
  const { feedUrl, feedLabel = 'Manual', feedType = 'category' } = req.body;
  if (!feedUrl) return res.status(400).json({ error: 'feedUrl is required' });
  const pub = db.prepare('SELECT id FROM publications WHERE id = ?').get(req.params.id);
  if (!pub) return res.status(404).json({ error: 'Not found' });

  const result = db.prepare(`
    INSERT INTO publication_feeds (publicationId, feedUrl, feedLabel, feedType)
    VALUES (?, ?, ?, ?)
  `).run(req.params.id, feedUrl, feedLabel, feedType);

  res.status(201).json(db.prepare('SELECT * FROM publication_feeds WHERE id = ?').get(result.lastInsertRowid));
});

// DELETE a feed
router.delete('/:id/feeds/:feedId', (req: Request, res: Response) => {
  db.prepare('DELETE FROM publication_feeds WHERE id = ? AND publicationId = ?').run(req.params.feedId, req.params.id);
  res.json({ success: true });
});

// POST /discover — fan out to Feedly, Substack, Medium and return unified results
router.post('/discover', async (req: Request, res: Response) => {
  const { query } = req.body;
  if (!query?.trim()) return res.status(400).json({ error: 'query required' });

  // Build set of already-tracked domains to filter results
  const tracked = db.prepare('SELECT url FROM publications WHERE url IS NOT NULL AND url != \'\'').all() as any[];
  const existingDomains = new Set<string>(
    tracked.map(p => {
      try { return new URL(p.url).hostname.replace(/^www\./, '').toLowerCase(); }
      catch { return ''; }
    }).filter(Boolean)
  );

  const results = await discoverPublications(query.trim(), existingDomains);
  res.json(results);
});

// DELETE publication
router.delete('/:id', (req: Request, res: Response) => {
  db.prepare('DELETE FROM publications WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// POST import OPML
// Client sends { opmlContent: string } — file is read on the frontend and sent as plain text.
// Parses all <outline type="rss"> entries, filters duplicates + already-pending,
// saves new ones as publication_suggestions for admin review.
router.post('/import-opml', (req: Request, res: Response) => {
  const { opmlContent } = req.body as { opmlContent: string };
  if (!opmlContent || typeof opmlContent !== 'string') {
    return res.status(400).json({ error: 'opmlContent is required' });
  }

  // Parse OPML XML with cheerio in xmlMode
  const $ = cheerio.load(opmlContent, { xmlMode: true });

  interface FeedEntry { name: string; rssUrl: string; url: string; category: string }
  const feeds: FeedEntry[] = [];

  $('outline[xmlUrl]').each((_i, el) => {
    const rssUrl = $(el).attr('xmlUrl') || '';
    const name   = ($(el).attr('title') || $(el).attr('text') || '').trim();
    const url    = $(el).attr('htmlUrl') || '';
    // Walk up to find parent category name
    const parent = $(el).parent();
    const category = (parent.attr('title') || parent.attr('text') || '').trim();
    if (rssUrl && name) feeds.push({ name, rssUrl, url, category });
  });

  if (feeds.length === 0) {
    return res.status(400).json({ error: 'No RSS feeds found in this OPML file. Make sure it contains <outline type="rss" xmlUrl="..."> elements.' });
  }

  // Get all existing publication URLs + names for dedup
  const existingPubs = db.prepare('SELECT name, url, rssUrl FROM publications').all() as any[];
  const existingUrls  = new Set(existingPubs.map(p => (p.url  || '').toLowerCase().replace(/\/$/, '')));
  const existingRss   = new Set(existingPubs.map(p => (p.rssUrl || '').toLowerCase()));
  const existingNames = new Set(existingPubs.map(p => p.name.toLowerCase()));

  // Get already-pending suggestions
  const pendingSuggestions = db.prepare("SELECT name, url FROM publication_suggestions WHERE status='pending'").all() as any[];
  const pendingUrls  = new Set(pendingSuggestions.map(p => (p.url || '').toLowerCase().replace(/\/$/, '')));
  const pendingNames = new Set(pendingSuggestions.map(p => (p.name || '').toLowerCase()));

  const insertSuggestion = db.prepare(`
    INSERT INTO publication_suggestions (name, url, tier, focus, reason, status)
    VALUES (@name, @url, @tier, @focus, @reason, 'pending')
  `);

  let added = 0;
  let skippedDuplicate = 0;
  let skippedPending = 0;
  const addedNames: string[] = [];

  const importMany = db.transaction(() => {
    for (const feed of feeds) {
      const normUrl = (feed.url || '').toLowerCase().replace(/\/$/, '');
      const normRss = feed.rssUrl.toLowerCase();
      const normName = feed.name.toLowerCase();

      if (existingUrls.has(normUrl) || existingRss.has(normRss) || existingNames.has(normName)) {
        skippedDuplicate++;
        continue;
      }
      if (pendingUrls.has(normUrl) || pendingNames.has(normName)) {
        skippedPending++;
        continue;
      }

      // Infer tier from category name heuristic
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

      insertSuggestion.run({
        name: feed.name,
        url: feed.url || '',
        tier,
        focus: feed.category || '',
        reason,
      });

      // Also store rssUrl — we'll patch the suggestion table to carry it via the reason field
      // The RSS URL is in `reason`; when accepted, admin can copy it to the publication record
      added++;
      addedNames.push(feed.name);
    }
  });

  importMany();

  res.json({
    total: feeds.length,
    added,
    skippedDuplicate,
    skippedPending,
    message: added > 0
      ? `${added} new publication${added !== 1 ? 's' : ''} added to your review queue.`
      : 'All feeds already exist in your list or are pending review.',
    preview: addedNames.slice(0, 10),
  });
});

export default router;
