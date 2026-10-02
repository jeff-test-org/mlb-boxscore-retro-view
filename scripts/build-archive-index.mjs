#!/usr/bin/env node
/**
 * Builds papers/index.html — a browsable archive of all past issues.
 */

import { readdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const papersDir = join(__dirname, '..', 'papers');

const days   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const months = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m-1, d);
  return `${days[dt.getDay()]}, ${months[m-1]} ${d}, ${y}`;
}

// Collect all YYYY-MM-DD.html files
const issues = readdirSync(papersDir)
  .filter(f => /^\d{4}-\d{2}-\d{2}\.html$/.test(f))
  .map(f => f.replace('.html',''))
  .sort()
  .reverse(); // newest first

const rows = issues.map(date => `
  <tr>
    <td class="issue-date"><a href="${date}.html">${formatDate(date)}</a></td>
    <td class="issue-link"><a href="${date}.html">Read &rarr;</a></td>
  </tr>`).join('');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>The Baseball Gazette — Archive</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=UnifrakturMaguntia&family=Playfair+Display+SC:wght@400;700&family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
  <style>
    :root{--ink:#1a1209;--paper:#f5f0e8;--paper-dark:#ede7d9;--rule:#2a1f0f;--faint:#8b7355}
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#c8bfa8;font-family:'Libre Baskerville',Georgia,serif;color:var(--ink);font-size:14px}
    .newspaper{max-width:680px;margin:24px auto;background:var(--paper);box-shadow:2px 2px 12px rgba(0,0,0,.45)}
    .masthead{border-bottom:4px double var(--rule);padding:16px 24px 10px;text-align:center}
    .masthead-name{font-family:'UnifrakturMaguntia',cursive;font-size:64px;line-height:1;color:var(--ink)}
    .masthead-rule{border:none;border-top:1px solid var(--rule);margin:6px 0 4px}
    .masthead-tagline{font-family:'Playfair Display SC',serif;font-size:10.5px;letter-spacing:.18em;color:var(--faint);margin-bottom:5px}
    .section{padding:16px 24px 24px}
    .section-hed{font-family:'Playfair Display SC',serif;font-size:14px;letter-spacing:.2em;text-align:center;padding:8px 0 6px;border-bottom:1px solid var(--rule);margin-bottom:14px}
    .archive-table{width:100%;border-collapse:collapse}
    .archive-table tr{border-bottom:1px dotted #d4c9b0}
    .archive-table tr:last-child{border-bottom:none}
    .issue-date{padding:7px 0}
    .issue-link{text-align:right;padding:7px 0}
    a{color:var(--ink);text-decoration:none;border-bottom:1px dotted var(--faint)}
    a:hover{border-bottom:1px solid var(--ink)}
    .home-link{display:block;text-align:center;margin-top:12px;font-size:11px;font-family:'Playfair Display SC',serif;letter-spacing:.1em;color:var(--faint)}
    .paper-footer{border-top:3px double var(--rule);text-align:center;font-size:9px;color:var(--faint);padding:8px;font-style:italic}
  </style>
</head>
<body>
<article class="newspaper">
  <header class="masthead">
    <div class="masthead-name">The Baseball Gazette</div>
    <hr class="masthead-rule">
    <div class="masthead-tagline">All the News That's Fit to Print — From Diamond to Dugout</div>
  </header>
  <section class="section">
    <h2 class="section-hed">Past Issues</h2>
    ${issues.length ? `<table class="archive-table"><tbody>${rows}</tbody></table>` : '<p style="text-align:center;font-style:italic;color:var(--faint)">No issues yet.</p>'}
    <a class="home-link" href="../index.html">&larr; Live Edition</a>
  </section>
  <footer class="paper-footer">San Francisco Edition &mdash; Est. 1876</footer>
</article>
</body>
</html>`;

writeFileSync(join(papersDir, 'index.html'), html, 'utf8');
console.log(`✓ Archive index updated (${issues.length} issues)`);
