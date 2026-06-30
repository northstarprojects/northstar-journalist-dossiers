import Parser from 'rss-parser';
import pool from '../db';
import { generateRssDiagnosticNote } from './rssDiagnostic';

const parser = new Parser({
  timeout: 10000,
  customFields: { item: [['dc:creator', 'creator'], ['author', 'author']] },
});

export interface RssScanResult {
  publicationId: number;
  publicationName: string;
  newSuggestions: number;
  status: 'active' | 'inactive' | 'none';
  error?: string;
}

// ─── Relevance tag sets ────────────────────────────────────────────────────────

const AI_TAGS = new Set([
  'ai', 'artificial intelligence', 'machine learning', 'ml', 'llm', 'llms',
  'generative ai', 'large language model', 'large language models',
  'chatgpt', 'openai', 'anthropic', 'claude', 'gemini', 'gpt',
  'neural network', 'deep learning', 'natural language processing', 'nlp',
  'ai agents', 'ai agent', 'computer vision', 'foundation models',
  'diffusion models', 'transformer', 'rag', 'fine-tuning',
]);
const STARTUP_TAGS = new Set([
  'startups', 'startup', 'funding', 'venture capital', 'vc', 'fundraising',
  'series a', 'series b', 'series c', 'seed round', 'seed funding',
  'enterprise', 'saas', 'b2b', 'enterprise software', 'tech companies',
]);
const NOISE_TAGS = new Set([
  'deals', 'prime day', 'sales', 'coupons', 'discount',
  'gaming', 'games', 'game', 'esports', 'xbox', 'playstation', 'nintendo',
  'entertainment', 'movies', 'tv', 'streaming', 'music', 'celebrity',
  'sports', 'food', 'travel', 'fashion', 'beauty', 'health', 'fitness',
  'cars', 'automotive', 'real estate',
]);
const AI_TITLE_RE = /\b(ai|artificial intelligence|machine learning|llm|llms|gpt|generative ai|openai|anthropic|claude|chatgpt|neural|deep learning|language model|foundation model|diffusion|transformer)\b/i;
const STARTUP_TITLE_RE = /\b(startup|startups|funding|raises|raised|series [abc]|seed round|venture|vc-backed|valuation|ipo|spac)\b/i;
const ENTERPRISE_TITLE_RE = /\b(enterprise|saas|b2b|cloud|api|platform|software|developer|devops|kubernetes|data center)\b/i;
const NOISE_TITLE_RE = /\b(deal|deals|prime day|sale|discount|gaming|game|movie|tv show|stream|music|sports|recipe|travel|fashion|beauty)\b/i;

interface ArticleData { title: string; url: string; date: string; categories: string[] }
interface ArticleScore { points: number; matchedTags: string[] }

function scoreArticle(article: ArticleData): ArticleScore {
  const cats = (article.categories || []).map(c => c.toLowerCase().trim());
  const hasCategories = cats.length > 0;
  let points = 0;
  const matchedTags: string[] = [];
  for (const cat of cats) {
    if (AI_TAGS.has(cat)) { points += 3; matchedTags.push(cat); }
    else if (STARTUP_TAGS.has(cat)) { points += 3; matchedTags.push(cat); }
    else if (NOISE_TAGS.has(cat)) { points -= 2; }
  }
  const titleWeight = hasCategories ? 1 : 1.5;
  if (AI_TITLE_RE.test(article.title)) { points += Math.round(2 * titleWeight); if (!matchedTags.some(t => AI_TAGS.has(t))) matchedTags.push('AI (title)'); }
  if (STARTUP_TITLE_RE.test(article.title)) { points += Math.round(2 * titleWeight); if (!matchedTags.some(t => STARTUP_TAGS.has(t))) matchedTags.push('Startups (title)'); }
  if (ENTERPRISE_TITLE_RE.test(article.title)) { points += Math.round(1 * titleWeight); }
  if (NOISE_TITLE_RE.test(article.title)) { points -= 2; }
  return { points, matchedTags: [...new Set(matchedTags)] };
}

interface AuthorRelevance { relevanceScore: number; matchedTags: string[]; bestArticle: ArticleData; articleCount: number }

function scoreAuthor(articles: ArticleData[]): AuthorRelevance {
  let totalPoints = 0;
  const allMatchedTags = new Set<string>();
  let bestScore = -Infinity;
  let bestArticle = articles[0];
  for (const article of articles) {
    const { points, matchedTags } = scoreArticle(article);
    totalPoints += points;
    matchedTags.forEach(t => allMatchedTags.add(t));
    if (points > bestScore) { bestScore = points; bestArticle = article; }
  }
  return {
    relevanceScore: Math.min(10, Math.max(0, totalPoints)),
    matchedTags: [...allMatchedTags].filter(t => !t.startsWith('AI (') && !t.startsWith('Startups (')).concat(
      [...allMatchedTags].filter(t => t.startsWith('AI (') || t.startsWith('Startups ('))
    ),
    bestArticle,
    articleCount: articles.length,
  };
}

