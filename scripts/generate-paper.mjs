#!/usr/bin/env node
/**
 * The Baseball Gazette — Paper Generator
 *
 * Fetches MLB data for a given date and writes a fully self-contained
 * HTML file to papers/YYYY-MM-DD.html. No browser-side API calls needed.
 *
 * Usage:  node scripts/generate-paper.mjs [YYYY-MM-DD]
 *         (defaults to yesterday in US/Pacific time)
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── DATE ─────────────────────────────────────────────────────────────────────

function getYesterday() {
  // Use Intl to get PT date, subtract one day
  const now = new Date();
  const ptStr = now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
  const pt = new Date(ptStr);
  pt.setDate(pt.getDate() - 1);
  return pt.toISOString().split('T')[0];
}

const DATE = process.argv[2] || getYesterday();
const MLB = 'https://statsapi.mlb.com/api/v1';
const FEATURED_TEAM = 137; // San Francisco Giants

// ── FETCH ─────────────────────────────────────────────────────────────────────

async function get(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json();
}

async function fetchAll() {
  console.log(`Fetching data for ${DATE}…`);
  const [schedule, standings, avgData, hrData, eraData] = await Promise.all([
    get(`${MLB}/schedule?sportId=1&date=${DATE}&hydrate=linescore,boxscore,decisions`),
    get(`${MLB}/standings?leagueId=103,104&season=2025&standingsType=regularSeason&date=${DATE}&hydrate=team`),
    get(`${MLB}/stats/leaders?leaderCategories=battingAverage&season=2025&limit=5&statGroup=hitting&sportId=1`),
    get(`${MLB}/stats/leaders?leaderCategories=homeRuns&season=2025&limit=5&statGroup=hitting&sportId=1`),
    get(`${MLB}/stats/leaders?leaderCategories=earnedRunAverage&season=2025&limit=5&statGroup=pitching&sportId=1`),
  ]);
  return { schedule, standings, leaders: { avg: avgData, hr: hrData, era: eraData } };
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

function isFeatured(game) {
  return game.teams.away.team.id === FEATURED_TEAM || game.teams.home.team.id === FEATURED_TEAM;
}

function teamAbbr(name) {
  const map = {
    'Arizona Diamondbacks':'Arizona','Atlanta Braves':'Atlanta',
    'Baltimore Orioles':'Baltimore','Boston Red Sox':'Boston',
    'Chicago Cubs':'Chi. Cubs','Chicago White Sox':'Chi. Sox',
    'Cincinnati Reds':'Cincinnati','Cleveland Guardians':'Cleveland',
    'Colorado Rockies':'Colorado','Detroit Tigers':'Detroit',
    'Houston Astros':'Houston','Kansas City Royals':'Kansas City',
    'Los Angeles Angels':'L.A. Angels','Los Angeles Dodgers':'L.A. Dodgers',
    'Miami Marlins':'Miami','Milwaukee Brewers':'Milwaukee',
    'Minnesota Twins':'Minnesota','New York Mets':'N.Y. Mets',
    'New York Yankees':'N.Y. Yankees','Oakland Athletics':'Oakland',
    'Philadelphia Phillies':'Philadelphia','Pittsburgh Pirates':'Pittsburgh',
    'San Diego Padres':'San Diego','San Francisco Giants':'San Francisco',
    'Seattle Mariners':'Seattle','St. Louis Cardinals':'St. Louis',
    'Tampa Bay Rays':'Tampa Bay','Texas Rangers':'Texas',
    'Toronto Blue Jays':'Toronto','Washington Nationals':'Washington',
    'Athletics':'Athletics',
  };
  return map[name] || name;
}

function winPct(w, l) {
  const t = w + l;
  return t ? '.' + String(Math.round((w/t)*1000)).padStart(3,'0') : '.000';
}

function formatAvg(v) {
  const n = parseFloat(v);
  return isNaN(n) ? v : '.' + String(Math.round(n*1000)).padStart(3,'0');
}

function h(str) {
  // Basic HTML entity escape
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

function formatDisplayDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const months = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
  const dt = new Date(y, m-1, d);
  return `${days[dt.getDay()]}, ${months[m-1]} ${d}, ${y}`;
}

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m-1, d+n);
  return dt.toISOString().split('T')[0];
}

// ── RENDERING ─────────────────────────────────────────────────────────────────

const DIVISION_NAMES = {
  201:'AL East',202:'AL Central',203:'AL West',
  204:'NL East',205:'NL Central',206:'NL West'
};
const DIVISION_ORDER = [201,202,203,204,205,206];

function renderBatters(teamBs) {
  const batters = teamBs.batters || [];
  const players = teamBs.players || {};
  let totAb=0, totR=0, totH=0, totBi=0;
  const rows = batters.map(id => {
    const p = players[`ID${id}`];
    if (!p) return '';
    const s = p.stats?.batting || {};
    const pos = p.position?.abbreviation || '';
    const order = parseInt(p.battingOrder || '0');
    const isSub = order % 100 !== 0;
    const name = p.person?.fullName || '?';
    const [first, ...rest] = name.split(' ');
    const lastName = rest.join(' ');
    const display = lastName ? `${lastName}, ${first[0]}.` : name;
    const ab = s.atBats ?? 0, r = s.runs ?? 0, hits = s.hits ?? 0, bi = s.rbi ?? 0;
    totAb+=ab; totR+=r; totH+=hits; totBi+=bi;
    return `<tr>
      <td><span class="pos-abbr">${h(pos)}</span>${isSub ? '&nbsp;&nbsp;' : ''}${h(display)}</td>
      <td>${ab}</td><td>${r}</td><td>${hits}</td><td>${bi}</td>
    </tr>`;
  }).join('');
  return rows + `<tr class="totals-row">
    <td>Totals</td>
    <td>${totAb}</td><td>${totR}</td><td>${totH}</td><td>${totBi}</td>
  </tr>`;
}

function renderPitchers(teamBs, decisions) {
  const pitchers = teamBs.pitchers || [];
  const players = teamBs.players || {};
  return pitchers.map(id => {
    const p = players[`ID${id}`];
    if (!p) return '';
    const s = p.stats?.pitching || {};
    const name = p.person?.fullName || '?';
    const [first, ...rest] = name.split(' ');
    const lastName = rest.join(' ');
    let display = lastName ? `${lastName}, ${first[0]}.` : name;
    if (id === decisions?.winner?.id) display += ' W';
    if (id === decisions?.loser?.id)  display += ' L';
    if (id === decisions?.save?.id)   display += ' S';
    return `<tr>
      <td>${h(display)}</td>
      <td>${s.inningsPitched ?? '0.0'}</td>
      <td>${s.hits ?? 0}</td><td>${s.runs ?? 0}</td>
      <td>${s.earnedRuns ?? 0}</td><td>${s.baseOnBalls ?? 0}</td><td>${s.strikeOuts ?? 0}</td>
    </tr>`;
  }).join('');
}

function renderFullBoxScore(game) {
  const t = game.teams;
  const away = t.away, home = t.home;
  const bs = game.boxscore || {};
  const ls = game.linescore || {};
  const innings = ls.innings || [];
  const status = game.status?.detailedState || '';
  const isOver = status.startsWith('Final');
  const awayRuns = away.score ?? 0, homeRuns = home.score ?? 0;
  const awayWon = isOver && awayRuns > homeRuns;
  const homeWon = isOver && homeRuns > awayRuns;
  const numInnings = Math.max(9, innings.length);
  const venue = game.venue?.name || '';

  const awayBs = bs.teams?.away || {};
  const homeBs = bs.teams?.home || {};

  let inningHeaders = '';
  for (let i = 1; i <= numInnings; i++) inningHeaders += `<th>${i}</th>`;

  function inningRunCells(teamKey) {
    let out = '';
    for (let i = 0; i < numInnings; i++) {
      const inn = innings[i];
      let val;
      if (inn) {
        val = inn[teamKey]?.runs ?? '·';
      } else {
        val = (teamKey === 'home' && isOver && homeWon) ? 'x' : '·';
      }
      out += `<td class="${val === 'x' ? 'x' : ''}">${val}</td>`;
    }
    return out;
  }

  const awayH = ls.teams?.away?.hits ?? '–';
  const homeH = ls.teams?.home?.hits ?? '–';
  const awayE = ls.teams?.away?.errors ?? '–';
  const homeE = ls.teams?.home?.errors ?? '–';

  // Game notes
  const info = bs.info || [];
  const noteLines = info
    .filter(n => n.label && n.value && !['T','A'].includes(n.label))
    .map(n => `<span class="note-label">${h(n.label)}—</span>${h(n.value)}`);
  const timeEntry = info.find(n => n.label === 'T');
  const attEntry  = info.find(n => n.label === 'A');
  if (timeEntry || attEntry) {
    const parts = [];
    if (timeEntry) parts.push(`T—${h(timeEntry.value)}`);
    if (attEntry)  parts.push(`A—${Number(attEntry.value.replace(/,/g,'')).toLocaleString()}`);
    noteLines.push(parts.join('. '));
  }
  const notes = noteLines.join(' ');

  return `
    <div class="box-full">
      <div class="box-header">
        <span>★ ${h(away.team.name)} at ${h(home.team.name)} — ${h(venue)}</span>
        <span>${h(isOver ? 'Final' : status)}${numInnings > 9 ? ` (${numInnings} inn.)` : ''}</span>
      </div>

      <div class="batting-columns">
        <div class="batting-col">
          <div class="team-label">${h(away.team.name.toUpperCase())}</div>
          <table class="batting-table">
            <thead><tr><th></th><th>ab</th><th>r</th><th>h</th><th>bi</th></tr></thead>
            <tbody>${renderBatters(awayBs)}</tbody>
          </table>
        </div>
        <div class="batting-col">
          <div class="team-label">${h(home.team.name.toUpperCase())}</div>
          <table class="batting-table">
            <thead><tr><th></th><th>ab</th><th>r</th><th>h</th><th>bi</th></tr></thead>
            <tbody>${renderBatters(homeBs)}</tbody>
          </table>
        </div>
      </div>

      <div class="linescore-section">
        <table class="linescore-tbl">
          <thead><tr><th></th>${inningHeaders}<th class="sep">R</th><th>H</th><th>E</th></tr></thead>
          <tbody>
            <tr>
              <td>${h(teamAbbr(away.team.name))}${awayWon ? ' ✓' : ''}</td>
              ${inningRunCells('away')}
              <td class="sep">${awayRuns}</td><td>${awayH}</td><td>${awayE}</td>
            </tr>
            <tr>
              <td>${h(teamAbbr(home.team.name))}${homeWon ? ' ✓' : ''}</td>
              ${inningRunCells('home')}
              <td class="sep">${homeRuns}</td><td>${homeH}</td><td>${homeE}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="pitching-section">
        <div class="pitching-label">${h(away.team.name.toUpperCase())}</div>
        <table class="pitching-tbl">
          <thead><tr><th></th><th>ip</th><th>h</th><th>r</th><th>er</th><th>bb</th><th>so</th></tr></thead>
          <tbody>${renderPitchers(awayBs, game.decisions)}</tbody>
        </table>
        <div class="pitching-label" style="margin-top:6px">${h(home.team.name.toUpperCase())}</div>
        <table class="pitching-tbl">
          <thead><tr><th></th><th>ip</th><th>h</th><th>r</th><th>er</th><th>bb</th><th>so</th></tr></thead>
          <tbody>${renderPitchers(homeBs, game.decisions)}</tbody>
        </table>
      </div>
      ${notes ? `<div class="game-notes">${notes}</div>` : ''}
    </div>`;
}

function renderCondensedCard(game) {
  const t = game.teams;
  const away = t.away, home = t.home;
  const ls = game.linescore || {};
  const innings = ls.innings || [];
  const status = game.status?.detailedState || '';
  const isOver = status.startsWith('Final');
  const awayRuns = away.score ?? 0, homeRuns = home.score ?? 0;
  const awayWon = isOver && awayRuns > homeRuns;
  const homeWon = isOver && homeRuns > awayRuns;
  const numInnings = Math.max(9, innings.length);

  let inningHeaders = '';
  for (let i = 1; i <= numInnings; i++) inningHeaders += `<th>${i}</th>`;

  function inningCells(teamKey) {
    let out = '';
    for (let i = 0; i < numInnings; i++) {
      const inn = innings[i];
      let val = inn ? (inn[teamKey]?.runs ?? '·') : '·';
      if (!inn && teamKey === 'home' && isOver && homeWon) val = 'x';
      out += `<td>${val}</td>`;
    }
    return out;
  }

  const awayH = ls.teams?.away?.hits ?? '–';
  const homeH = ls.teams?.home?.hits ?? '–';
  const awayE = ls.teams?.away?.errors ?? '–';
  const homeE = ls.teams?.home?.errors ?? '–';

  const dec = game.decisions || {};
  let decStr = '';
  if (dec.winner) {
    const parts = [];
    const wn = dec.winner.fullName?.split(' ').pop();
    const ln = dec.loser?.fullName?.split(' ').pop();
    const sn = dec.save?.fullName?.split(' ').pop();
    if (wn) parts.push(`W: ${wn}`);
    if (ln) parts.push(`L: ${ln}`);
    if (sn) parts.push(`S: ${sn}`);
    decStr = parts.join(' · ');
  }

  return `
    <div class="game-card">
      <div class="gc-header">
        <span>${h(game.venue?.name || '')}</span>
        <span>${h(isOver ? 'Final' : status)}${numInnings > 9 ? ` (${numInnings})` : ''}</span>
      </div>
      <table class="gc-linescore">
        <thead><tr><th></th>${inningHeaders}<th class="sep">R</th><th>H</th><th>E</th></tr></thead>
        <tbody>
          <tr class="${awayWon ? 'winner' : ''}">
            <td>${h(teamAbbr(away.team.name))}</td>
            ${inningCells('away')}
            <td class="sep">${awayRuns}</td><td>${awayH}</td><td>${awayE}</td>
          </tr>
          <tr class="${homeWon ? 'winner' : ''}">
            <td>${h(teamAbbr(home.team.name))}</td>
            ${inningCells('home')}
            <td class="sep">${homeRuns}</td><td>${homeH}</td><td>${homeE}</td>
          </tr>
        </tbody>
      </table>
      ${decStr ? `<div class="gc-footer">${h(decStr)}</div>` : ''}
    </div>`;
}

function renderScores(schedule) {
  const dates = schedule.dates || [];
  if (!dates.length || !dates[0].games?.length) {
    return '<div class="loading">No games scheduled for this date.</div>';
  }

  const games = [...dates[0].games].sort((a, b) =>
    (isFeatured(a) ? -1 : isFeatured(b) ? 1 : a.gamePk - b.gamePk)
  );

  let html = '<div class="scores-layout">';
  let first = true;
  let otherCards = '';

  for (const game of games) {
    if (first && isFeatured(game)) {
      html += renderFullBoxScore(game);
      first = false;
    } else {
      otherCards += renderCondensedCard(game);
      first = false;
    }
  }

  if (otherCards) html += `<div class="games-grid">${otherCards}</div>`;
  html += '</div>';
  return html;
}

function renderStandings(standings) {
  const divMap = {};
  for (const rec of (standings.records || [])) {
    divMap[rec.division?.id] = rec.teamRecords || [];
  }

  let html = '<div class="standings-grid">';
  for (const divId of DIVISION_ORDER) {
    const teams = divMap[divId];
    if (!teams) continue;
    let rows = '';
    teams.forEach((t, i) => {
      const rec = t.leagueRecord;
      const gb = (!t.gamesBack || t.gamesBack === '-' || t.gamesBack === '0') ? '—' : t.gamesBack;
      rows += `<tr class="${i===0 ? 'div-leader' : ''}">
        <td>${h(teamAbbr(t.team.name))}</td>
        <td>${rec.wins}</td><td>${rec.losses}</td>
        <td>${gb}</td><td>${winPct(rec.wins,rec.losses)}</td>
      </tr>`;
    });
    html += `<div class="div-block">
      <div class="div-hed">${DIVISION_NAMES[divId]}</div>
      <table class="standings-tbl">
        <thead><tr><th>Club</th><th>W</th><th>L</th><th>GB</th><th>Pct</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }
  html += '</div>';
  return html;
}

function renderLeaders(leaders) {
  const ranks = ['1st','2nd','3rd','4th','5th'];

  function block(title, data, cat, fmt) {
    const entries = ((data.leagueLeaders || []).find(c => c.leaderCategory === cat)?.leaders || []).slice(0,5);
    const rows = entries.map((l, i) => `<tr>
      <td><span class="rank">${ranks[i]}</span>${h(l.person?.fullName || '—')} <span class="player-team">${h(l.team?.abbreviation || '')}</span></td>
      <td>${h(fmt(l.value))}</td>
    </tr>`).join('');
    return `<div class="leaders-block">
      <div class="leaders-hed">${title}</div>
      <table class="leaders-tbl"><tbody>${rows}</tbody></table>
    </div>`;
  }

  return `<div class="leaders-grid">
    ${block('Batting Average', leaders.avg, 'battingAverage', formatAvg)}
    ${block('Home Runs',       leaders.hr,  'homeRuns',       v => v)}
    ${block('ERA',             leaders.era, 'earnedRunAverage', v => parseFloat(v).toFixed(2))}
  </div>`;
}

// ── CSS ───────────────────────────────────────────────────────────────────────

const CSS = `
:root{--ink:#1a1209;--paper:#f5f0e8;--paper-dark:#ede7d9;--rule:#2a1f0f;--faint:#8b7355;--faint2:#b8a88a}
*{box-sizing:border-box;margin:0;padding:0}
body{background:#c8bfa8;font-family:'Libre Baskerville',Georgia,serif;color:var(--ink);font-size:13px;line-height:1.4}
.newspaper{max-width:980px;margin:24px auto;background:var(--paper);box-shadow:2px 2px 12px rgba(0,0,0,.45),4px 4px 24px rgba(0,0,0,.2)}
.masthead{border-bottom:4px double var(--rule);padding:16px 24px 10px;text-align:center}
.masthead-meta{display:flex;justify-content:space-between;font-size:9.5px;color:var(--faint);margin-bottom:4px;letter-spacing:.05em}
.masthead-name{font-family:'UnifrakturMaguntia',cursive;font-size:72px;line-height:1;color:var(--ink)}
.masthead-rule{border:none;border-top:1px solid var(--rule);margin:6px 0 4px}
.masthead-tagline{font-family:'Playfair Display SC',serif;font-size:10.5px;letter-spacing:.18em;color:var(--faint);margin-bottom:5px}
.masthead-date-bar{display:flex;justify-content:space-between;align-items:center;font-size:9.5px;color:var(--faint);letter-spacing:.06em;padding:3px 0;border-top:1px solid var(--rule);border-bottom:1px solid var(--rule)}
.section{padding:0 24px 20px}.section+.section{border-top:3px double var(--rule)}
.section-hed{font-family:'Playfair Display SC',serif;font-size:13px;letter-spacing:.2em;text-align:center;padding:8px 0 6px;border-bottom:1px solid var(--rule);margin-bottom:14px}
.loading{text-align:center;padding:30px;font-style:italic;color:var(--faint)}
.scores-layout{display:flex;flex-direction:column;gap:16px}
.games-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(285px,1fr));gap:12px}
.box-full{border:2px solid var(--rule)}
.box-header{background:var(--ink);color:var(--paper);font-family:'Playfair Display SC',serif;font-size:11px;letter-spacing:.1em;padding:4px 10px;display:flex;justify-content:space-between}
.batting-columns{display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid var(--rule)}
.batting-col+.batting-col{border-left:1px solid var(--rule)}
.team-label{font-family:'Playfair Display SC',serif;font-size:9.5px;letter-spacing:.12em;padding:3px 6px;background:var(--paper-dark);border-bottom:1px solid var(--rule)}
.batting-table{width:100%;border-collapse:collapse;font-size:11px}
.batting-table th{font-family:'Playfair Display SC',serif;font-weight:400;font-size:8.5px;letter-spacing:.1em;padding:1px 4px;text-align:right;color:var(--faint);border-bottom:1px solid var(--faint2)}
.batting-table th:first-child{text-align:left}
.batting-table td{padding:1px 4px;text-align:right;border-bottom:1px dotted #d8cfbc}
.batting-table td:first-child{text-align:left;white-space:nowrap;overflow:hidden;max-width:160px}
.batting-table tr.totals-row td{border-top:1px solid var(--rule);border-bottom:none;font-weight:700;background:var(--paper-dark)}
.batting-table tr.totals-row td:first-child{font-size:9px;letter-spacing:.05em}
.pos-abbr{font-size:9px;color:var(--faint);margin-right:2px}
.linescore-section{padding:6px 10px;border-bottom:1px solid var(--rule)}
.linescore-tbl{width:100%;border-collapse:collapse;font-size:11.5px}
.linescore-tbl th{font-family:'Playfair Display SC',serif;font-weight:400;font-size:9px;letter-spacing:.08em;color:var(--faint);text-align:center;padding:0 3px;border-bottom:1px solid var(--faint2)}
.linescore-tbl th:first-child{text-align:left;width:120px}
.linescore-tbl td{text-align:center;padding:2px 3px}.linescore-tbl td:first-child{text-align:left;font-weight:700}
.linescore-tbl td.sep{border-left:1px solid var(--rule);font-weight:700}.linescore-tbl td.x{color:var(--faint)}
.pitching-section{padding:6px 10px;border-bottom:1px solid var(--rule)}
.pitching-label{font-family:'Playfair Display SC',serif;font-size:9px;letter-spacing:.12em;color:var(--faint);margin-bottom:3px}
.pitching-tbl{width:100%;border-collapse:collapse;font-size:11px}
.pitching-tbl th{font-family:'Playfair Display SC',serif;font-weight:400;font-size:8.5px;letter-spacing:.1em;color:var(--faint);text-align:right;padding:0 4px;border-bottom:1px solid var(--faint2)}
.pitching-tbl th:first-child{text-align:left}
.pitching-tbl td{padding:1px 4px;text-align:right;border-bottom:1px dotted #d8cfbc}.pitching-tbl td:first-child{text-align:left}.pitching-tbl tr:last-child td{border-bottom:none}
.game-notes{padding:6px 10px;font-size:10.5px;line-height:1.6}
.note-label{font-weight:700;font-size:9.5px}
.game-card{border:1px solid var(--rule)}
.gc-header{background:var(--ink);color:var(--paper);font-family:'Playfair Display SC',serif;font-size:9px;letter-spacing:.1em;padding:3px 8px;display:flex;justify-content:space-between}
.gc-linescore{width:100%;border-collapse:collapse;font-size:11px}
.gc-linescore th{font-family:'Playfair Display SC',serif;font-weight:400;font-size:8.5px;letter-spacing:.08em;color:var(--faint);text-align:center;padding:1px 3px;border-bottom:1px solid var(--faint2)}
.gc-linescore th:first-child{text-align:left;width:110px}.gc-linescore td{text-align:center;padding:2px 3px}
.gc-linescore td:first-child{text-align:left;font-weight:700;padding-left:6px}
.gc-linescore td.sep{border-left:1px solid var(--rule);font-weight:700}
.gc-linescore tr.winner td:first-child::after{content:' ✓';font-weight:400;color:var(--faint);font-size:9px}
.gc-linescore tr:last-child{background:var(--paper-dark)}.gc-footer{font-size:9.5px;padding:2px 8px;color:var(--faint);border-top:1px dotted var(--rule);font-style:italic}
.standings-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.div-block{border:1px solid var(--rule)}
.div-hed{background:var(--ink);color:var(--paper);font-family:'Playfair Display SC',serif;font-size:10px;letter-spacing:.1em;padding:3px 8px;text-align:center}
.standings-tbl{width:100%;border-collapse:collapse;font-size:11.5px}
.standings-tbl th{font-family:'Playfair Display SC',serif;font-weight:400;font-size:8.5px;letter-spacing:.1em;padding:2px 6px;border-bottom:1px solid var(--rule);color:var(--faint)}
.standings-tbl th:first-child{text-align:left}.standings-tbl th:not(:first-child){text-align:right}
.standings-tbl td{padding:2px 6px;border-bottom:1px dotted #d4c9b0}.standings-tbl td:first-child{font-weight:700}.standings-tbl td:not(:first-child){text-align:right}
.standings-tbl tr.div-leader td:first-child{border-left:3px solid var(--ink);padding-left:3px}
.standings-tbl tr:last-child td{border-bottom:none}
.leaders-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.leaders-block{border:1px solid var(--rule)}
.leaders-hed{background:var(--ink);color:var(--paper);font-family:'Playfair Display SC',serif;font-size:10px;letter-spacing:.1em;padding:3px 8px;text-align:center}
.leaders-tbl{width:100%;border-collapse:collapse;font-size:11.5px}
.leaders-tbl td{padding:3px 8px;border-bottom:1px dotted #d4c9b0}.leaders-tbl td:last-child{text-align:right;font-weight:700}
.leaders-tbl tr:first-child td{font-size:12.5px;font-weight:700}.leaders-tbl tr:last-child td{border-bottom:none}
.rank{font-family:'Playfair Display SC',serif;font-size:9.5px;color:var(--faint);margin-right:4px}
.player-team{font-size:9.5px;color:var(--faint);font-style:italic}
.paper-footer{border-top:3px double var(--rule);text-align:center;font-size:9px;color:var(--faint);padding:8px;font-style:italic;letter-spacing:.05em}
@media(max-width:700px){.masthead-name{font-size:48px}.standings-grid,.leaders-grid{grid-template-columns:1fr 1fr}.batting-columns{grid-template-columns:1fr}.batting-col+.batting-col{border-left:none;border-top:1px solid var(--rule)}}
`;

// ── HTML TEMPLATE ─────────────────────────────────────────────────────────────

function buildHTML({ scoresHtml, standingsHtml, leadersHtml }) {
  const gameDate = formatDisplayDate(DATE);
  const pubDate  = formatDisplayDate(addDays(DATE, 1));
  const [y, m, d] = DATE.split('-').map(Number);
  const dayOfYear = Math.floor((new Date(y,m-1,d) - new Date(y,0,0)) / 86400000);
  const vol = `VOL. CLIV . . . No. ${dayOfYear}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>The Baseball Gazette — ${gameDate}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=UnifrakturMaguntia&family=Playfair+Display+SC:wght@400;700&family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
  <style>${CSS}</style>
</head>
<body>
<article class="newspaper">
  <header class="masthead">
    <div class="masthead-meta">
      <span>${vol}</span>
      <span>ESTABLISHED 1876</span>
      <span>PRICE: FOUR CENTS</span>
    </div>
    <div class="masthead-name">The Baseball Gazette</div>
    <hr class="masthead-rule">
    <div class="masthead-tagline">All the News That's Fit to Print — From Diamond to Dugout</div>
    <div class="masthead-date-bar">
      <span>${pubDate.toUpperCase()}</span>
      <span>MORNING EDITION</span>
      <span>SCORES FROM ${gameDate.toUpperCase()}</span>
    </div>
  </header>

  <section class="section">
    <h2 class="section-hed">${gameDate.split(',')[0]}'s Scores &amp; Box Scores</h2>
    ${scoresHtml}
  </section>

  <section class="section">
    <h2 class="section-hed">Standings — Through ${gameDate}</h2>
    ${standingsHtml}
  </section>

  <section class="section">
    <h2 class="section-hed">League Leaders</h2>
    ${leadersHtml}
  </section>

  <footer class="paper-footer">
    Data via MLB Stats API &mdash; Printed for the morning of ${pubDate} &mdash; San Francisco Edition
  </footer>
</article>
</body>
</html>`;
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

async function main() {
  const { schedule, standings, leaders } = await fetchAll();

  const scoresHtml   = renderScores(schedule);
  const standingsHtml = renderStandings(standings);
  const leadersHtml  = renderLeaders(leaders);

  const html = buildHTML({ scoresHtml, standingsHtml, leadersHtml });

  const outDir = join(__dirname, '..', 'papers');
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `${DATE}.html`);
  writeFileSync(outFile, html, 'utf8');
  console.log(`✓ Written: papers/${DATE}.html`);
}

main().catch(err => { console.error(err); process.exit(1); });
