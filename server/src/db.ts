import { Pool } from 'pg';

const isProduction = process.env.NODE_ENV === 'production';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// ── Schema initialisation ────────────────────────────────────────────────────

export async function initDb(): Promise<void> {
  const client = await pool.connect();
  try {
    // ── Core tables ──────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS publications (
        id               SERIAL PRIMARY KEY,
        name             TEXT NOT NULL,
        url              TEXT DEFAULT '',
        tier             TEXT DEFAULT 'B',
        focus            TEXT DEFAULT '',
        notes            TEXT DEFAULT '',
        active           INTEGER DEFAULT 1,
        rssUrl           TEXT DEFAULT '',
        rssStatus        TEXT DEFAULT 'unknown',
        rssStatusNote    TEXT DEFAULT '',
        rssLastChecked   TEXT DEFAULT '',
        healthStatus     TEXT DEFAULT 'unknown',
        lastHealthCheck  TEXT DEFAULT '',
        isVirtual        INTEGER DEFAULT 0,
        createdAt        TIMESTAMPTZ DEFAULT NOW(),
        updatedAt        TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS journalists (
        id                        SERIAL PRIMARY KEY,
        name                      TEXT NOT NULL,
        publication               TEXT DEFAULT '',
        roleTitle                 TEXT DEFAULT '',
        beat                      TEXT DEFAULT '',
        location                  TEXT DEFAULT '',
        publicationType           TEXT DEFAULT '',
        aiRelevanceScore          INTEGER DEFAULT 0,
        startupRelevanceScore     INTEGER DEFAULT 0,
        northStarFitScore         INTEGER DEFAULT 0,
        publicationAuthorityScore INTEGER DEFAULT 0,
        audienceReachScore        INTEGER DEFAULT 0,
        contactabilityScore       INTEGER DEFAULT 0,
        totalScore                INTEGER DEFAULT 0,
        priorityTier              INTEGER DEFAULT 4,
        email                     TEXT DEFAULT '',
        contactUrl                TEXT DEFAULT '',
        linkedinUrl               TEXT DEFAULT '',
        twitterUrl                TEXT DEFAULT '',
        personalWebsite           TEXT DEFAULT '',
        muckRackUrl               TEXT DEFAULT '',
        bestPitchAngle            TEXT DEFAULT '',
        notes                     TEXT DEFAULT '',
        outreachStatus            TEXT DEFAULT 'Not Started',
        lastContactedDate         TEXT DEFAULT '',
        nextFollowUpDate          TEXT DEFAULT '',
        staleFlag                 INTEGER DEFAULT 0,
        isFavorite                INTEGER DEFAULT 0,
        lastArticleDate           TEXT DEFAULT '',
        createdAt                 TIMESTAMPTZ DEFAULT NOW(),
        updatedAt                 TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS articles (
        id                    SERIAL PRIMARY KEY,
        "journalistId"        INTEGER NOT NULL REFERENCES journalists(id) ON DELETE CASCADE,
        title                 TEXT NOT NULL,
        url                   TEXT DEFAULT '',
        publication           TEXT DEFAULT '',
        "publishDate"         TEXT DEFAULT '',
        topic                 TEXT DEFAULT '',
        "storyType"           TEXT DEFAULT '',
        summary               TEXT DEFAULT '',
        "relevanceToNorthStar" TEXT DEFAULT '',
        "usefulAngle"         TEXT DEFAULT '',
        "createdAt"           TIMESTAMPTZ DEFAULT NOW(),
        "updatedAt"           TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE("journalistId", url)
      );

      CREATE TABLE IF NOT EXISTS outreach_logs (
        id             SERIAL PRIMARY KEY,
        "journalistId" INTEGER NOT NULL REFERENCES journalists(id) ON DELETE CASCADE,
        date           TEXT DEFAULT '',
        channel        TEXT DEFAULT '',
        "messageType"  TEXT DEFAULT '',
        "subjectLine"  TEXT DEFAULT '',
        "messageBody"  TEXT DEFAULT '',
        response       TEXT DEFAULT '',
        status         TEXT DEFAULT '',
        "nextStep"     TEXT DEFAULT '',
        "createdAt"    TIMESTAMPTZ DEFAULT NOW(),
        "updatedAt"    TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS publication_feeds (
        id               SERIAL PRIMARY KEY,
        "publicationId"  INTEGER NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
        "feedUrl"        TEXT NOT NULL,
        "feedLabel"      TEXT DEFAULT 'Main',
        "feedType"       TEXT DEFAULT 'main',
        "rssStatus"      TEXT DEFAULT 'unknown',
        "rssLastChecked" TEXT DEFAULT '',
        "discoveredAt"   TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE("publicationId", "feedUrl")
      );

      CREATE TABLE IF NOT EXISTS publication_suggestions (
        id        SERIAL PRIMARY KEY,
        name      TEXT NOT NULL,
        url       TEXT DEFAULT '',
        tier      TEXT DEFAULT 'B',
        focus     TEXT DEFAULT '',
        reason    TEXT DEFAULT '',
        status    TEXT DEFAULT 'pending',
        "createdAt" TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS journalist_suggestions (
        id                   SERIAL PRIMARY KEY,
        name                 TEXT NOT NULL,
        "publicationId"      INTEGER,
        "publicationName"    TEXT DEFAULT '',
        "sourceType"         TEXT DEFAULT 'rss',
        "recentArticleTitle" TEXT DEFAULT '',
        "recentArticleUrl"   TEXT DEFAULT '',
        "recentArticleDate"  TEXT DEFAULT '',
        "suggestedBeat"      TEXT DEFAULT '',
        "relevanceScore"     INTEGER DEFAULT 0,
        "matchedTags"        TEXT DEFAULT '[]',
        "articleCount"       INTEGER DEFAULT 1,
        "allArticles"        TEXT DEFAULT '[]',
        status               TEXT DEFAULT 'pending',
        "createdAt"          TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS coverage (
        id              SERIAL PRIMARY KEY,
        title           TEXT NOT NULL,
        url             TEXT DEFAULT '',
        publication     TEXT DEFAULT '',
        "publishDate"   TEXT DEFAULT '',
        "journalistId"  INTEGER REFERENCES journalists(id) ON DELETE SET NULL,
        "journalistName" TEXT DEFAULT '',
        "coverageType"  TEXT DEFAULT 'mention',
        sentiment       TEXT DEFAULT 'neutral',
        summary         TEXT DEFAULT '',
        notes           TEXT DEFAULT '',
        "createdAt"     TIMESTAMPTZ DEFAULT NOW(),
        "updatedAt"     TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS campaigns (
        id          SERIAL PRIMARY KEY,
        name        TEXT NOT NULL,
        type        TEXT NOT NULL DEFAULT 'cold_intro',
        brief       TEXT NOT NULL DEFAULT '',
        status      TEXT NOT NULL DEFAULT 'draft',
        "createdAt" TIMESTAMPTZ DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS campaign_journalists (
        id              SERIAL PRIMARY KEY,
        "campaignId"    INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        "journalistId"  INTEGER NOT NULL REFERENCES journalists(id) ON DELETE CASCADE,
        "draftSubject"  TEXT DEFAULT '',
        "draftBody"     TEXT DEFAULT '',
        "draftStatus"   TEXT NOT NULL DEFAULT 'pending',
        "sentAt"        TEXT DEFAULT '',
        "createdAt"     TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE("campaignId", "journalistId")
      );

      CREATE TABLE IF NOT EXISTS campaign_type_styles (
        type         TEXT PRIMARY KEY,
        instructions TEXT NOT NULL DEFAULT '',
        "updatedAt"  TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // ── Column migrations (safe to run repeatedly) ───────────────────────────
    await client.query(`
      ALTER TABLE publications ADD COLUMN IF NOT EXISTS "rssUrl"           TEXT DEFAULT '';
      ALTER TABLE publications ADD COLUMN IF NOT EXISTS "rssStatus"        TEXT DEFAULT 'unknown';
      ALTER TABLE publications ADD COLUMN IF NOT EXISTS "rssStatusNote"    TEXT DEFAULT '';
      ALTER TABLE publications ADD COLUMN IF NOT EXISTS "rssLastChecked"   TEXT DEFAULT '';
      ALTER TABLE publications ADD COLUMN IF NOT EXISTS "healthStatus"     TEXT DEFAULT 'unknown';
      ALTER TABLE publications ADD COLUMN IF NOT EXISTS "lastHealthCheck"  TEXT DEFAULT '';
      ALTER TABLE publications ADD COLUMN IF NOT EXISTS "isVirtual"        INTEGER DEFAULT 0;
      ALTER TABLE publications ADD COLUMN IF NOT EXISTS "createdAt"        TIMESTAMPTZ DEFAULT NOW();
      ALTER TABLE publications ADD COLUMN IF NOT EXISTS "updatedAt"        TIMESTAMPTZ DEFAULT NOW();

      ALTER TABLE journalists ADD COLUMN IF NOT EXISTS "roleTitle"                 TEXT DEFAULT '';
      ALTER TABLE journalists ADD COLUMN IF NOT EXISTS beat                       TEXT DEFAULT '';
      ALTER TABLE journalists ADD COLUMN IF NOT EXISTS location                   TEXT DEFAULT '';
      ALTER TABLE journalists ADD COLUMN IF NOT EXISTS "publicationType"          TEXT DEFAULT '';
      ALTER TABLE journalists ADD COLUMN IF NOT EXISTS "aiRelevanceScore"         INTEGER DEFAULT 0;
      ALTER TABLE journalists ADD COLUMN IF NOT EXISTS "startupRelevanceScore"    INTEGER DEFAULT 0;
      ALTER TABLE journalists ADD COLUMN IF NOT EXISTS "northStarFitScore"        INTEGER DEFAULT 0;
      ALTER TABLE journalists ADD COLUMN IF NOT EXISTS "publicationAuthorityScore" INTEGER DEFAULT 0;
      ALTER TABLE journalists ADD COLUMN IF NOT EXISTS "audienceReachScore"       INTEGER DEFAULT 0;
      ALTER TABLE journalists ADD COLUMN IF NOT EXISTS "contactabilityScore"      INTEGER DEFAULT 0;
      ALTER TABLE journalists ADD COLUMN IF NOT EXISTS "totalScore"               INTEGER DEFAULT 0;
      ALTER TABLE journalists ADD COLUMN IF NOT EXISTS "priorityTier"             INTEGER DEFAULT 4;
      ALTER TABLE journalists ADD COLUMN IF NOT EXISTS email                      TEXT DEFAULT '';
      ALTER TABLE journalists ADD COLUMN IF NOT EXISTS "contactUrl"               TEXT DEFAULT '';
      ALTER TABLE journalists ADD COLUMN IF NOT EXISTS "linkedinUrl"              TEXT DEFAULT '';
      ALTER TABLE journalists ADD COLUMN IF NOT EXISTS "twitterUrl"               TEXT DEFAULT '';
      ALTER TABLE journalists ADD COLUMN IF NOT EXISTS "personalWebsite"          TEXT DEFAULT '';
      ALTER TABLE journalists ADD COLUMN IF NOT EXISTS "muckRackUrl"              TEXT DEFAULT '';
      ALTER TABLE journalists ADD COLUMN IF NOT EXISTS "bestPitchAngle"           TEXT DEFAULT '';
      ALTER TABLE journalists ADD COLUMN IF NOT EXISTS notes                      TEXT DEFAULT '';
      ALTER TABLE journalists ADD COLUMN IF NOT EXISTS "outreachStatus"           TEXT DEFAULT 'Not Started';
      ALTER TABLE journalists ADD COLUMN IF NOT EXISTS "lastContactedDate"        TEXT DEFAULT '';
      ALTER TABLE journalists ADD COLUMN IF NOT EXISTS "nextFollowUpDate"         TEXT DEFAULT '';
      ALTER TABLE journalists ADD COLUMN IF NOT EXISTS "staleFlag"                INTEGER DEFAULT 0;
      ALTER TABLE journalists ADD COLUMN IF NOT EXISTS "isFavorite"               INTEGER DEFAULT 0;
      ALTER TABLE journalists ADD COLUMN IF NOT EXISTS "lastArticleDate"          TEXT DEFAULT '';
      ALTER TABLE journalists ADD COLUMN IF NOT EXISTS "createdAt"                TIMESTAMPTZ DEFAULT NOW();
      ALTER TABLE journalists ADD COLUMN IF NOT EXISTS "updatedAt"                TIMESTAMPTZ DEFAULT NOW();

      ALTER TABLE campaign_journalists ADD COLUMN IF NOT EXISTS "sentAt"   TEXT DEFAULT '';
    `);

    // ── One-time data migrations ──────────────────────────────────────────────
    // 2026-06-30: RSS-accepted journalists were incorrectly defaulted to
    // 'Researching'. Reset to 'Not Started' so the pipeline reflects reality.
    await client.query(`
      UPDATE journalists SET "outreachStatus" = 'Not Started'
      WHERE "outreachStatus" = 'Researching'
        AND notes ILIKE '%Discovered via RSS%'
        AND "lastContactedDate" = ''
    `);

    // Seed campaign type styles
    await client.query(`
      INSERT INTO campaign_type_styles (type, instructions)
      VALUES ('cold_intro', ''), ('event', ''), ('hackathon', ''), ('founder_promo', '')
      ON CONFLICT (type) DO NOTHING;
    `);

    // Seed publications if empty
    const { rows: [{ count }] } = await client.query('SELECT COUNT(*)::int as count FROM publications');
    if (count === 0) {
      await client.query(`
        INSERT INTO publications (name, url, tier, focus, "rssUrl", "rssStatus") VALUES
          ('TechCrunch',               'https://techcrunch.com',              'A', 'Startups, AI funding rounds',          'https://techcrunch.com/feed/',                    'unknown'),
          ('Wired',                    'https://wired.com',                   'A', 'AI technology, culture, policy',        'https://www.wired.com/feed/rss',                  'unknown'),
          ('MIT Technology Review',    'https://technologyreview.com',        'A', 'Deep AI research coverage',             'https://www.technologyreview.com/feed/',           'unknown'),
          ('The Verge',                'https://theverge.com',                'A', 'Consumer tech, AI products',            'https://www.theverge.com/rss/index.xml',          'unknown'),
          ('VentureBeat',              'https://venturebeat.com',             'A', 'Enterprise AI, ML',                     'https://venturebeat.com/feed/',                   'unknown'),
          ('Ars Technica',             'https://arstechnica.com',             'A', 'Technical AI coverage',                 'https://feeds.arstechnica.com/arstechnica/index', 'unknown'),
          ('Forbes Technology',        'https://forbes.com/technology',       'B', 'AI business, funding',                  'https://www.forbes.com/innovation/feed2',          'unknown'),
          ('Fortune Tech',             'https://fortune.com/tech',            'B', 'Executive AI coverage',                 'https://fortune.com/feed',                        'unknown'),
          ('Fast Company',             'https://fastcompany.com',             'B', 'AI innovation, future of work',          'https://www.fastcompany.com/technology/rss',      'unknown'),
          ('Inc. Magazine',            'https://inc.com/technology',          'B', 'Startup AI stories',                    'https://www.inc.com/rss',                         'unknown'),
          ('Bloomberg Technology',     'https://bloomberg.com/technology',    'B', 'AI market coverage',                    '',                                                'none'),
          ('Wall Street Journal Tech', 'https://wsj.com/tech',                'B', 'AI enterprise, policy',                 '',                                                'none'),
          ('Atlanta Business Chronicle','https://bizjournals.com/atlanta',    'C', 'Southeast tech ecosystem',              'https://www.bizjournals.com/atlanta/rssfeed',     'unknown'),
          ('GeekWire',                 'https://geekwire.com',                'C', 'Pacific Northwest tech',                'https://www.geekwire.com/feed/',                  'unknown'),
          ('Boston Globe Tech',        'https://bostonglobe.com',             'C', 'New England tech scene',                '',                                                'unknown'),
          ('Hypepotamus',              'https://hypepotamus.com',             'C', 'Atlanta/Southeast startup ecosystem',   'https://hypepotamus.com/feed/',                   'unknown'),
          ('AJC',                      'https://ajc.com',                     'C', 'Atlanta general news & tech',           'https://www.ajc.com/news/technology/?rss=y',      'unknown')
        ON CONFLICT DO NOTHING;
      `);

      // Seed Google News virtual publications
      await client.query(`
        INSERT INTO publications (name, url, tier, focus, "rssUrl", "rssStatus", "isVirtual", notes) VALUES
          ('Google News: AI Startups',   'https://news.google.com', 'A', 'AI startup news across all publications',
           'https://news.google.com/rss/search?q=AI+startup+funding&hl=en-US&gl=US&ceid=US:en', 'unknown', 1,
           'Virtual feed — aggregates AI startup stories from all publications.'),
          ('Google News: Atlanta Tech',  'https://news.google.com', 'C', 'Southeast US / Atlanta tech ecosystem',
           'https://news.google.com/rss/search?q=Atlanta+tech+startup&hl=en-US&gl=US&ceid=US:en', 'unknown', 1,
           'Virtual feed — aggregates Atlanta/Southeast tech coverage.'),
          ('Google News: Generative AI', 'https://news.google.com', 'A', 'Generative AI, LLMs, foundation models',
           'https://news.google.com/rss/search?q=generative+AI+LLM&hl=en-US&gl=US&ceid=US:en', 'unknown', 1,
           'Virtual feed — aggregates generative AI coverage across publications.')
        ON CONFLICT DO NOTHING;
      `);

      // Backfill publication_feeds from publications.rssUrl
      await client.query(`
        INSERT INTO publication_feeds ("publicationId", "feedUrl", "feedLabel", "feedType", "rssStatus")
        SELECT id, "rssUrl", 'Main', 'main', 'unknown'
        FROM publications
        WHERE "rssUrl" IS NOT NULL AND "rssUrl" != ''
        ON CONFLICT DO NOTHING;
      `);

      console.log('[DB] Seeded 20 publications and backfilled feeds');
    }

    console.log('[DB] PostgreSQL schema ready');
  } finally {
    client.release();
  }
}

export default pool;
