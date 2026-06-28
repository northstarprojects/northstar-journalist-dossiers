/**
 * healthCheckJob.ts
 * Runs monthly (1st of every month, 6am ET).
 */

import cron from 'node-cron';
import axios from 'axios';
import pool from '../db';

async function checkUrl(url: string): Promise<'healthy' | 'unreachable'> {
  try {
    await axios.head(url, {
      timeout: 8000, maxRedirects: 3,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NorthStarHealthBot/1.0)' },
    });
    return 'healthy';
  } catch { return 'unreachable'; }
}

export async function runHealthChecks() {
  console.log('[HealthCheck] Starting publication + journalist health checks…');

  const pubs = (await pool.query(
    "SELECT id, name, url FROM publications WHERE active=1 AND url != '' AND \"isVirtual\" != 1"
  )).rows;

  for (const pub of pubs) {
    const status = await checkUrl(pub.url);
    await pool.query(
      "UPDATE publications SET \"healthStatus\"=$1, \"lastHealthCheck\"=NOW()::TEXT WHERE id=$2",
      [status, pub.id]
    );
    if (status === 'unreachable') console.warn(`[HealthCheck] ⚠️  "${pub.name}" is unreachable (${pub.url})`);
    await new Promise(r => setTimeout(r, 800));
  }

  // Flag publications with no RSS activity in 30 days
  await pool.query(`
    UPDATE publications SET "rssStatus" = 'inactive'
    WHERE "rssStatus" = 'active'
      AND "rssLastChecked" != ''
      AND "rssLastChecked"::TIMESTAMP < NOW() - INTERVAL '30 days'
  `);

  // Flag stale journalist records (not updated in 90 days)
  await pool.query(`
    UPDATE journalists SET "staleFlag" = 1
    WHERE "updatedAt" < NOW() - INTERVAL '90 days'
  `);

  // Clear stale flag for recently updated journalists
  await pool.query(`
    UPDATE journalists SET "staleFlag" = 0
    WHERE "updatedAt" >= NOW() - INTERVAL '90 days'
  `);

  const staleCount = (await pool.query("SELECT COUNT(*)::int as c FROM journalists WHERE \"staleFlag\"=1")).rows[0].c;
  const unreachableCount = (await pool.query("SELECT COUNT(*)::int as c FROM publications WHERE \"healthStatus\"='unreachable'")).rows[0].c;

  console.log(`[HealthCheck] Done. ${unreachableCount} unreachable publications, ${staleCount} stale journalist records.`);
}

export function startHealthCheckCron() {
  cron.schedule('0 6 1 * *', () => {
    runHealthChecks().catch(err => console.error('[HealthCheck] Error:', err));
  }, { timezone: 'America/New_York' });
  console.log('[HealthCheck] Monthly health check cron scheduled (1st of month, 6am ET)');
}
