#!/usr/bin/env node
// Publie un lot d'articles de blog vers l'API (POST /blog, protégé par x-admin-key).
// Les articles du lot ont published: false : le cron quotidien de 9h UTC en publiera un par jour.
//
//   node scripts/post-blog-drafts.mjs blog-drafts/2026-07-26.json \
//     --url https://trendflixbe-production.up.railway.app --key <ADMIN_API_KEY>
//
// L'URL et la clé peuvent aussi venir de API_URL / ADMIN_API_KEY.
// --dry-run affiche ce qui serait envoyé sans rien appeler.

import { readFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const opts = { url: process.env.API_URL ?? 'http://localhost:3001', key: process.env.ADMIN_API_KEY };
let file;
let dryRun = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--dry-run') dryRun = true;
  else if (arg === '--url' || arg === '--key') opts[arg.slice(2)] = args[++i];
  else file ??= arg;
}

const apiUrl = opts.url.replace(/\/$/, '');
const adminKey = opts.key;

if (!file) {
  console.error('Usage : node scripts/post-blog-drafts.mjs <fichier.json> [--url ...] [--key ...] [--dry-run]');
  process.exit(1);
}
if (!adminKey && !dryRun) {
  console.error('Clé admin manquante : passez --key ou définissez ADMIN_API_KEY.');
  process.exit(1);
}

const articles = JSON.parse(await readFile(file, 'utf8'));
if (!Array.isArray(articles)) {
  console.error('Le fichier doit contenir un tableau d’articles.');
  process.exit(1);
}

console.log(`${articles.length} article(s) → ${apiUrl}/blog${dryRun ? ' (dry-run)' : ''}`);

let failed = 0;
for (const [index, article] of articles.entries()) {
  const label = `${index + 1}/${articles.length} [${article.format}] ${article.titleFr}`;
  if (dryRun) {
    console.log(`· ${label} — ${article.items?.length ?? 0} élément(s)`);
    continue;
  }
  const res = await fetch(`${apiUrl}/blog`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-key': adminKey },
    body: JSON.stringify(article),
  });
  if (!res.ok) {
    failed++;
    console.error(`✗ ${label} — HTTP ${res.status} ${await res.text()}`);
    continue;
  }
  const created = await res.json();
  console.log(`✓ ${label} — id ${created.id}`);
}

if (failed) process.exit(1);
