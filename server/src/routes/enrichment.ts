import { Router } from 'express';
import axios from 'axios';
import db from '../db';

const router = Router();

// Extract root domain from a URL, e.g. "https://techcrunch.com/about" → "techcrunch.com"
function extractDomain(url: string): string {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// Split "First Last" into first/last, handling middle names / single names
function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

/**
 * POST /api/enrichment/:id
 * Look up a journalist's email via Apollo People Match API.
 * On success, saves the email to the journalist record.
 */
router.post('/:id', async (req, res) => {
  const journalistId = Number(req.params.id);

  const journalist = db.prepare(`
    SELECT j.id, j.name, j.email, j.publication, p.url as pubUrl
    FROM journalists j
    LEFT JOIN publications p ON p.name = j.publication
    WHERE j.id = ?
  `).get(journalistId) as any;

  if (!journalist) return res.status(404).json({ error: 'Journalist not found' });

  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'APOLLO_API_KEY not set in environment' });

  const { firstName, lastName } = splitName(journalist.name);
  const domain = journalist.pubUrl ? extractDomain(journalist.pubUrl) : '';

  console.log(`[Apollo] Enriching ${journalist.name} @ ${domain || journalist.publication}`);

  let apolloRes: any;
  try {
    apolloRes = await axios.post(
      'https://api.apollo.io/v1/people/match',
      {
        api_key: apiKey,
        first_name: firstName,
        last_name: lastName,
        organization_name: journalist.publication,
        ...(domain ? { domain } : {}),
        reveal_personal_emails: false,
      },
      {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
        timeout: 15_000,
      }
    );
  } catch (err: any) {
    const status = err.response?.status;
    const msg = err.response?.data?.message || err.message;
    console.error(`[Apollo] API error ${status}:`, msg);

    if (status === 422) {
      return res.status(404).json({ error: 'Apollo could not find a match for this journalist.' });
    }
    if (status === 401 || status === 403) {
      return res.status(500).json({ error: 'Apollo API key is invalid or has no remaining credits.' });
    }
    return res.status(502).json({ error: `Apollo API error: ${msg}` });
  }

  const person = apolloRes.data?.person;
  if (!person) {
    return res.status(404).json({ error: 'No match found in Apollo for this journalist.' });
  }

  const email: string | null = person.email || null;
  const emailStatus: string = person.email_status || 'unknown';
  const linkedinUrl: string | null = person.linkedin_url || null;
  const twitterUrl: string | null = person.twitter_url || null;
  const title: string | null = person.title || null;

  // Save email (and any supplementary contact data we didn't have)
  const updates: string[] = [`updatedAt = datetime('now')`];
  const params: any[] = [];

  if (email && !journalist.email) {
    updates.push('email = ?');
    params.push(email);
  }

  if (updates.length > 1) {
    params.push(journalistId);
    db.prepare(`UPDATE journalists SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }

  console.log(`[Apollo] Found ${journalist.name}: email=${email} status=${emailStatus}`);

  return res.json({
    found: true,
    email,
    emailStatus,
    linkedinUrl,
    twitterUrl,
    title,
    saved: email && !journalist.email,  // true if we actually wrote it to the DB
  });
});

/**
 * POST /api/enrichment/bulk
 * Run Apollo enrichment for all journalists missing an email.
 * Processes in the background with a 1.2s delay between calls (Apollo rate limit).
 */
router.post('/bulk/run', async (req, res) => {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'APOLLO_API_KEY not set in environment' });

  const missing = db.prepare(`
    SELECT j.id, j.name, j.email, j.publication, p.url as pubUrl
    FROM journalists j
    LEFT JOIN publications p ON p.name = j.publication
    WHERE (j.email IS NULL OR j.email = '')
    AND j.outreachStatus NOT IN ('Not a Fit', 'Declined')
  `).all() as any[];

  if (missing.length === 0) {
    return res.json({ message: 'All journalists already have emails.', count: 0 });
  }

  res.json({ message: `Enriching ${missing.length} journalists in the background…`, count: missing.length });

  // Run in background
  (async () => {
    let found = 0;
    for (const j of missing) {
      await new Promise(r => setTimeout(r, 1200));
      const { firstName, lastName } = splitName(j.name);
      const domain = j.pubUrl ? extractDomain(j.pubUrl) : '';
      try {
        const r = await axios.post(
          'https://api.apollo.io/v1/people/match',
          {
            api_key: apiKey,
            first_name: firstName,
            last_name: lastName,
            organization_name: j.publication,
            ...(domain ? { domain } : {}),
            reveal_personal_emails: false,
          },
          { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }, timeout: 15_000 }
        );
        const email = r.data?.person?.email;
        if (email) {
          db.prepare("UPDATE journalists SET email = ?, updatedAt = datetime('now') WHERE id = ?").run(email, j.id);
          found++;
          console.log(`[Apollo Bulk] ✓ ${j.name}: ${email}`);
        } else {
          console.log(`[Apollo Bulk] ✗ ${j.name}: no match`);
        }
      } catch (err: any) {
        console.error(`[Apollo Bulk] Error for ${j.name}:`, err.response?.data?.message || err.message);
      }
    }
    console.log(`[Apollo Bulk] Done. Found ${found}/${missing.length} emails.`);
  })();
});

export default router;
