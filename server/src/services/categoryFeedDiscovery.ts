import axios from 'axios';
import * as cheerio from 'cheerio';
import Parser from 'rss-parser';
import db from '../db';

const parser = new Parser({ timeout: 8000 });

// ─── Keyword sets ─────────────────────────────────────────────────────────────

// Substrings to match against link href paths AND visible anchor text
const SECTION_HREF_KEYWORDS = [
  'ai', 'artificial-intelligence', 'artificial_intelligence',
  'machine-learning', 'machine_learning',
  'generative-ai', 'generative_ai', 'genai',
  'llm', 'deep-learning', 'neural',
  'startup', 'startups', 'funding', 'venture', 'fintech',
  'technology', 'tech', 'enterprise', 'software', 'developer',
  'innovation', 'future',
];

// Anchor text must contain one of these words (case-insensitive)
const SECTION_TEXT_KEYWORDS = [
  'ai', 'artificial intelligence', 'machine learning', 'generative',
  'startup', 'startups', 'funding', 'venture',
  'tech', 'technology', 'enterprise', 'software',
  'innovation',
];

// RSS URL suffix patterns to probe for a given section URL
const RSS_SUFFIXES = [
  '/rss/index.xml',
  '/feed/',
  '/feed',
  '/rss/',
  '/rss',
  '/feed.xml',
  '/atom.xml',
  '?format=rss',
  '?rss=y',
  '?feed=rss2',
];

// Paths to ignore — navigational links, not content sections
const IGNORE_PATHS = new Set([
  '/', '/about', '/contact', '/advertise', '/subscribe', '/newsletter',
  '/login', '/signup', '/account', '/search', '/sitemap', '/privacy', '/terms',
  '/careers', '/jobs', '/events', '/store', '/shop',
]);

export interface DiscoveredFeed {
  feedUrl: string;
  feedLabel: string;
  sectionUrl: string;
  itemCount: number;
}

// ─── Main discovery function ──────────────────────────────────────────────────

export async function discoverCategoryFeeds(publicationUrl: string): Promise<DiscoveredFeed[]> {
  const baseUrl = new URL(publicationUrl);

  // 1. Fetch homepage HTML
  let html: string;
  try {
    const res = await axios.get(publicationUrl, {
      timeout: 12000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NorthStarBot/1.0; +https://northstarai.com)' },
      maxRedirects: 5,
    });
    html = res.data as string;
  } catch (err: any) {
    throw new Error(`Failed to fetch ${publicationUrl}: ${err.message}`);
  }

  // 2. Parse DOM and collect candidate section URLs
  const $ = cheerio.load(html);
  const candidateMap = new Map<string, string>(); // url → label

  $('a[href]').each((_i, el) => {
    const rawHref = $(el).attr('href') || '';
    const text    = $(el).text().trim();

    // Resolve to absolute URL
    let absUrl: string;
    try {
      absUrl = new URL(rawHref, baseUrl.origin).href;
    } catch {
      return;
    }

    // Must be same domain
    try {
      const u = new URL(absUrl);
      if (u.hostname !== baseUrl.hostname) return;
    } catch {
      return;
    }

    // Extract path (without trailing slash)
    const path = absUrl.replace(/^https?:\/\/[^/]+/, '').replace(/\/$/, '') || '/';

    // Skip ignored navigational paths
    if (IGNORE_PATHS.has(path)) return;
    // Skip paths that are clearly not section pages (too many segments, file extensions, etc.)
    const segments = path.split('/').filter(Boolean);
    if (segments.length > 3) return;
    if (/\.(html?|php|aspx|jpg|png|pdf)$/i.test(path)) return;

    // Check href path keyword match
    const hrefMatch = SECTION_HREF_KEYWORDS.some(kw => path.toLowerCase().includes(kw));
    // Check anchor text keyword match
    const textMatch = SECTION_TEXT_KEYWORDS.some(kw => text.toLowerCase().includes(kw));

    if (hrefMatch || textMatch) {
      if (!candidateMap.has(absUrl)) {
        // Generate a human label from the path
        const label = segments[segments.length - 1]
          ?.replace(/[-_]/g, ' ')
          .replace(/\b\w/g, c => c.toUpperCase())
          || text.slice(0, 40)
          || 'Section';
        candidateMap.set(absUrl, label);
      }
    }
  });

  console.log(`[FeedDiscovery] ${baseUrl.hostname}: ${candidateMap.size} candidate section URLs`);

  // 3. For each candidate section URL, probe for an RSS feed
  const found: DiscoveredFeed[] = [];
  const checkedFeedUrls = new Set<string>();
  // Pre-load already-existing feed URLs for this publication (to avoid duplicates)
  // We'll check in the caller, but a quick dedup here avoids redundant HTTP calls.

  for (const [sectionUrl, label] of candidateMap) {
    if (found.length >= 6) break; // Cap: don't discover more than 6 category feeds

    for (const suffix of RSS_SUFFIXES) {
      const candidate = sectionUrl.replace(/\/$/, '') + suffix;
      if (checkedFeedUrls.has(candidate)) continue;
      checkedFeedUrls.add(candidate);

      try {
        const feed = await parser.parseURL(candidate);
        const itemCount = feed.items?.length ?? 0;
        if (itemCount > 0) {
          // Clean up label — prefer feed title if it's informative
          const feedTitle = feed.title?.trim();
          const cleanLabel = feedTitle && feedTitle.length < 60 && !feedTitle.toLowerCase().includes('rss')
            ? feedTitle
            : label;
          found.push({ feedUrl: candidate, feedLabel: cleanLabel, sectionUrl, itemCount });
          console.log(`[FeedDiscovery] ✓ ${candidate} (${itemCount} items, label: "${cleanLabel}")`);
          break; // Valid feed found for this section, stop trying suffixes
        }
      } catch {
        // Not a valid feed at this suffix, try next
      }
    }

    // Small delay between probes to be polite
    await new Promise(r => setTimeout(r, 300));
  }

  return found;
}

