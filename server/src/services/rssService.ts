import Parser from 'rss-parser';
import db from '../db';

const parser = new Parser({
  timeout: 10000,
  customFields: {
    item: [['dc:creator', 'creator'], ['author', 'author']],
  },
});

export interface RssScanResult {
  publicationId: number;
  publicationName: string;
  newSuggestions: number;
  status: 'active' | 'inactive' | 'none';
  error?: string;
}

// ─── Relevance tag sets ────────────────────────────────────────────────────────

// Article category tags that are strong positive signals
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

// Category tags that are strong negative signals (consumer/lifestyle content)
const NOISE_TAGS = new Set([
  'deals', 'prime day', 'sales', 'coupons', 'discount',
  'gaming', 'games', 'game', 'esports', 'xbox', 'playstation', 'nintendo',
  'entertainment', 'movies', 'tv', 'streaming', 'music', 'celebrity',
  'sports', 'food', 'travel', 'fashion', 'beauty', 'health', 'fitness',
  'cars', 'automotive', 'real estate',
]);

// Title keyword patterns — used when categories are absent
const AI_TITLE_RE = /\b(ai|artificial intelligence|machine learning|llm|llms|gpt|generative ai|openai|anthropic|claude|chatgpt|neural|deep learning|language model|foundation model|diffusion|transformer)\b/i;
const STARTUP_TITLE_RE = /\b(startup|startups|funding|raises|raised|series [abc]|seed round|venture|vc-backed|valuation|ipo|spac)\b/i;
const ENTERPRISE_TITLE_RE = /\b(enterprise|saas|b2b|cloud|api|platform|software|developer|devops|kubernetes|data center)\b/i;
const NOISE_TITLE_RE = /\b(deal|deals|prime day|sale|discount|gaming|game|movie|tv show|stream|music|sports|recipe|travel|fashion|beauty)\b/i;

// ─── Scoring ──────────────────────────────────────────────────────────────────

interface ArticleData {
  title: string;
  url: string;
  date: string;
  categories: string[];
}

interface ArticleScore {
  points: number;
  matchedTags: string[];
}

function scoreArticle(article: ArticleData): ArticleScore {
  const cats = (article.categories || []).map(c => c.toLowerCase().trim());
  const hasCategories = cats.length > 0;
  let points = 0;
  const matchedTags: string[] = [];

  // ── Category tag scoring (high confidence) ──
  for (const cat of cats) {
    if (AI_TAGS.has(cat)) {
      points += 3;
      matchedTags.push(cat);
    } else if (STARTUP_TAGS.has(cat)) {
      points += 3;
      matchedTags.push(cat);
    } else if (NOISE_TAGS.has(cat)) {
      points -= 2;
    }
  }

  // ── Title keyword scoring ──
  // Apply title scoring always; weight more heavily when no categories available
  const titleWeight = hasCategories ? 1 : 1.5;

  if (AI_TITLE_RE.test(article.title)) {
    points += Math.round(2 * titleWeight);
    if (!matchedTags.some(t => AI_TAGS.has(t))) matchedTags.push('AI (title)');
  }
  if (STARTUP_TITLE_RE.test(article.title)) {
    points += Math.round(2 * titleWeight);
    if (!matchedTags.some(t => STARTUP_TAGS.has(t))) matchedTags.push('Startups (title)');
  }
  if (ENTERPRISE_TITLE_RE.test(article.title)) {
    points += Math.round(1 * titleWeight);
  }
  if (NOISE_TITLE_RE.test(article.title)) {
    points -= 2;
  }

  return { points, matchedTags: [...new Set(matchedTags)] };
}

interface AuthorRelevance {
  relevanceScore: number;     // 0–10
  matchedTags: string[];      // unique tags that matched across all articles
  bestArticle: ArticleData;   // highest-scoring article to display
  articleCount: number;       // total articles found for this author
}

function scoreAuthor(articles: ArticleData[]): AuthorRelevance {
  let totalPoints = 0;
  const allMatchedTags = new Set<string>();
  let bestScore = -Infinity;
  let bestArticle = articles[0];

  for (const article of articles) {
    const { points, matchedTags } = scoreArticle(article);
    totalPoints += points;
    matchedTags.forEach(t => allMatchedTags.add(t));
    if (points > bestScore) {
      bestScore = points;
      bestArticle = article;
    }
  }

  // Normalise to 0–10
  const relevanceScore = Math.min(10, Math.max(0, totalPoints));

  return {
    relevanceScore,
    matchedTags: [...allMatchedTags].filter(t => !t.startsWith('AI (') && !t.startsWith('Startups (')).concat(
      [...allMatchedTags].filter(t => t.startsWith('AI (') || t.startsWith('Startups ('))
    ),
    bestArticle,
    articleCount: articles.length,
  };
}

