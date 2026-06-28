import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DATA_DIR = path.join(__dirname, '../../data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'northstar.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS publications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    url TEXT,
    tier TEXT DEFAULT 'B',
    focus TEXT,
    notes TEXT DEFAULT '',
    active INTEGER DEFAULT 1,
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS journalist_suggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    publicationId INTEGER,
    publicationName TEXT,
    sourceType TEXT DEFAULT 'rss',
    recentArticleTitle TEXT,
    recentArticleUrl TEXT,
    recentArticleDate TEXT,
    suggestedBeat TEXT,
    status TEXT DEFAULT 'pending',
    createdAt TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS publication_feeds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    publicationId INTEGER NOT NULL,
    feedUrl TEXT NOT NULL,
    feedLabel TEXT DEFAULT 'Main',
    feedType TEXT DEFAULT 'main',
    rssStatus TEXT DEFAULT 'unknown',
    rssLastChecked TEXT DEFAULT '',
    discoveredAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (publicationId) REFERENCES publications(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS publication_suggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    url TEXT,
    tier TEXT DEFAULT 'B',
    focus TEXT,
    reason TEXT,
    status TEXT DEFAULT 'pending',
    createdAt TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS journalists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    publication TEXT,
    roleTitle TEXT,
    beat TEXT,
    location TEXT,
    publicationType TEXT,
    aiRelevanceScore INTEGER DEFAULT 0,
    startupRelevanceScore INTEGER DEFAULT 0,
    northStarFitScore INTEGER DEFAULT 0,
    publicationAuthorityScore INTEGER DEFAULT 0,
    audienceReachScore INTEGER DEFAULT 0,
    contactabilityScore INTEGER DEFAULT 0,
    totalScore INTEGER DEFAULT 0,
    priorityTier INTEGER DEFAULT 4,
    email TEXT,
    contactUrl TEXT,
    linkedinUrl TEXT,
    twitterUrl TEXT,
    personalWebsite TEXT,
    muckRackUrl TEXT,
    bestPitchAngle TEXT,
    notes TEXT,
    outreachStatus TEXT DEFAULT 'Not Started',
    lastContactedDate TEXT,
    nextFollowUpDate TEXT,
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    journalistId INTEGER NOT NULL,
    title TEXT NOT NULL,
    url TEXT,
    publication TEXT,
    publishDate TEXT,
    topic TEXT,
    storyType TEXT,
    summary TEXT,
    relevanceToNorthStar TEXT,
    usefulAngle TEXT,
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (journalistId) REFERENCES journalists(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS outreach_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    journalistId INTEGER NOT NULL,
    date TEXT,
    channel TEXT,
    messageType TEXT,
    subjectLine TEXT,
    messageBody TEXT,
    response TEXT,
    status TEXT,
    nextStep TEXT,
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (journalistId) REFERENCES journalists(id) ON DELETE CASCADE
  );
`);

// Migrations: add columns if they don't exist yet (safe on fresh or existing DBs)
const pubCols = (db.prepare("PRAGMA table_info(publications)").all() as any[]).map(c => c.name);
if (!pubCols.includes('notes'))            db.exec("ALTER TABLE publications ADD COLUMN notes TEXT DEFAULT ''");
if (!pubCols.includes('rssUrl'))           db.exec("ALTER TABLE publications ADD COLUMN rssUrl TEXT DEFAULT ''");
if (!pubCols.includes('rssStatus'))        db.exec("ALTER TABLE publications ADD COLUMN rssStatus TEXT DEFAULT 'unknown'");
if (!pubCols.includes('rssLastChecked'))   db.exec("ALTER TABLE publications ADD COLUMN rssLastChecked TEXT DEFAULT ''");
if (!pubCols.includes('healthStatus'))     db.exec("ALTER TABLE publications ADD COLUMN healthStatus TEXT DEFAULT 'unknown'");
if (!pubCols.includes('lastHealthCheck'))  db.exec("ALTER TABLE publications ADD COLUMN lastHealthCheck TEXT DEFAULT ''");
if (!pubCols.includes('isVirtual'))        db.exec("ALTER TABLE publications ADD COLUMN isVirtual INTEGER DEFAULT 0");

// Backfill publication_feeds from existing publications.rssUrl (one-time migration)
{
  const feedCount = (db.prepare('SELECT COUNT(*) as c FROM publication_feeds').get() as any).c;
  if (feedCount === 0) {
    const pubs = db.prepare("SELECT id, name, rssUrl FROM publications WHERE rssUrl IS NOT NULL AND rssUrl != ''").all() as any[];
    const ins = db.prepare(`INSERT OR IGNORE INTO publication_feeds (publicationId, feedUrl, feedLabel, feedType, rssStatus) VALUES (?, ?, 'Main', 'main', 'unknown')`);
    const backfill = db.transaction(() => { for (const p of pubs) ins.run(p.id, p.rssUrl); });
    backfill();
    console.log(`[DB] Backfilled ${pubs.length} feeds into publication_feeds`);
  }
}

// Press coverage tracker
db.exec(`
  CREATE TABLE IF NOT EXISTS coverage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    url TEXT DEFAULT '',
    publication TEXT DEFAULT '',
    publishDate TEXT DEFAULT '',
    journalistId INTEGER,
    journalistName TEXT DEFAULT '',
    coverageType TEXT DEFAULT 'mention',
    sentiment TEXT DEFAULT 'neutral',
    summary TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (journalistId) REFERENCES journalists(id) ON DELETE SET NULL
  );
`);

// Campaigns
db.exec(`
  CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'cold_intro',
    brief TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft',
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS campaign_journalists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaignId INTEGER NOT NULL,
    journalistId INTEGER NOT NULL,
    draftSubject TEXT DEFAULT '',
    draftBody TEXT DEFAULT '',
    draftStatus TEXT NOT NULL DEFAULT 'pending',
    sentAt TEXT DEFAULT '',
    createdAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (campaignId) REFERENCES campaigns(id) ON DELETE CASCADE,
    FOREIGN KEY (journalistId) REFERENCES journalists(id) ON DELETE CASCADE,
    UNIQUE(campaignId, journalistId)
  );
