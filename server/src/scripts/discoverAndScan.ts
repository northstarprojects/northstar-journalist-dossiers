/**
 * One-shot script: discover category feeds for all publications, then scan all feeds for journalists.
 * Run from server/ directory with:
 *   node_modules/.bin/ts-node src/scripts/discoverAndScan.ts
 */

import db from '../db';
import { discoverAndSaveFeeds } from '../services/categoryFeedDiscovery';
import { scanAllRssFeeds } from '../services/rssService';

async function main() {
  const pubs = db.prepare(`
    SELECT id, name, url FROM publications
    WHERE active = 1 AND isVirtual = 0 AND url IS NOT NULL AND url != ''
    ORDER BY tier ASC, name ASC
  `).all() as { id: number; name: string; url: string }[];

  console.log(`\n⚡ Discovering category feeds for ${pubs.length} publications...\n`);

  let totalNewFeeds = 0;
  for (const pub of pubs) {
    process.stdout.write(`  ${pub.name}… `);
    try {
      const result = await discoverAndSaveFeeds(pub.id);
      if (result.feedsAdded > 0) {
        const labels = result.feeds.map(f => f.feedLabel).join(', ');
        console.log(`✓ ${result.feedsAdded} new feed(s): ${labels}`);
      } else if (result.error) {
        console.log(`✗ ${result.error}`);
      } else {
        console.log(`— no new feeds found`);
      }
      totalNewFeeds += result.feedsAdded;
    } catch (err: any) {
      console.log(`✗ ${err.message}`);
    }
    // Polite delay between publications
    await new Promise(r => setTimeout(r, 800));
  }

  console.log(`\n  → ${totalNewFeeds} total new category feeds added.\n`);

  // ── Scan all feeds ────────────────────────────────────────────────────────
  console.log(`📡 Scanning all RSS feeds for journalist suggestions...\n`);

  const results = await scanAllRssFeeds();

  const active    = results.filter(r => r.status === 'active').length;
  const inactive  = results.filter(r => r.status === 'inactive').length;
  const total     = results.reduce((s, r) => s + r.newSuggestions, 0);

  for (const r of results) {
    const icon = r.status === 'active' ? '✓' : '✗';
    const label = r.newSuggestions > 0 ? `${r.newSuggestions} new suggestions` : 'no new suggestions';
    console.log(`  ${icon} ${r.publicationName}: ${label}${r.error ? ` (${r.error})` : ''}`);
  }

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Done.
   Feeds scanned : ${active} active, ${inactive} inactive
   New journalist suggestions : ${total}
   View them at: http://localhost:5173/admin/journalist-suggestions
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

  process.exit(0);
}

main().catch(err => {
  console.error('\n❌ Script failed:', err);
  process.exit(1);
});
