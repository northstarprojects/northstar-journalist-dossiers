/**
 * rssDiscovery.ts
 * Automatically discovers the RSS feed URL for a publication
 * by trying common feed paths and parsing the HTML <head> for
 * <link rel="alternate" type="application/rss+xml">
 *
 * No external API required. Pure HTTP + HTML parsing (cheerio).
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import RssParser from 'rss-parser';

const parser = new RssParser({ timeout: 8000 });

const COMMON_FEED_PATHS = [
  '/feed',
  '/rss',
  '/feed.xml',
  '/atom.xml',
  '/rss.xml',
  '/feed/rss2',
  '/feeds/posts/default',  // Blogger
  '/blog/feed',
  '/news/feed',
  '/index.xml',            // Hugo
  '/?feed=rss2',           // WordPress
  '/feed/atom',
];

function normalizeBase(url: string): string {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    return `${u.protocol}//${u.host}`;
  } catch {
    return url.replace(/\/$/, '');
  }
}

async function isValidFeed(url: string): Promise<boolean> {
  try {
    const feed = await parser.parseURL(url);
    return Array.isArray(feed.items) && feed.items.length > 0;
  } catch {
    return false;
  }
}

async function extractFeedFromHtml(baseUrl: string): Promise<string | null> {
  try {
    const res = await axios.get(baseUrl, {
      timeout: 8000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NorthStarBot/1.0)' },
      maxRedirects: 3,
    });
    const $ = cheerio.load(res.data);
    const rssLink = $('link[rel="alternate"]').filter((_i, el) => {
      const type = $(el).attr('type') || '';
      return type.includes('rss') || type.includes('atom');
    }).first().attr('href');

    if (!rssLink) return null;
    // Handle relative URLs
    if (rssLink.startsWith('http')) return rssLink;
    return `${baseUrl}${rssLink.startsWith('/') ? '' : '/'}${rssLink}`;
  } catch {
    return null;
  }
}

/**
 * Main entry point.
 * Returns the discovered feed URL, or null if none found.
 */
export async function discoverRssUrl(publicationUrl: string): Promise<string | null> {
  const base = normalizeBase(publicationUrl);

  // Step 1: Try HTML <head> link tag first (most reliable)
  const fromHtml = await extractFeedFromHtml(base);
  if (fromHtml && await isValidFeed(fromHtml)) {
    console.log(`[RssDiscovery] Found via HTML link tag: ${fromHtml}`);
    return fromHtml;
  }

  // Step 2: Try common feed paths
  for (const path of COMMON_FEED_PATHS) {
    const candidate = `${base}${path}`;
    if (await isValidFeed(candidate)) {
      console.log(`[RssDiscovery] Found via path pattern: ${candidate}`);
      return candidate;
    }
  }

  console.log(`[RssDiscovery] No feed found for: ${base}`);
  return null;
}