`);

// House style instructions per campaign type
db.exec(`
  CREATE TABLE IF NOT EXISTS campaign_type_styles (
    type TEXT PRIMARY KEY,
    instructions TEXT NOT NULL DEFAULT '',
    updatedAt TEXT DEFAULT (datetime('now'))
  );
`);
// Seed one row per type if not already present
const styleTypes = ['cold_intro', 'event', 'hackathon', 'founder_promo'];
const insertStyle = db.prepare(`INSERT OR IGNORE INTO campaign_type_styles (type, instructions) VALUES (?, '')`);
for (const t of styleTypes) insertStyle.run(t);

// Journalist staleness flag migration
const jCols = (db.prepare("PRAGMA table_info(journalists)").all() as any[]).map(c => c.name);
if (!jCols.includes('staleFlag'))         db.exec("ALTER TABLE journalists ADD COLUMN staleFlag INTEGER DEFAULT 0");
if (!jCols.includes('isFavorite'))        db.exec("ALTER TABLE journalists ADD COLUMN isFavorite INTEGER DEFAULT 0");
if (!jCols.includes('lastArticleDate'))   db.exec("ALTER TABLE journalists ADD COLUMN lastArticleDate TEXT DEFAULT ''");

// Journalist suggestions enrichment migration
const jsCols = (db.prepare("PRAGMA table_info(journalist_suggestions)").all() as any[]).map(c => c.name);
if (!jsCols.includes('relevanceScore'))   db.exec("ALTER TABLE journalist_suggestions ADD COLUMN relevanceScore INTEGER DEFAULT 0");
if (!jsCols.includes('matchedTags'))      db.exec("ALTER TABLE journalist_suggestions ADD COLUMN matchedTags TEXT DEFAULT '[]'");
if (!jsCols.includes('articleCount'))     db.exec("ALTER TABLE journalist_suggestions ADD COLUMN articleCount INTEGER DEFAULT 1");
if (!jsCols.includes('allArticles'))      db.exec("ALTER TABLE journalist_suggestions ADD COLUMN allArticles TEXT DEFAULT '[]'");

// Seed publications if table is empty
const pubCount = (db.prepare('SELECT COUNT(*) as c FROM publications').get() as any).c;
if (pubCount === 0) {
  const insert = db.prepare(`
    INSERT INTO publications (name, url, tier, focus, rssUrl, rssStatus) VALUES (@name, @url, @tier, @focus, @rssUrl, @rssStatus)
  `);
  const seedMany2 = db.transaction((pubs: any[]) => { for (const p of pubs) insert.run(p); });
  seedMany2([
    // Tier A — Major Tech & AI
    { name: 'TechCrunch',            url: 'https://techcrunch.com',               tier: 'A', focus: 'Startups, AI funding rounds',          rssUrl: 'https://techcrunch.com/feed/',                    rssStatus: 'unknown' },
    { name: 'Wired',                 url: 'https://wired.com',                    tier: 'A', focus: 'AI technology, culture, policy',        rssUrl: 'https://www.wired.com/feed/rss',                  rssStatus: 'unknown' },
    { name: 'MIT Technology Review', url: 'https://technologyreview.com',         tier: 'A', focus: 'Deep AI research coverage',             rssUrl: 'https://www.technologyreview.com/feed/',          rssStatus: 'unknown' },
    { name: 'The Verge',             url: 'https://theverge.com',                 tier: 'A', focus: 'Consumer tech, AI products',            rssUrl: 'https://www.theverge.com/rss/index.xml',          rssStatus: 'unknown' },
    { name: 'VentureBeat',           url: 'https://venturebeat.com',              tier: 'A', focus: 'Enterprise AI, ML',                     rssUrl: 'https://venturebeat.com/feed/',                   rssStatus: 'unknown' },
    { name: 'Ars Technica',          url: 'https://arstechnica.com',              tier: 'A', focus: 'Technical AI coverage',                 rssUrl: 'https://feeds.arstechnica.com/arstechnica/index', rssStatus: 'unknown' },
    // Tier B — Business Publications with Tech Desks
    { name: 'Forbes Technology',     url: 'https://forbes.com/technology',        tier: 'B', focus: 'AI business, funding',                  rssUrl: 'https://www.forbes.com/innovation/feed2',         rssStatus: 'unknown' },
    { name: 'Fortune Tech',          url: 'https://fortune.com/tech',             tier: 'B', focus: 'Executive AI coverage',                 rssUrl: 'https://fortune.com/feed',                        rssStatus: 'unknown' },
    { name: 'Fast Company',          url: 'https://fastcompany.com',              tier: 'B', focus: 'AI innovation, future of work',          rssUrl: 'https://www.fastcompany.com/technology/rss',      rssStatus: 'unknown' },
    { name: 'Inc. Magazine',         url: 'https://inc.com/technology',           tier: 'B', focus: 'Startup AI stories',                    rssUrl: 'https://www.inc.com/rss',                         rssStatus: 'unknown' },
    { name: 'Bloomberg Technology',  url: 'https://bloomberg.com/technology',     tier: 'B', focus: 'AI market coverage',                    rssUrl: '',                                                rssStatus: 'none' },
    { name: 'Wall Street Journal Tech', url: 'https://wsj.com/tech',             tier: 'B', focus: 'AI enterprise, policy',                 rssUrl: '',                                                rssStatus: 'none' },
    // Tier C — Regional & Niche
    { name: 'Atlanta Business Chronicle', url: 'https://bizjournals.com/atlanta', tier: 'C', focus: 'Southeast tech ecosystem',              rssUrl: 'https://www.bizjournals.com/atlanta/rssfeed',     rssStatus: 'unknown' },
    { name: 'GeekWire',              url: 'https://geekwire.com',                 tier: 'C', focus: 'Pacific Northwest tech',                rssUrl: 'https://www.geekwire.com/feed/',                  rssStatus: 'unknown' },
    { name: 'Boston Globe Tech',     url: 'https://bostonglobe.com',              tier: 'C', focus: 'New England tech scene',                rssUrl: '',                                                rssStatus: 'unknown' },
    { name: 'Hypepotamus',           url: 'https://hypepotamus.com',              tier: 'C', focus: 'Atlanta/Southeast startup ecosystem',   rssUrl: 'https://hypepotamus.com/feed/',                   rssStatus: 'unknown' },
    { name: 'AJC',                   url: 'https://ajc.com',                      tier: 'C', focus: 'Atlanta general news & tech',           rssUrl: 'https://www.ajc.com/news/technology/?rss=y',      rssStatus: 'unknown' },
  ]);

  // Seed Google News RSS virtual publications (free journalist discovery streams)
  const insertVirtual = db.prepare(`
    INSERT INTO publications (name, url, tier, focus, rssUrl, rssStatus, isVirtual, notes)
    VALUES (@name, @url, @tier, @focus, @rssUrl, @rssStatus, 1, @notes)
  `);
  const seedVirtual = db.transaction((pubs: any[]) => { for (const p of pubs) insertVirtual.run(p); });
  seedVirtual([
    {
      name: 'Google News: AI Startups',
      url: 'https://news.google.com',
      tier: 'A',
      focus: 'AI startup news across all publications',
      rssUrl: 'https://news.google.com/rss/search?q=AI+startup+funding&hl=en-US&gl=US&ceid=US:en',
      rssStatus: 'unknown',
      notes: 'Virtual feed — aggregates AI startup stories from all publications. Read-only; edit rssUrl to change the search query.',
    },
    {
      name: 'Google News: Atlanta Tech',
      url: 'https://news.google.com',
      tier: 'C',
      focus: 'Southeast US / Atlanta tech ecosystem',
      rssUrl: 'https://news.google.com/rss/search?q=Atlanta+tech+startup&hl=en-US&gl=US&ceid=US:en',
      rssStatus: 'unknown',
      notes: 'Virtual feed — aggregates Atlanta/Southeast tech coverage. Read-only; edit rssUrl to change the search query.',
    },
    {
      name: 'Google News: Generative AI',
      url: 'https://news.google.com',
      tier: 'A',
      focus: 'Generative AI, LLMs, foundation models',
      rssUrl: 'https://news.google.com/rss/search?q=generative+AI+LLM&hl=en-US&gl=US&ceid=US:en',
      rssStatus: 'unknown',
      notes: 'Virtual feed — aggregates generative AI coverage across publications. Read-only; edit rssUrl to change the search query.',
    },
  ]);
}

export default db;