// ─── Beat inference ───────────────────────────────────────────────────────────

function inferBeat(matchedTags: string[], categories: string[], title: string): string {
  // Use matched tags first (most reliable)
  const allText = [...matchedTags, ...categories, title].join(' ').toLowerCase();

  if (/\b(ai|artificial intelligence|machine learning|llm|generative|language model|neural|deep learning|ai agents?)\b/.test(allText))
    return 'AI / Machine Learning';
  if (/\b(startup|funding|series [abc]|venture|seed|raises?)\b/.test(allText))
    return 'Startups / Funding';
  if (/\b(policy|regulation|congress|government|law|privacy)\b/.test(allText))
    return 'Tech Policy';
  if (/\b(cybersecurity|security|hack|breach)\b/.test(allText))
    return 'Cybersecurity';
  if (/\b(crypto|blockchain|web3|bitcoin)\b/.test(allText))
    return 'Crypto / Web3';
  if (/\b(enterprise|saas|b2b|cloud|devops)\b/.test(allText))
    return 'Enterprise Tech';
  return 'Technology';
}

// ─── Author extraction ────────────────────────────────────────────────────────

function extractAuthor(item: any): string | null {
  const raw =
    item.creator ||
    item.author ||
    item['dc:creator'] ||
    (item.itunes && item.itunes.author) ||
    null;
  if (!raw || typeof raw !== 'string') return null;

  // Strip email addresses (e.g. "author@gmail.com (Ben Dickson)" → "Ben Dickson")
  let name = raw
    .replace(/^[^\s(]+@[^\s(]+\s*/, '')  // leading email
    .replace(/<[^>]+>/g, '')              // <email@...>
    .replace(/\(([^)]+)\)/, '$1')         // (Name) wrapper
    .trim();

  if (!name || name.length < 3) return null;
  if (/^(admin|staff|editor|webmaster|noreply|newsroom|the \w+)$/i.test(name)) return null;
  // Filter out student bylines like "Jane Smith '25" or "Jane Smith '28"
  if (/'\d{2}$/.test(name)) return null;
  // Must look like a person name: 2–4 words, reasonable characters
  if (!/^[A-Z][a-zA-Z'\-]+(?: [A-Z][a-zA-Z'\-\.]+){1,3}$/.test(name)) return null;

  return name;
}

// ─── Main scan ────────────────────────────────────────────────────────────────

// ─── Per-feed scan helper ─────────────────────────────────────────────────────

async function scanFeedUrl(
  feedUrl: string,
  feedId: number,
): Promise<{ items: any[]; error?: string }> {
  try {
    const feed = await parser.parseURL(feedUrl);
    db.prepare("UPDATE publication_feeds SET rssStatus='active', rssLastChecked=datetime('now') WHERE id=?").run(feedId);
    return { items: feed.items ?? [] };
  } catch (err: any) {
    db.prepare("UPDATE publication_feeds SET rssStatus='inactive', rssLastChecked=datetime('now') WHERE id=?").run(feedId);
    return { items: [], error: err.message };
  }
}

export async function scanPublicationRss(publicationId: number): Promise<RssScanResult> {
  const pub = db.prepare('SELECT * FROM publications WHERE id = ?').get(publicationId) as any;
  if (!pub) throw new Error(`Publication ${publicationId} not found`);

  // Get all feeds for this publication from publication_feeds
  const feeds = db.prepare(
    "SELECT * FROM publication_feeds WHERE publicationId = ?"
  ).all(publicationId) as any[];

  // Fall back to publications.rssUrl if table is empty (e.g. fresh publication just added)
  if (feeds.length === 0 && pub.rssUrl) {
    db.prepare(`INSERT OR IGNORE INTO publication_feeds (publicationId, feedUrl, feedLabel, feedType) VALUES (?, ?, 'Main', 'main')`).run(publicationId, pub.rssUrl);
    feeds.push({ id: db.prepare('SELECT last_insert_rowid() as id').get() as any, feedUrl: pub.rssUrl });
  }

  if (feeds.length === 0) {
    db.prepare("UPDATE publications SET rssStatus='none', rssLastChecked=datetime('now') WHERE id=?").run(publicationId);
    return { publicationId, publicationName: pub.name, newSuggestions: 0, status: 'none' };
  }

  // Collect all items across all feeds, track which feed they came from
  const allItems: any[] = [];
  let anyActive = false;

  for (const feed of feeds) {
    const { items, error } = await scanFeedUrl(feed.feedUrl, feed.id);
    if (!error) anyActive = true;
    allItems.push(...items);
    if (feeds.length > 1) await new Promise(r => setTimeout(r, 300)); // polite delay
  }

  // Update publication-level rssStatus
  const pubStatus = anyActive ? 'active' : 'inactive';
  db.prepare("UPDATE publications SET rssStatus=?, rssLastChecked=datetime('now') WHERE id=?").run(pubStatus, publicationId);

  if (!anyActive) {
    return { publicationId, publicationName: pub.name, newSuggestions: 0, status: 'inactive' };
  }

  try {

    // Existing journalist names for this publication
    const existingNames = new Set(
      (db.prepare("SELECT LOWER(name) as n FROM journalists WHERE LOWER(publication)=LOWER(?)").all(pub.name) as any[])
        .map((j: any) => j.n)
    );
    // Already-pending suggestions
    const pendingNames = new Set(
      (db.prepare("SELECT LOWER(name) as n FROM journalist_suggestions WHERE publicationId=? AND status='pending'").all(publicationId) as any[])
        .map((j: any) => j.n)
    );
    // Recently rejected (30-day cooldown)
    const rejectedNames = new Set(
      (db.prepare("SELECT LOWER(name) as n FROM journalist_suggestions WHERE publicationId=? AND status='rejected' AND createdAt >= datetime('now','-30 days')").all(publicationId) as any[])
        .map((j: any) => j.n)
    );

    // Collect up to 10 articles per author from the last 90 days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);

    const authorArticles = new Map<string, ArticleData[]>();

    for (const item of allItems) {
      const author = extractAuthor(item);
      if (!author) continue;

      const pubDate = item.pubDate ? new Date(item.pubDate) : null;
      if (pubDate && pubDate < cutoff) continue;

      const articles = authorArticles.get(author) || [];
      if (articles.length >= 10) continue; // cap at 10 per author

      articles.push({
        title: item.title || '',
        url: item.link || item.guid || '',
        date: item.pubDate || '',
        categories: Array.isArray(item.categories) ? item.categories : [],
      });
      authorArticles.set(author, articles);
    }

    const insertStmt = db.prepare(`
      INSERT INTO journalist_suggestions
        (name, publicationId, publicationName, sourceType,
         recentArticleTitle, recentArticleUrl, recentArticleDate,
         suggestedBeat, relevanceScore, matchedTags, articleCount, allArticles, status)
      VALUES
        (@name, @publicationId, @publicationName, 'rss',
         @recentArticleTitle, @recentArticleUrl, @recentArticleDate,
         @suggestedBeat, @relevanceScore, @matchedTags, @articleCount, @allArticles, 'pending')
    `);

    let added = 0;

    for (const [author, articles] of authorArticles) {
      const key = author.toLowerCase();
      if (existingNames.has(key) || pendingNames.has(key) || rejectedNames.has(key)) continue;

      const { relevanceScore, matchedTags, bestArticle, articleCount } = scoreAuthor(articles);
      const beat = inferBeat(matchedTags, bestArticle.categories, bestArticle.title);

      insertStmt.run({
        name: author,
        publicationId,
        publicationName: pub.name,
        recentArticleTitle: bestArticle.title,
        recentArticleUrl: bestArticle.url,
        recentArticleDate: bestArticle.date,
        suggestedBeat: beat,
        relevanceScore,
        matchedTags: JSON.stringify(matchedTags),
        articleCount,
        allArticles: JSON.stringify(articles),  // store all articles for seeding on accept
      });
      added++;
    }

    console.log(`[RSS] ${pub.name}: ${authorArticles.size} authors, ${added} new suggestions (${feeds.length} feed${feeds.length !== 1 ? 's' : ''})`);
    return { publicationId, publicationName: pub.name, newSuggestions: added, status: 'active' };

  } catch (err: any) {
    console.error(`[RSS] ${pub.name} processing failed:`, err.message);
    return { publicationId, publicationName: pub.name, newSuggestions: 0, status: 'inactive', error: err.message };
  }
}

export async function scanAllRssFeeds(): Promise<RssScanResult[]> {
  // Get all publications that have at least one feed in publication_feeds
  const pubs = db.prepare(`
    SELECT DISTINCT p.id FROM publications p
    INNER JOIN publication_feeds pf ON pf.publicationId = p.id
    WHERE p.active = 1
  `).all() as { id: number }[];

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
