import Parser from 'rss-parser';
import pool from '../db';

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

function inferBeat(matchedTags: string[], categories: string[], title: string): string {
  const allText = [...matchedTags, ...categories, title].join(' ').toLowerCase();
  if (/\b(ai|artificial intelligence|machine learning|llm|generative|language model|neural|deep learning|ai agents?)\b/.test(allText)) return 'AI / Machine Learning';
  if (/\b(startup|funding|series [abc]|venture|seed|raises?)\b/.test(allText)) return 'Startups / Funding';
  if (/\b(policy|regulation|congress|government|law|privacy)\b/.test(allText)) return 'Tech Policy';
  if (/\b(cybersecurity|security|hack|breach)\b/.test(allText)) return 'Cybersecurity';
  if (/\b(crypto|blockchain|web3|bitcoin)\b/.test(allText)) return 'Crypto / Web3';
  if (/\b(enterprise|saas|b2b|cloud|devops)\b/.test(allText)) return 'Enterprise Tech';
  return 'Technology';
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
    await pool.query("UPDATE publications SET \"rssStatus\"='none', \"rssLastChecked\"=NOW()::TEXT WHERE id=$1", [publicationId]);
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
  await pool.query("UPDATE publications SET \"rssStatus\"=$1, \"rssLastChecked\"=NOW()::TEXT WHERE id=$2", [pubStatus, publicationId]);

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
      const beat = inferBeat(matchedTags, bestArticle.categories, bestArticle.title);

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
