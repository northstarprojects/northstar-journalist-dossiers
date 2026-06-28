/**
 * staffPageScanner.ts
 * Free alternative to Firecrawl.
 *
 * Crawls a publication's public staff/authors page using cheerio (HTML parser)
 * to extract journalist names. Only reads public pages that publications
 * intentionally create to list their staff.
 *
 * Limitations vs. Firecrawl:
 * - Does not execute JavaScript — only works on server-rendered HTML
 * - May not work on heavily JS-rendered sites (React/Next.js SPAs)
 * - For those, Firecrawl is the paid upgrade path
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import db from '../db';

// Common paths where publications list their authors/staff
const STAFF_PAGE_PATHS = [
  '/authors',
  '/staff',
  '/team',
  '/about/team',
  '/contributors',
  '/writers',
  '/reporters',
  '/people',
  '/about/staff',
  '/newsroom/staff',
];

// Patterns that indicate an author profile link
const AUTHOR_LINK_PATTERNS = [
  /\/author\//i,
  /\/authors\//i,
  /\/staff\//i,
  /\/writer\//i,
  /\/reporter\//i,
  /\/contributor\//i,
  /\/people\//i,
  /\/team\//i,
  /\/profile\//i,
];

// Generic/system names to filter out
const GENERIC_NAMES = new Set([
  'staff', 'admin', 'editor', 'editors', 'editorial', 'team',
  'contributor', 'contributors', 'writer', 'writers', 'reporter',
  'reporters', 'author', 'authors', 'guest', 'wire', 'ap', 'reuters',
  'associated press', 'bloomberg wire', 'newsroom',
]);

function isGenericName(name: string): boolean {
  return GENERIC_NAMES.has(name.toLowerCase().trim()) || name.trim().length < 4;
}

function looksLikePersonName(name: string): boolean {
  const parts = name.trim().split(/\s+/);
  // Should have 2–4 words, each capitalised
  if (parts.length < 2 || parts.length > 4) return false;
  return parts.every(p => /^[A-Z][a-zA-Z'-]+$/.test(p));
}

async function fetchPage(url: string): Promise<string | null> {
  try {
    const res = await axios.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NorthStarBot/1.0; +https://northstarai.com)',
        'Accept': 'text/html',
      },
      maxRedirects: 3,
    });
    if (typeof res.data === 'string') return res.data;
    return null;
  } catch {
    return null;
  }
}

function normalizeBase(url: string): string {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    return `${u.protocol}//${u.host}`;
  } catch {
    return url.replace(/\/$/, '');
  }
}

/**
 * Extract journalist names from a staff/authors HTML page.
 * Strategy: find author profile links, use their link text as name.
 * Fallback: look for <h2>/<h3> or elements with class containing "name".
 */
function extractNamesFromHtml(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const names = new Set<string>();

  // Strategy 1: anchor tags pointing to author profile URLs
  $('a[href]').each((_i, el) => {
    const href = $(el).attr('href') || '';
    const isAuthorLink = AUTHOR_LINK_PATTERNS.some(p => p.test(href));
    if (!isAuthorLink) return;

    // Try to get a name: from text content, aria-label, or title
    const text = $(el).text().trim()
      || $(el).attr('aria-label')?.trim()
      || $(el).attr('title')?.trim()
      || '';

    if (text && !isGenericName(text) && looksLikePersonName(text)) {
      names.add(text);
    }
  });

  // Strategy 2: elements with class containing "name" or "author"
  if (names.size < 3) {
    $('[class*="name"], [class*="author"], [class*="writer"], [itemprop="name"]').each((_i, el) => {
      const text = $(el).text().trim();
      if (text && !isGenericName(text) && looksLikePersonName(text)) {
        names.add(text);
      }
    });
  }

  // Strategy 3: structured data (JSON-LD)
  $('script[type="application/ld+json"]').each((_i, el) => {
    try {
      const data = JSON.parse($(el).html() || '');
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item['@type'] === 'Person' && item.name) {
          const n = item.name.trim();
          if (!isGenericName(n) && looksLikePersonName(n)) names.add(n);
        }
      }
    } catch { /* ignore malformed JSON-LD */ }
  });

  return [...names];
}

export interface StaffScanResult {
  found: number;
  added: number;
  skipped: number;
  names: string[];
  pageScanned: string | null;
  error?: string;
}

/**
 * Scan a publication's staff/author pages and save discovered journalists
 * to the journalist_suggestions table.
 */
export async function scanStaffPage(publicationId: number): Promise<StaffScanResult> {
  const pub = db.prepare('SELECT * FROM publications WHERE id = ?').get(publicationId) as any;
  if (!pub) return { found: 0, added: 0, skipped: 0, names: [], pageScanned: null, error: 'Publication not found' };
  if (!pub.url) return { found: 0, added: 0, skipped: 0, names: [], pageScanned: null, error: 'Publication has no URL' };

  const base = normalizeBase(pub.url);
  let html: string | null = null;
  let pageScanned: string | null = null;

  // Try each staff page path
  for (const path of STAFF_PAGE_PATHS) {
    const url = `${base}${path}`;
    html = await fetchPage(url);
    if (html && html.length > 500) {
      pageScanned = url;
      break;
    }
  }

  if (!html || !pageScanned) {
    return { found: 0, added: 0, skipped: 0, names: [], pageScanned: null, error: 'No accessible staff page found' };
  }

  const names = extractNamesFromHtml(html, base);
  console.log(`[StaffScanner] "${pub.name}" → ${names.length} names from ${pageScanned}`);

  let added = 0;
  let skipped = 0;
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  for (const name of names) {
    // Skip if already a journalist
    const existingJournalist = db.prepare(
      "SELECT id FROM journalists WHERE LOWER(name)=LOWER(?) AND LOWER(publication)=LOWER(?)"
    ).get(name, pub.name);
    if (existingJournalist) { skipped++; continue; }

    // Skip if already a pending suggestion
    const existingSuggestion = db.prepare(
      "SELECT id FROM journalist_suggestions WHERE LOWER(name)=LOWER(?) AND publicationId=? AND status='pending'"
    ).get(name, publicationId);
    if (existingSuggestion) { skipped++; continue; }

    // Skip if rejected within 30 days
    const recentReject = db.prepare(
      "SELECT id FROM journalist_suggestions WHERE LOWER(name)=LOWER(?) AND publicationId=? AND status='rejected' AND createdAt > ?"
    ).get(name, publicationId, thirtyDaysAgo);
    if (recentReject) { skipped++; continue; }

    db.prepare(`
      INSERT INTO journalist_suggestions
        (name, publicationId, publicationName, sourceType, recentArticleTitle, recentArticleUrl, recentArticleDate, suggestedBeat, status)
      VALUES
        (@name, @publicationId, @publicationName, 'staffpage', @recentArticleTitle, '', '', '', 'pending')
    `).run({
      name,
      publicationId,
      publicationName: pub.name,
      recentArticleTitle: `Found on staff page: ${pageScanned}`,
    });
    added++;
  }

  return { found: names.length, added, skipped, names, pageScanned };
}
