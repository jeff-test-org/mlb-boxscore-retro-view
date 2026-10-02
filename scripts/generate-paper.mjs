#!/usr/bin/env node
/**
 * The Baseball Gazette — Paper Generator
 *
 * Fetches MLB data for a given date and writes a fully self-contained
 * HTML file to papers/YYYY-MM-DD.html.
 *
 * Usage:  node scripts/generate-paper.mjs [YYYY-MM-DD]
 *         (defaults to yesterday in US/Pacific time)
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── DATE ──────────────────────────────────────────────────────────────────────

function getYesterday() {
  const ptStr = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
  const pt = new Date(ptStr);
  pt.setDate(pt.getDate() - 1);
  return pt.toISOString().split('T')[0];
}

const DATE = process.argv[2] || getYesterday();
const MLB  = 'https://statsapi.mlb.com/api/v1';
const FEATURED_TEAM = 137; // San Francisco Giants

// ── FETCH ─────────────────────────────────────────────────────────────────────

async function get(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json();
}

async function fetchAll() {
  console.log(`Fetching data for ${DATE}…`);
  const [schedule, standings, alHit, nlHit, alPit, nlPit] = await Promise.all([
    get(`${MLB}/schedule?sportId=1&date=${DATE}&hydrate=linescore,boxscore,decisions`),
    get(`${MLB}/standings?leagueId=103,104&season=2025&standingsType=regularSeason&date=${DATE}&hydrate=team`),
    get(`${MLB}/stats/leaders?leaderCategories=battingAverage,homeRuns,rbi&season=2025&limit=10&statGroup=hitting&sportId=1&leagueId=103`),
    get(`${MLB}/stats/leaders?leaderCategories=battingAverage,homeRuns,rbi&season=2025&limit=10&statGroup=hitting&sportId=1&leagueId=104`),
    get(`${MLB}/stats/leaders?leaderCategories=wins,saves,strikeouts&season=2025&limit=10&statGroup=pitching&sportId=1&leagueId=103`),
    get(`${MLB}/stats/leaders?leaderCategories=wins,saves,strikeouts&season=2025&limit=10&statGroup=pitching&sportId=1&leagueId=104`),
  ]);
  return { schedule, standings, alHit, nlHit, alPit, nlPit };
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

function shortName(fullName) {
  const [first, ...rest] = (fullName || '?').split(' ');
  const last = rest.join(' ');
  return last ? `${last}, ${first[0]}.` : fullName;
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
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── BOX SCORE RENDERING ───────────────────────────────────────────────────────

function renderBatterRows(teamBs) {
  const batters = teamBs.batters || [];
  const players = teamBs.players || {};
  let totAb=0, totR=0, totH=0, totBi=0, html='';
  for (const id of batters) {
    const p = players[`ID${id}`];
    if (!p) continue;
    const s    = p.stats?.batting || {};
    const pos  = p.position?.abbreviation || '';
    const isSub = (parseInt(p.battingOrder||'0') % 100) !== 0;
    const ab = s.atBats??0, r = s.runs??0, ht = s.hits??0, bi = s.rbi??0;
    totAb+=ab; totR+=r; totH+=ht; totBi+=bi;
    html += `<tr>
      <td><span class="pos-abbr">${h(pos)}</span>${isSub?'&thinsp;':''}${h(shortName(p.person?.fullName))}</td>
      <td>${ab}</td><td>${r}</td><td>${ht}</td><td>${bi}</td>
    </tr>`;
  }
  return html + `<tr class="totals-row"><td>Totals</td><td>${totAb}</td><td>${totR}</td><td>${totH}</td><td>${totBi}</td></tr>`;
}

function renderPitcherRows(teamBs, decisions) {
  const pitchers = teamBs.pitchers || [];
  const players  = teamBs.players  || {};
  const wId = decisions?.winner?.id, lId = decisions?.loser?.id, sId = decisions?.save?.id;
  return pitchers.map(id => {
    const p = players[`ID${id}`];
    if (!p) return '';
    const s = p.stats?.pitching || {};
    let name = shortName(p.person?.fullName);
    if (id===wId) name += ' W';
    if (id===lId) name += ' L';
    if (id===sId) name += ' S';
    return `<tr>
      <td>${h(name)}</td>
      <td>${s.inningsPitched??'0.0'}</td><td>${s.hits??0}</td><td>${s.runs??0}</td>
      <td>${s.earnedRuns??0}</td><td>${s.baseOnBalls??0}</td><td>${s.strikeOuts??0}</td>
    </tr>`;
  }).join('');
}

function renderBoxScore(game, featured) {
  const t    = game.teams;
  const away = t.away, home = t.home;
  const bs   = game.boxscore || {};
  const ls   = game.linescore || {};
  const innings = ls.innings || [];
  const status  = game.status?.detailedState || '';
  const isOver  = status.startsWith('Final');
  const awayRuns = away.score??0, homeRuns = home.score??0;
  const awayWon  = isOver && awayRuns > homeRuns;
  const homeWon  = isOver && homeRuns > awayRuns;
  const numInn   = Math.max(9, innings.length);
  const venue    = game.venue?.name || '';
  const awayBs   = bs.teams?.away || {};
  const homeBs   = bs.teams?.home || {};

  let innHdr = '';
  for (let i=1; i<=numInn; i++) innHdr += `<th>${i}</th>`;

  function innCells(key) {
    let out = '';
    for (let i=0; i<numInn; i++) {
      const inn = innings[i];
      const v = inn ? (inn[key]?.runs??'·') : (key==='home' && isOver && homeWon ? 'x' : '·');
      out += `<td class="${v==='x'?'x':''}">${v}</td>`;
    }
    return out;
  }

  const awayH = ls.teams?.away?.hits??'–', homeH = ls.teams?.home?.hits??'–';
  const awayE = ls.teams?.away?.errors??'–', homeE = ls.teams?.home?.errors??'–';

  const info = bs.info || [];
  const noteLines = info
    .filter(n => n.label && n.value && !['T','A'].includes(n.label))
    .map(n => `<span class="note-label">${h(n.label)}—</span>${h(n.value)}`);
  const tE = info.find(n=>n.label==='T'), aE = info.find(n=>n.label==='A');
  if (tE||aE) {
    const parts = [];
    if (tE) parts.push(`T—${h(tE.value)}`);
    if (aE) parts.push(`A—${Number(aE.value.replace(/,/g,'')).toLocaleString()}`);
    noteLines.push(parts.join('. '));
  }
  const notes = noteLines.join(' ');

  const cls = featured ? 'box-full featured' : 'box-full';
  return `
    <div class="${cls}">
      <div class="box-header">
        <span>${featured?'★ ':''}${h(away.team.name)} at ${h(home.team.name)} — ${h(venue)}</span>
        <span>${h(isOver?'Final':status)}${numInn>9?` (${numInn} inn.)`:''}</span>
      </div>
      <div class="batting-columns">
        <div class="batting-col">
          <div class="team-label">${h(away.team.name.toUpperCase())}</div>
          <table class="batting-table">
            <thead><tr><th></th><th>ab</th><th>r</th><th>h</th><th>bi</th></tr></thead>
            <tbody>${renderBatterRows(awayBs)}</tbody>
          </table>
        </div>
        <div class="batting-col">
          <div class="team-label">${h(home.team.name.toUpperCase())}</div>
          <table class="batting-table">
            <thead><tr><th></th><th>ab</th><th>r</th><th>h</th><th>bi</th></tr></thead>
            <tbody>${renderBatterRows(homeBs)}</tbody>
          </table>
        </div>
      </div>
      <div class="linescore-section">
        <table class="linescore-tbl">
          <thead><tr><th></th>${innHdr}<th class="sep">R</th><th>H</th><th>E</th></tr></thead>
          <tbody>
            <tr>
              <td>${h(teamAbbr(away.team.name))}${awayWon?' ✓':''}</td>
              ${innCells('away')}
              <td class="sep">${awayRuns}</td><td>${awayH}</td><td>${awayE}</td>
            </tr>
            <tr>
              <td>${h(teamAbbr(home.team.name))}${homeWon?' ✓':''}</td>
              ${innCells('home')}
              <td class="sep">${homeRuns}</td><td>${homeH}</td><td>${homeE}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="pitching-section">
        <div class="pitching-label">${h(away.team.name.toUpperCase())}</div>
        <table class="pitching-tbl">
          <thead><tr><th></th><th>ip</th><th>h</th><th>r</th><th>er</th><th>bb</th><th>so</th></tr></thead>
          <tbody>${renderPitcherRows(awayBs, game.decisions)}</tbody>
        </table>
        <div class="pitching-label" style="margin-top:5px">${h(home.team.name.toUpperCase())}</div>
        <table class="pitching-tbl">
          <thead><tr><th></th><th>ip</th><th>h</th><th>r</th><th>er</th><th>bb</th><th>so</th></tr></thead>
          <tbody>${renderPitcherRows(homeBs, game.decisions)}</tbody>
        </table>
      </div>
      ${notes ? `<div class="game-notes">${notes}</div>` : ''}
    </div>`;
}

function renderScores(schedule) {
  const dates = schedule.dates || [];
  if (!dates.length || !dates[0].games?.length) {
    return '<div class="loading">No games scheduled for this date.</div>';
  }

  const games = [...dates[0].games].sort((a,b) =>
    (isFeatured(a) ? -1 : isFeatured(b) ? 1 : a.gamePk - b.gamePk)
  );

  let featuredHtml = '', otherCards = '', firstDone = false;
  for (const game of games) {
    const feat = !firstDone && isFeatured(game);
    if (feat) { featuredHtml = renderBoxScore(game, true); firstDone = true; }
    else       { otherCards += renderBoxScore(game, false); firstDone = true; }
  }

  return `<div class="scores-layout">
    ${featuredHtml}
    ${otherCards ? `<div class="other-games-grid">${otherCards}</div>` : ''}
  </div>`;
}

// ── STANDINGS ─────────────────────────────────────────────────────────────────

// Division IDs as returned by the MLB Stats API
const DIVISION_NAMES = {201:'AL East',202:'AL Central',200:'AL West',204:'NL East',205:'NL Central',203:'NL West'};
const DIVISION_ORDER = [201,202,200,204,205,203];

function renderStandings(standings) {
  const divMap = {};
  for (const rec of (standings.records || [])) {
    const id = rec.division?.id;
    if (id != null) divMap[id] = rec.teamRecords || [];
  }

  let html = '<div class="standings-grid">';
  for (const divId of DIVISION_ORDER) {
    const teams = divMap[divId];
    if (!teams) continue;
    let rows = '';
    teams.forEach((t, i) => {
      const rec = t.leagueRecord;
      const gb  = (!t.gamesBack || t.gamesBack==='-' || t.gamesBack==='0') ? '—' : t.gamesBack;
      rows += `<tr class="${i===0?'div-leader':''}">
        <td>${h(teamAbbr(t.team.name))}</td>
        <td>${rec.wins}</td><td>${rec.losses}</td><td>${gb}</td><td>${winPct(rec.wins,rec.losses)}</td>
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
  return html + '</div>';
}

// ── LEADERS ───────────────────────────────────────────────────────────────────

function renderLeadersBlock(title, leaders, fmt) {
  const ranks = ['1.','2.','3.','4.','5.','6.','7.','8.','9.','10.'];
  const rows = (leaders||[]).slice(0,10).map((l,i) => `<tr>
    <td><span class="rank">${ranks[i]}</span>${h(l.person?.fullName||'—')} <span class="player-team">${h(l.team?.abbreviation||'')}</span></td>
    <td>${h(fmt(l.value))}</td>
  </tr>`).join('');
  return `<div class="leaders-block">
    <div class="leaders-hed">${title}</div>
    <table class="leaders-tbl"><tbody>${rows}</tbody></table>
  </div>`;
}

function renderLeagueSection(leagueName, hitting, pitching) {
  function extract(data, cat) {
    return (data.leagueLeaders||[]).find(c=>c.leaderCategory===cat)?.leaders || [];
  }
  const ba   = extract(hitting,  'battingAverage');
  const hr   = extract(hitting,  'homeRuns');
  const rbi  = extract(hitting,  'rbi');
  const wins = extract(pitching, 'wins');
  const sv   = extract(pitching, 'saves');
  const so   = extract(pitching, 'strikeouts');

  return `<div class="league-section">
    <div class="league-section-hed">${leagueName}</div>
    <div class="leaders-row">
      ${renderLeadersBlock('Batting Average', ba,   formatAvg)}
      ${renderLeadersBlock('Home Runs',       hr,   v=>v)}
      ${renderLeadersBlock('RBI',             rbi,  v=>v)}
    </div>
    <div class="leaders-row">
      ${renderLeadersBlock('Wins',            wins, v=>v)}
      ${renderLeadersBlock('Saves',           sv,   v=>v)}
      ${renderLeadersBlock('Strikeouts',      so,   v=>v)}
    </div>
  </div>`;
}

function renderLeaders(alHit, nlHit, alPit, nlPit) {
  return `<div class="league-leaders-layout">
    ${renderLeagueSection('American League Leaders', alHit, alPit)}
    ${renderLeagueSection('National League Leaders', nlHit, nlPit)}
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
.other-games-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.box-full{border:1px solid var(--rule)}.box-full.featured{border-width:2px}
.box-header{background:var(--ink);color:var(--paper);font-family:'Playfair Display SC',serif;font-size:10px;letter-spacing:.1em;padding:3px 8px;display:flex;justify-content:space-between}
.batting-columns{display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid var(--rule)}
.batting-col+.batting-col{border-left:1px solid var(--rule)}
.team-label{font-family:'Playfair Display SC',serif;font-size:9px;letter-spacing:.1em;padding:2px 5px;background:var(--paper-dark);border-bottom:1px solid var(--rule)}
.batting-table{width:100%;border-collapse:collapse;font-size:10.5px}
.batting-table th{font-family:'Playfair Display SC',serif;font-weight:400;font-size:8px;letter-spacing:.08em;padding:1px 3px;text-align:right;color:var(--faint);border-bottom:1px solid var(--faint2)}
.batting-table th:first-child{text-align:left}
.batting-table td{padding:1px 3px;text-align:right;border-bottom:1px dotted #d8cfbc}
.batting-table td:first-child{text-align:left;white-space:nowrap;overflow:hidden;max-width:145px}
.batting-table tr.totals-row td{border-top:1px solid var(--rule);border-bottom:none;font-weight:700;background:var(--paper-dark)}
.batting-table tr.totals-row td:first-child{font-size:8.5px;letter-spacing:.05em}
.pos-abbr{font-size:8.5px;color:var(--faint);margin-right:2px}
.linescore-section{padding:4px 8px;border-bottom:1px solid var(--rule)}
.linescore-tbl{width:100%;border-collapse:collapse;font-size:11px}
.linescore-tbl th{font-family:'Playfair Display SC',serif;font-weight:400;font-size:8px;letter-spacing:.06em;color:var(--faint);text-align:center;padding:0 2px;border-bottom:1px solid var(--faint2)}
.linescore-tbl th:first-child{text-align:left;width:100px}
.linescore-tbl td{text-align:center;padding:1px 2px}.linescore-tbl td:first-child{text-align:left;font-weight:700}
.linescore-tbl td.sep{border-left:1px solid var(--rule);font-weight:700}.linescore-tbl td.x{color:var(--faint)}
.pitching-section{padding:4px 8px;border-bottom:1px solid var(--rule)}
.pitching-label{font-family:'Playfair Display SC',serif;font-size:8.5px;letter-spacing:.1em;color:var(--faint);margin-bottom:2px}
.pitching-tbl{width:100%;border-collapse:collapse;font-size:10.5px}
.pitching-tbl th{font-family:'Playfair Display SC',serif;font-weight:400;font-size:8px;letter-spacing:.08em;color:var(--faint);text-align:right;padding:0 3px;border-bottom:1px solid var(--faint2)}
.pitching-tbl th:first-child{text-align:left}
.pitching-tbl td{padding:1px 3px;text-align:right;border-bottom:1px dotted #d8cfbc}.pitching-tbl td:first-child{text-align:left}.pitching-tbl tr:last-child td{border-bottom:none}
.game-notes{padding:4px 8px;font-size:10px;line-height:1.55}
.note-label{font-weight:700;font-size:9px}
.standings-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.div-block{border:1px solid var(--rule)}
.div-hed{background:var(--ink);color:var(--paper);font-family:'Playfair Display SC',serif;font-size:10px;letter-spacing:.1em;padding:3px 8px;text-align:center}
.standings-tbl{width:100%;border-collapse:collapse;font-size:11.5px}
.standings-tbl th{font-family:'Playfair Display SC',serif;font-weight:400;font-size:8.5px;letter-spacing:.1em;padding:2px 6px;border-bottom:1px solid var(--rule);color:var(--faint)}
.standings-tbl th:first-child{text-align:left}.standings-tbl th:not(:first-child){text-align:right}
.standings-tbl td{padding:2px 6px;border-bottom:1px dotted #d4c9b0}.standings-tbl td:first-child{font-weight:700}.standings-tbl td:not(:first-child){text-align:right}
.standings-tbl tr.div-leader td:first-child{border-left:3px solid var(--ink);padding-left:3px}
.standings-tbl tr:last-child td{border-bottom:none}
.league-leaders-layout{display:flex;flex-direction:column;gap:14px}
.league-section{border:1px solid var(--rule)}
.league-section-hed{background:var(--ink);color:var(--paper);font-family:'Playfair Display SC',serif;font-size:11px;letter-spacing:.18em;padding:4px 10px;text-align:center}
.leaders-row{display:grid;grid-template-columns:repeat(3,1fr)}.leaders-row+.leaders-row{border-top:1px solid var(--rule)}
.leaders-block+.leaders-block{border-left:1px solid var(--rule)}
.leaders-hed{font-family:'Playfair Display SC',serif;font-size:9.5px;letter-spacing:.12em;padding:3px 8px;background:var(--paper-dark);border-bottom:1px solid var(--faint2);color:var(--ink)}
.leaders-tbl{width:100%;border-collapse:collapse;font-size:11px}
.leaders-tbl td{padding:2px 8px;border-bottom:1px dotted #d4c9b0}.leaders-tbl td:last-child{text-align:right;font-weight:700;white-space:nowrap}
.leaders-tbl tr:last-child td{border-bottom:none}
.rank{font-family:'Playfair Display SC',serif;font-size:8.5px;color:var(--faint);margin-right:3px}
.player-team{font-size:9px;color:var(--faint);font-style:italic}
.paper-footer{border-top:3px double var(--rule);text-align:center;font-size:9px;color:var(--faint);padding:8px;font-style:italic;letter-spacing:.05em}
@media(max-width:700px){.masthead-name{font-size:48px}.standings-grid{grid-template-columns:1fr 1fr}.other-games-grid{grid-template-columns:1fr}.batting-columns{grid-template-columns:1fr}.batting-col+.batting-col{border-left:none;border-top:1px solid var(--rule)}.leaders-row{grid-template-columns:1fr}.leaders-block+.leaders-block{border-left:none;border-top:1px solid var(--rule)}}
`;

// ── HTML TEMPLATE ─────────────────────────────────────────────────────────────

const DAYS   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function formatDisplayDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m-1, d);
  return `${DAYS[dt.getDay()]}, ${MONTHS[m-1]} ${d}, ${y}`;
}

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m-1, d+n).toISOString().split('T')[0];
}

function buildHTML({ scoresHtml, standingsHtml, leadersHtml }) {
  const gameDate = formatDisplayDate(DATE);
  const pubDate  = formatDisplayDate(addDays(DATE, 1));
  const [y, m, d] = DATE.split('-').map(Number);
  const dayOfYear = Math.floor((new Date(y,m-1,d) - new Date(y,0,0)) / 86400000);

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
      <span>VOL. CLIV . . . No. ${dayOfYear}</span>
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
    <h2 class="section-hed">${DAYS[new Date(y,m-1,d).getDay()]}'s Scores &amp; Box Scores</h2>
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
  const { schedule, standings, alHit, nlHit, alPit, nlPit } = await fetchAll();

  const scoresHtml   = renderScores(schedule);
  const standingsHtml = renderStandings(standings);
  const leadersHtml  = renderLeaders(alHit, nlHit, alPit, nlPit);

  const html = buildHTML({ scoresHtml, standingsHtml, leadersHtml });

  const outDir = join(__dirname, '..', 'papers');
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `${DATE}.html`);
  writeFileSync(outFile, html, 'utf8');
  console.log(`✓ Written: papers/${DATE}.html`);
}

main().catch(err => { console.error(err); process.exit(1); });
