import axios from 'axios';
import * as cheerio from 'cheerio';
import Parser from 'rss-parser';
import pool from '../db';

const parser = new Parser({ timeout: 8000 });

const SECTION_HREF_KEYWORDS = [
  'ai', 'artificial-intelligence', 'artificial_intelligence',
  'machine-learning', 'machine_learning', 'generative-ai', 'generative_ai', 'genai',
  'llm', 'deep-learning', 'neural', 'startup', 'startups', 'funding', 'venture', 'fintech',
  'technology', 'tech', 'enterprise', 'software', 'developer', 'innovation', 'future',
];
const SECTION_TEXT_KEYWORDS = [
  'ai', 'artificial intelligence', 'machine learning', 'generative',
  'startup', 'startups', 'funding', 'venture', 'tech', 'technology', 'enterprise', 'software', 'innovation',
];
const RSS_SUFFIXES = [
  '/rss/index.xml', '/feed/', '/feed', '/rss/', '/rss', '/feed.xml', '/atom.xml',
  '?format=rss', '?rss=y', '?feed=rss2',
];
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

export async function discoverCategoryFeeds(publicationUrl: string): Promise<DiscoveredFeed[]> {
  const baseUrl = new URL(publicationUrl);
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

  const $ = cheerio.load(html);
  const candidateMap = new Map<string, string>();

  $('a[href]').each((_i, el) => {
    const rawHref = $(el).attr('href') || '';
    const text = $(el).text().trim();
    let absUrl: string;
    try { absUrl = new URL(rawHref, baseUrl.origin).href; } catch { return; }
    try { const u = new URL(absUrl); if (u.hostname !== baseUrl.hostname) return; } catch { return; }
    const path = absUrl.replace(/^https?:\/\/[^/]+/, '').replace(/\/$/, '') || '/';
    if (IGNORE_PATHS.has(path)) return;
    const segments = path.split('/').filter(Boolean);
    if (segments.length > 3) return;
    if (/\.(html?|php|aspx|jpg|png|pdf)$/i.test(path)) return;
    const hrefMatch = SECTION_HREF_KEYWORDS.some(kw => path.toLowerCase().includes(kw));
    const textMatch = SECTION_TEXT_KEYWORDS.some(kw => text.toLowerCase().includes(kw));
    if ((hrefMatch || textMatch) && !candidateMap.has(absUrl)) {
      const label = segments[segments.length - 1]?.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || text.slice(0, 40) || 'Section';
      candidateMap.set(absUrl, label);
    }
  });

  console.log(`[FeedDiscovery] ${baseUrl.hostname}: ${candidateMap.size} candidate section URLs`);

  const found: DiscoveredFeed[] = [];
  const checkedFeedUrls = new Set<string>();

  for (const [sectionUrl, label] of candidateMap) {
    if (found.length >= 6) break;
    for (const suffix of RSS_SUFFIXES) {
      const candidate = sectionUrl.replace(/\/$/, '') + suffix;
      if (checkedFeedUrls.has(candidate)) continue;
      checkedFeedUrls.add(candidate);
      try {
        const feed = await parser.parseURL(candidate);
        const itemCount = feed.items?.length ?? 0;
        if (itemCount > 0) {
          const feedTitle = feed.title?.trim();
          const cleanLabel = feedTitle && feedTitle.length < 60 && !feedTitle.toLowerCase().includes('rss') ? feedTitle : label;
          found.push({ feedUrl: candidate, feedLabel: cleanLabel, sectionUrl, itemCount });
          break;
        }
      } catch { /* not a valid feed */ }
    }
    await new Promise(r => setTimeout(r, 300));
  }
  return found;
}

export interface FeedDiscoveryResult {
  publicationId: number;
  publicationName: string;
  feedsFound: number;
  feedsAdded: number;
  feeds: DiscoveredFeed[];
  error?: string;
}

export async function discoverAndSaveFeeds(publicationId: number): Promise<FeedDiscoveryResult> {
  const pub = (await pool.query('SELECT * FROM publications WHERE id = $1', [publicationId])).rows[0];
  if (!pub) throw new Error(`Publication ${publicationId} not found`);
  if (!pub.url) throw new Error(`Publication "${pub.name}" has no homepage URL`);

  let feeds: DiscoveredFeed[] = [];
  try {
    feeds = await discoverCategoryFeeds(pub.url);
  } catch (err: any) {
    return { publicationId, publicationName: pub.name, feedsFound: 0, feedsAdded: 0, feeds: [], error: err.message };
  }

  const existingUrls = new Set(
    (await pool.query('SELECT "feedUrl" FROM publication_feeds WHERE "publicationId" = $1', [publicationId])).rows
      .map((r: any) => r.feedUrl.toLowerCase())
  );

  let added = 0;
  for (const feed of feeds) {
    if (!existingUrls.has(feed.feedUrl.toLowerCase())) {
      await pool.query(
        'INSERT INTO publication_feeds ("publicationId", "feedUrl", "feedLabel", "feedType", "rssStatus") VALUES ($1,$2,$3,\'category\',\'unknown\') ON CONFLICT DO NOTHING',
        [publicationId, feed.feedUrl, feed.feedLabel]
      );
      added++;
    }
  }

  console.log(`[FeedDiscovery] ${pub.name}: ${feeds.length} found, ${added} new`);
  return { publicationId, publicationName: pub.name, feedsFound: feeds.length, feedsAdded: added, feeds };
}
