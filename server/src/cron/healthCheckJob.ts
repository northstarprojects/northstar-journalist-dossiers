/**
 * healthCheckJob.ts
 * Runs monthly (1st of every month, 6am ET).
 * - Pings each active publication URL (HTTP HEAD) — marks healthy/unreachable
 * - Flags publications whose RSS feed has had no articles in 30+ days
 * - Flags journalist records not updated in 90+ days (sets staleFlag = 1)
 *
 * Results surface as warning chips in the admin UI.
 */

import cron from 'node-cron';
import axios from 'axios';
import db from '../db';

async function checkUrl(url: string): Promise<'healthy' | 'unreachable'> {
  try {
    await axios.head(url, {
      timeout: 8000,
      maxRedirects: 3,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NorthStarHealthBot/1.0)' },
    });
    return 'healthy';
  } catch {
    return 'unreachable';
  }
}

export async function runHealthChecks() {
  console.log('[HealthCheck] Starting publication + journalist health checks…');

  // 1. Publication URL ping
  const pubs = db.prepare("SELECT id, name, url FROM publications WHERE active=1 AND url != '' AND isVirtual != 1").all() as any[];
  for (const pub of pubs) {
    const status = await checkUrl(pub.url);
    db.prepare(`
      UPDATE publications SET healthStatus=@status, lastHealthCheck=datetime('now') WHERE id=@id
    `).run({ status, id: pub.id });
    if (status === 'unreachable') {
      console.warn(`[HealthCheck] ⚠️  "${pub.name}" is unreachable (${pub.url})`);
    }
    await new Promise(r => setTimeout(r, 800)); // polite delay
  }

  // 2. Flag publications with no RSS activity in 30 days
  // If rssLastChecked is more than 30 days ago and rssStatus was active, mark inactive
  db.prepare(`
    UPDATE publications
    SET rssStatus = 'inactive'
    WHERE rssStatus = 'active'
      AND rssLastChecked != ''
      AND rssLastChecked < datetime('now', '-30 days')
  `).run();

  // 3. Flag journalist records not updated in 90 days
  db.prepare(`
    UPDATE journalists SET staleFlag = 1
    WHERE updatedAt < datetime('now', '-90 days')
  `).run();

  // 4. Clear stale flag for recently updated journalists
  db.prepare(`
    UPDATE journalists SET staleFlag = 0
    WHERE updatedAt >= datetime('now', '-90 days')
  `).run();

  const staleCount = (db.prepare("SELECT COUNT(*) as c FROM journalists WHERE staleFlag=1").get() as any).c;
  const unreachableCount = (db.prepare("SELECT COUNT(*) as c FROM publications WHERE healthStatus='unreachable'").get() as any).c;

  console.log(`[HealthCheck] Done. ${unreachableCount} unreachable publications, ${staleCount} stale journalist records.`);
}

export function startHealthCheckCron() {
  // Run at 6am ET on the 1st of every month
  cron.schedule('0 6 1 * *', () => {
    runHealthChecks().catch(err => console.error('[HealthCheck] Error:', err));
  }, { timezone: 'America/New_York' });

  console.log('[HealthCheck] Monthly health check cron scheduled (1st of month, 6am ET)');
}