// Infer topic for a single article based on its own title + categories.
// Exported so the accept route can label each article individually.
export function inferArticleTopic(title: string, categories: string[]): string {
  const cats = categories.map(c => c.toLowerCase().trim());
  let aiSignals = 0, startupSignals = 0, enterpriseSignals = 0;

  for (const cat of cats) {
    if (AI_TAGS.has(cat)) aiSignals += 3;
    else if (STARTUP_TAGS.has(cat)) startupSignals += 3;
  }
  if (AI_TITLE_RE.test(title)) aiSignals += 2;
  if (STARTUP_TITLE_RE.test(title)) startupSignals += 2;
  if (ENTERPRISE_TITLE_RE.test(title)) enterpriseSignals += 1;
  // Extra weight for explicit funding/M&A language in titles
  if (/\b(funding|raises?|raised|series [abc]|seed round|m&a|merger|acquisition|ipo|valuation|investors?|venture|vc\b)/i.test(title)) startupSignals += 2;

  if (/\b(policy|regulation|congress|government|law|privacy|antitrust)\b/i.test(title)) return 'Tech Policy';
  if (/\b(cybersecurity|security|hack|breach|ransomware)\b/i.test(title)) return 'Cybersecurity';
  if (/\b(crypto|blockchain|web3|bitcoin|ethereum|defi)\b/i.test(title)) return 'Crypto / Web3';

  if (aiSignals > startupSignals && aiSignals > 0) return 'AI / Machine Learning';
  if (startupSignals > 0) return 'Startups / Venture Capital';
  if (enterpriseSignals > 0) return 'Enterprise Tech';
  return 'Technology';
}

// Infer journalist beat by counting topics across ALL their articles — majority wins.
function inferBeat(articles: ArticleData[]): string {
  const counts: Record<string, number> = {};
  for (const article of articles) {
    const topic = inferArticleTopic(article.title, article.categories || []);
    counts[topic] = (counts[topic] || 0) + 1;
  }
  return Object.entries(counts).sort(([, a], [, b]) => b - a)[0]?.[0] ?? 'Technology';
}

