/**
 * Blog / publication discovery service.
 * Queries multiple sources in parallel and returns a unified, deduplicated list.
 *
 * Sources:
 *   1. Feedly feed search  — broad RSS/blog index, no API key needed
 *   2. Substack search     — newsletters on Substack
 *   3. Medium tag feeds    — derived from query keywords, always valid
 */

import axios from 'axios';

export interface DiscoveredPublication {
  name: string;
  url: string;
  feedUrl: string;
  description: string;
  source: 'feedly' | 'substack' | 'medium';
  subscribers?: number;       // Feedly subscriber count where available
  suggestedTier: 'A' | 'B' | 'C';
  focus: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractDomain(url: string): string {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname
      .replace(/^www\./, '').toLowerCase();
  } catch { return url.toLowerCase(); }
}

function guessTier(subscribers?: number): 'A' | 'B' | 'C' {
  if (!subscribers) return 'C';
  if (subscribers >= 50_000) return 'A';
  if (subscribers >= 5_000)  return 'B';
  return 'C';
}

// ── Source 1: Feedly feed search ──────────────────────────────────────────────
// Public endpoint — no API key required for basic queries.
async function queryFeedly(query: string): Promise<DiscoveredPublication[]> {
  try {
    const res = await axios.get('https://cloud.feedly.com/v3/search/feeds', {
      params: { q: query, count: 30, locale: 'en' },
      timeout: 10_000,
      headers: { 'User-Agent': 'NorthStarBot/1.0' },
    });

    const results: DiscoveredPublication[] = [];
    for (const item of res.data?.results || []) {
      // feedId format: "feed/https://example.com/rss"
      const feedUrl = item.feedId?.replace(/^feed\//, '') || '';
      const siteUrl = item.website || feedUrl;
      if (!feedUrl || !siteUrl) continue;

      results.push({
        name:           item.title || item.visualUrl || extractDomain(siteUrl),
        url:            siteUrl,
        feedUrl,
        description:    item.description || '',
        source:         'feedly',
        subscribers:    item.subscribers || 0,
        suggestedTier:  guessTier(item.subscribers),
        focus:          item.description || '',
      });
    }
    return results;
  } catch (err: any) {
    console.warn('[Discover] Feedly error:', err.message);
    return [];
  }
}

// ── Source 2: Substack search ──────────────────────────────────────────────────
// Substack's public search API — no auth needed.
async function querySubstack(query: string): Promise<DiscoveredPublication[]> {
  try {
    const res = await axios.get('https://substack.com/api/v1/search', {
      params: { query, type: 'publication', offset: 0 },
      timeout: 10_000,
      headers: { 'User-Agent': 'NorthStarBot/1.0' },
    });

    const pubs = res.data?.publications || res.data?.results || [];
    const results: DiscoveredPublication[] = [];

    for (const p of pubs) {
      const subdomain = p.subdomain || p.custom_domain_optional;
      if (!subdomain) continue;

      const baseUrl = p.custom_domain
        ? `https://${p.custom_domain}`
        : `https://${subdomain}.substack.com`;

      const feedUrl = `${baseUrl}/feed`;

      results.push({
        name:          p.name || subdomain,
        url:           baseUrl,
        feedUrl,
        description:   p.description || '',
        source:        'substack',
        subscribers:   p.subscriber_count || 0,
        suggestedTier: guessTier(p.subscriber_count),
        focus:         p.description || '',
      });
    }
    return results;
  } catch (err: any) {
    console.warn('[Discover] Substack error:', err.message);
    return [];
  }
}

// ── Source 3: Medium tag feeds ─────────────────────────────────────────────────
// Medium exposes RSS at medium.com/feed/tag/{tag}.
// We derive tags from the query keywords + a curated AI/tech tag list.
const MEDIUM_AI_TAGS = [
  'artificial-intelligence', 'machine-learning', 'deep-learning',
  'startup', 'technology', 'data-science', 'nlp',
];

function deriveMediumTags(query: string): string[] {
  const words = query.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2);

  const queryTags = words.map(w => w.replace(/\s+/g, '-'));
  const combined = [...new Set([...queryTags, ...MEDIUM_AI_TAGS])];
  return combined.slice(0, 8);
}

async function queryMedium(query: string): Promise<DiscoveredPublication[]> {
  const tags = deriveMediumTags(query);
  return tags.map(tag => ({
    name:          `Medium — ${tag.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}`,
    url:           `https://medium.com/tag/${tag}`,
    feedUrl:       `https://medium.com/feed/tag/${tag}`,
    description:   `Medium articles tagged "${tag.replace(/-/g, ' ')}"`,
    source:        'medium' as const,
    suggestedTier: 'B' as const,
    focus:         tag.replace(/-/g, ' '),
  }));
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function discoverPublications(
  query: string,
  existingDomains: Set<string>,
): Promise<DiscoveredPublication[]> {
  const [feedly, substack, medium] = await Promise.allSettled([
    queryFeedly(query),
    querySubstack(query),
    queryMedium(query),
  ]);

  const all: DiscoveredPublication[] = [
    ...(feedly.status  === 'fulfilled' ? feedly.value  : []),
    ...(substack.status === 'fulfilled' ? substack.value : []),
    ...(medium.status  === 'fulfilled' ? medium.value  : []),
  ];

  // Deduplicate by domain, filter already-tracked
  const seen = new Set<string>();
  return all.filter(p => {
    const domain = extractDomain(p.url);
    if (existingDomains.has(domain)) return false;
    if (seen.has(domain)) return false;
    seen.add(domain);
    return true;
  });
}