// ─── Persist discovered feeds to DB ──────────────────────────────────────────

export interface FeedDiscoveryResult {
  publicationId: number;
  publicationName: string;
  feedsFound: number;
  feedsAdded: number;
  feeds: DiscoveredFeed[];
  error?: string;
}

export async function discoverAndSaveFeeds(publicationId: number): Promise<FeedDiscoveryResult> {
  const pub = db.prepare('SELECT * FROM publications WHERE id = ?').get(publicationId) as any;
  if (!pub) throw new Error(`Publication ${publicationId} not found`);
  if (!pub.url) throw new Error(`Publication "${pub.name}" has no homepage URL`);

  let feeds: DiscoveredFeed[] = [];
  try {
    feeds = await discoverCategoryFeeds(pub.url);
  } catch (err: any) {
    return { publicationId, publicationName: pub.name, feedsFound: 0, feedsAdded: 0, feeds: [], error: err.message };
  }

  // Get existing feed URLs for this publication to avoid duplicates
  const existingUrls = new Set(
    (db.prepare('SELECT feedUrl FROM publication_feeds WHERE publicationId = ?').all(publicationId) as any[])
      .map((r: any) => r.feedUrl.toLowerCase())
  );

  const insertFeed = db.prepare(`
    INSERT INTO publication_feeds (publicationId, feedUrl, feedLabel, feedType, rssStatus)
    VALUES (?, ?, ?, 'category', 'unknown')
  `);

  let added = 0;
  const saveTx = db.transaction(() => {
    for (const feed of feeds) {
      if (!existingUrls.has(feed.feedUrl.toLowerCase())) {
        insertFeed.run(publicationId, feed.feedUrl, feed.feedLabel);
        added++;
      }
    }
  });
  saveTx();

  console.log(`[FeedDiscovery] ${pub.name}: ${feeds.length} found, ${added} new`);
  return { publicationId, publicationName: pub.name, feedsFound: feeds.length, feedsAdded: added, feeds };
}