function extractAuthor(item: any): string | null {
  const raw = item.creator || item.author || item['dc:creator'] || (item.itunes && item.itunes.author) || null;
  if (!raw || typeof raw !== 'string') return null;
  let name = raw.replace(/^[^\s(]+@[^\s(]+\s*/, '').replace(/<[^>]+>/g, '').replace(/\(([^)]+)\)/, '$1').trim();
  if (!name || name.length < 3) return null;
  if (/^(admin|staff|editor|webmaster|noreply|newsroom|the \w+)$/i.test(name)) return null;
  if (/'\d{2}$/.test(name)) return null;
  if (!/^[A-Z][a-zA-Z'\-]+(?: [A-Z][a-zA-Z'\-\.]+){1,3}$/.test(name)) return null;
  return name;
}

async function scanFeedUrl(feedUrl: string, feedId: number): Promise<{ items: any[]; error?: string }> {
  try {
    const feed = await parser.parseURL(feedUrl);
    await pool.query("UPDATE publication_feeds SET \"rssStatus\"='active', \"rssLastChecked\"=NOW()::TEXT WHERE id=$1", [feedId]);
    return { items: feed.items ?? [] };
  } catch (err: any) {
    await pool.query("UPDATE publication_feeds SET \"rssStatus\"='inactive', \"rssLastChecked\"=NOW()::TEXT WHERE id=$1", [feedId]);
    return { items: [], error: err.message };
  }
}

export async function scanPublicationRss(publicationId: number): Promise<RssScanResult> {
  const pub = (await pool.query('SELECT * FROM publications WHERE id = $1', [publicationId])).rows[0];
  if (!pub) throw new Error(`Publication ${publicationId} not found`);

  const feeds = (await pool.query(
    'SELECT * FROM publication_feeds WHERE "publicationId" = $1', [publicationId]
  )).rows;

  if (feeds.length === 0 && pub.rssUrl) {
    await pool.query(
      'INSERT INTO publication_feeds ("publicationId", "feedUrl", "feedLabel", "feedType") VALUES ($1,$2,\'Main\',\'main\') ON CONFLICT DO NOTHING',
      [publicationId, pub.rssUrl]
    );
    feeds.push({ id: (await pool.query('SELECT id FROM publication_feeds WHERE "publicationId"=$1 AND "feedUrl"=$2', [publicationId, pub.rssUrl])).rows[0]?.id, feedUrl: pub.rssUrl });
  }

  if (feeds.length === 0) {
    await pool.query(
      `UPDATE publications SET "rssStatus"='none', "rssStatusNote"='No feeds have been added — run auto-discovery or add a feed URL manually', "rssLastChecked"=NOW()::TEXT WHERE id=$1`,
      [publicationId]
    );
    return { publicationId, publicationName: pub.name, newSuggestions: 0, status: 'none' };
  }

  const allItems: any[] = [];
  let anyActive = false;

  for (const feed of feeds) {
    const { items, error } = await scanFeedUrl(feed.feedUrl, feed.id);
    if (!error) anyActive = true;
    allItems.push(...items);
    if (feeds.length > 1) await new Promise(r => setTimeout(r, 300));
  }

  const pubStatus = anyActive ? 'active' : 'inactive';
  const pubNote = anyActive
    ? `${feeds.length} feed${feeds.length !== 1 ? 's' : ''} active and returning articles`
    : `All ${feeds.length} feed${feeds.length !== 1 ? 's' : ''} failed to parse — URLs may be outdated or blocked`;
  await pool.query(
    `UPDATE publications SET "rssStatus"=$1, "rssStatusNote"=$2, "rssLastChecked"=NOW()::TEXT WHERE id=$3`,
    [pubStatus, pubNote, publicationId]
  );

  // If all feeds failed, ask Claude to diagnose why and suggest an action
  if (!anyActive) {
    const failedUrls = feeds.map((f: any) => f.feedUrl);
    generateRssDiagnosticNote(publicationId, pub.name, pub.url, {
      failureType: 'feeds_failed',
      feedUrls: failedUrls,
    }).catch(() => {});
  }

  if (!anyActive) return { publicationId, publicationName: pub.name, newSuggestions: 0, status: 'inactive' };

  try {
    const existingNames = new Set(
      (await pool.query('SELECT LOWER(name) as n FROM journalists WHERE LOWER(publication)=LOWER($1)', [pub.name])).rows.map((j: any) => j.n)
    );
    const pendingNames = new Set(
      (await pool.query("SELECT LOWER(name) as n FROM journalist_suggestions WHERE \"publicationId\"=$1 AND status='pending'", [publicationId])).rows.map((j: any) => j.n)
    );
    const rejectedNames = new Set(
      (await pool.query("SELECT LOWER(name) as n FROM journalist_suggestions WHERE \"publicationId\"=$1 AND status='rejected' AND \"createdAt\" >= NOW() - INTERVAL '30 days'", [publicationId])).rows.map((j: any) => j.n)
    );

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const authorArticles = new Map<string, ArticleData[]>();

    for (const item of allItems) {
      const author = extractAuthor(item);
      if (!author) continue;
      const pubDate = item.pubDate ? new Date(item.pubDate) : null;
      if (pubDate && pubDate < cutoff) continue;
      const articles = authorArticles.get(author) || [];
      if (articles.length >= 10) continue;
      articles.push({
        title: item.title || '',
        url: item.link || item.guid || '',
        date: item.pubDate || '',
        categories: Array.isArray(item.categories) ? item.categories : [],
      });
      authorArticles.set(author, articles);
    }

    let added = 0;
    for (const [author, articles] of authorArticles) {
      const key = author.toLowerCase();
      if (existingNames.has(key) || pendingNames.has(key) || rejectedNames.has(key)) continue;

      const { relevanceScore, matchedTags, bestArticle, articleCount } = scoreAuthor(articles);
      const beat = inferBeat(articles);

      await pool.query(`
        INSERT INTO journalist_suggestions
          (name, "publicationId", "publicationName", "sourceType",
           "recentArticleTitle", "recentArticleUrl", "recentArticleDate",
           "suggestedBeat", "relevanceScore", "matchedTags", "articleCount", "allArticles", status)
        VALUES ($1,$2,$3,'rss',$4,$5,$6,$7,$8,$9,$10,$11,'pending')
      `, [
        author, publicationId, pub.name,
        bestArticle.title, bestArticle.url, bestArticle.date,
        beat, relevanceScore, JSON.stringify(matchedTags), articleCount, JSON.stringify(articles),
      ]);
      added++;
    }

    console.log(`[RSS] ${pub.name}: ${authorArticles.size} authors, ${added} new suggestions`);
    return { publicationId, publicationName: pub.name, newSuggestions: added, status: 'active' };
  } catch (err: any) {
    console.error(`[RSS] ${pub.name} processing failed:`, err.message);
    return { publicationId, publicationName: pub.name, newSuggestions: 0, status: 'inactive', error: err.message };
  }
}

export async function scanAllRssFeeds(): Promise<RssScanResult[]> {
  const pubs = (await pool.query(`
    SELECT DISTINCT p.id FROM publications p
    INNER JOIN publication_feeds pf ON pf."publicationId" = p.id
    WHERE p.active = 1
  `)).rows as { id: number }[];

  console.log(`[RSS] Starting scan of ${pubs.length} publications...`);
  const results: RssScanResult[] = [];
  for (const pub of pubs) {
    const result = await scanPublicationRss(pub.id);
    results.push(result);
    await new Promise(r => setTimeout(r, 500));
  }
  const total = results.reduce((s, r) => s + r.newSuggestions, 0);
  console.log(`[RSS] Scan complete. ${total} new suggestions across ${pubs.length} feeds.`);
  return results;
}
