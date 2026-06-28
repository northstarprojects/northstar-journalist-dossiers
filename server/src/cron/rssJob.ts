import cron from 'node-cron';
import { scanAllRssFeeds } from '../services/rssService';

// Run every Wednesday at 7am ET (offset from publication suggestion job on Mondays)
export function startRssCron() {
  cron.schedule('0 7 * * 3', () => {
    console.log('[RssJob] Weekly RSS journalist scan starting...');
    scanAllRssFeeds().catch(err => console.error('[RssJob] Error:', err));
  }, { timezone: 'America/New_York' });

  console.log('[RssJob] Weekly RSS cron scheduled — Wednesdays at 7am ET');
}
