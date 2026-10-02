#!/usr/bin/env node
/**
 * The Baseball Gazette — Paper Generator
 *
 * Section order: Standings → Box Scores → Leaders → Today's Matchups
 * Box scores: uniform 2-col grid, no featured/special treatment.
 * Pitching: 2-col layout aligned with batting team labels.
 * Game notes: classic baseball notes only (2B, 3B, HR, etc.) + T and A.
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

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m-1, d+n).toISOString().split('T')[0];
}

const DATE          = process.argv[2] || getYesterday();
const MATCHUPS_DATE = addDays(DATE, 1);
const MLB           = 'https://statsapi.mlb.com/api/v1';

const AL_TEAMS = new Set([108,110,111,114,116,117,118,133,136,139,140,141,142,145,147]);

// ── FETCH ─────────────────────────────────────────────────────────────────────

async function get(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json();
}

async function fetchAll() {
  console.log(`Fetching box scores for ${DATE}, matchups for ${MATCHUPS_DATE}…`);

  const schedule = await get(
    `${MLB}/schedule?sportId=1&date=${DATE}&hydrate=linescore,decisions`
  );
  const games = schedule.dates?.[0]?.games || [];

  // Boxscores fetched separately — the schedule hydrate=boxscore doesn't embed stats
  const boxscores = await Promise.all(
    games.map(g => get(`${MLB}/game/${g.gamePk}/boxscore`).catch(() => null))
  );
  games.forEach((g, i) => { g._boxscore = boxscores[i]; });

  // Today's matchups (publication day)
  const matchupsSchedule = await get(
    `${MLB}/schedule?sportId=1&date=${MATCHUPS_DATE}&hydrate=probablePitcher`
  ).catch(() => null);
  const matchupGames = matchupsSchedule?.dates?.[0]?.games || [];

  // Batch pitcher stats for matchups
  const pitcherIds = new Set();
  for (const g of matchupGames) {
    if (g.teams.away.probablePitcher?.id) pitcherIds.add(g.teams.away.probablePitcher.id);
    if (g.teams.home.probablePitcher?.id) pitcherIds.add(g.teams.home.probablePitcher.id);
  }
  const pitcherStats = {};
  if (pitcherIds.size > 0) {
    try {
      const sd = await get(
        `${MLB}/stats?stats=season&playerIds=${[...pitcherIds].join(',')}&group=pitching&season=2025`
      );
      for (const split of (sd.stats?.[0]?.splits || [])) {
        pitcherStats[split.player?.id] = { wins: split.stat?.wins??0, losses: split.stat?.losses??0 };
      }
    } catch { /* optional */ }
  }

  const [standings, alHit, nlHit, alPit, nlPit] = await Promise.all([
    get(`${MLB}/standings?leagueId=103,104&season=2025&standingsType=regularSeason&date=${DATE}&hydrate=team`),
    get(`${MLB}/stats/leaders?leaderCategories=battingAverage,homeRuns,runsBattedIn&season=2025&limit=10&statGroup=hitting&sportId=1&leagueId=103`),
    get(`${MLB}/stats/leaders?leaderCategories=battingAverage,homeRuns,runsBattedIn&season=2025&limit=10&statGroup=hitting&sportId=1&leagueId=104`),
    get(`${MLB}/stats/leaders?leaderCategories=wins,saves,strikeouts&season=2025&limit=10&statGroup=pitching&sportId=1&leagueId=103`),
    get(`${MLB}/stats/leaders?leaderCategories=wins,saves,strikeouts&season=2025&limit=10&statGroup=pitching&sportId=1&leagueId=104`),
  ]);

  return { games, matchupGames, pitcherStats, standings, alHit, nlHit, alPit, nlPit };
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

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

function formatGameTime(utcStr) {
  try {
    const dt = new Date(utcStr);
    return dt.toLocaleTimeString('en-US', {
      hour:'numeric', minute:'2-digit', hour12:true, timeZone:'America/Los_Angeles'
    }).replace('AM','a.m.').replace('PM','p.m.');
  } catch { return ''; }
}

function h(str) {
  return String(str??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Game notes: keep only classic baseball notes + time and attendance.
function isExcludedNote(label) {
  const l = label.toLowerCase();
  return l.startsWith('pitch') || l.startsWith('ground') || l.startsWith('batter') ||
         l.startsWith('inherited') || l.startsWith('umpire') ||
         l === 'weather' || l === 'wind' || l === 'first pitch' || l === 'venue';
}

// ── MATCHUPS ──────────────────────────────────────────────────────────────────

function renderMatchups(matchupGames, pitcherStats) {
  if (!matchupGames.length) return '<div class="loading">No games scheduled.</div>';

  function pitcherLabel(pp) {
    if (!pp) return 'TBD';
    const rec = pitcherStats[pp.id];
    const lastName = (pp.fullName||'').split(' ').slice(1).join(' ') || pp.fullName;
    return rec ? `${lastName} ${rec.wins}-${rec.losses}` : lastName;
  }

  function gameLines(games) {
    return games.map(g => {
      const away=g.teams.away, home=g.teams.home;
      const time=g.gameDate?formatGameTime(g.gameDate):'';
      return `<div class="matchup-line">
        <span class="matchup-teams">${h(teamAbbr(away.team.name))} (${h(pitcherLabel(away.probablePitcher))}) at ${h(teamAbbr(home.team.name))} (${h(pitcherLabel(home.probablePitcher))})</span>
        ${time?`<span class="matchup-time">${time} PT</span>`:''}
      </div>`;
    }).join('');
  }

  const alGames = matchupGames.filter(g =>  AL_TEAMS.has(g.teams.home.team.id));
  const nlGames = matchupGames.filter(g => !AL_TEAMS.has(g.teams.home.team.id));

  let html = '<div class="matchups-layout">';
  if (alGames.length) html += `<div class="matchup-league"><div class="matchup-league-hed">American League</div>${gameLines(alGames)}</div>`;
  if (nlGames.length) html += `<div class="matchup-league"><div class="matchup-league-hed">National League</div>${gameLines(nlGames)}</div>`;
  return html + '</div>';
}

// ── BOX SCORES ────────────────────────────────────────────────────────────────

function renderBatterRows(teamBs) {
  const batters=teamBs.batters||[], players=teamBs.players||{};
  let totAb=0,totR=0,totH=0,totBi=0,html='';
  for (const id of batters) {
    const p=players[`ID${id}`]; if (!p) continue;
    const s=p.stats?.batting||{};
    const pos=p.position?.abbreviation||'';
    const isSub=(parseInt(p.battingOrder||'0')%100)!==0;
    const ab=s.atBats??0,r=s.runs??0,ht=s.hits??0,bi=s.rbi??0;
    totAb+=ab;totR+=r;totH+=ht;totBi+=bi;
    html+=`<tr class="${isSub?'sub-row':''}">
      <td><span class="pos-abbr">${h(pos)}</span>${h(shortName(p.person?.fullName))}</td>
      <td>${ab}</td><td>${r}</td><td>${ht}</td><td>${bi}</td>
    </tr>`;
  }
  return html+`<tr class="totals-row"><td>Totals</td><td>${totAb}</td><td>${totR}</td><td>${totH}</td><td>${totBi}</td></tr>`;
}

function renderPitcherRows(teamBs, decisions) {
  const pitchers=teamBs.pitchers||[], players=teamBs.players||{};
  const wId=decisions?.winner?.id, lId=decisions?.loser?.id, sId=decisions?.save?.id;
  return pitchers.map(id => {
    const p=players[`ID${id}`]; if (!p) return '';
    const s=p.stats?.pitching||{};
    let name=shortName(p.person?.fullName);
    if (id===wId) name+=' W'; else if (id===lId) name+=' L'; else if (id===sId) name+=' S';
    return `<tr>
      <td>${h(name)}</td>
      <td>${s.inningsPitched??'0.0'}</td><td>${s.hits??0}</td><td>${s.runs??0}</td>
      <td>${s.earnedRuns??0}</td><td>${s.baseOnBalls??0}</td><td>${s.strikeOuts??0}</td>
    </tr>`;
  }).join('');
}

function buildGameNotes(bs) {
  const info=bs.info||[];
  const notes=info
    .filter(n=>n.label&&n.value&&!isExcludedNote(n.label)&&n.label!=='T'&&n.label!=='A')
    .map(n=>`<span class="note-label">${h(n.label)}—</span>${h(n.value)}`);
  const tE=info.find(n=>n.label==='T'), aE=info.find(n=>n.label==='A');
  const meta=[];
  if (tE) meta.push(`T—${h(tE.value)}`);
  if (aE) meta.push(`A—${Number(aE.value.replace(/,/g,'')).toLocaleString()}`);
  if (meta.length) notes.push(meta.join('. '));
  return notes.join(' ');
}

function renderBoxScore(game) {
  const t=game.teams, away=t.away, home=t.home;
  const bs=game._boxscore||{}, ls=game.linescore||{};
  const innings=ls.innings||[];
  const status=game.status?.detailedState||'';
  const isOver=status.startsWith('Final');
  const awayRuns=away.score??0, homeRuns=home.score??0;
  const awayWon=isOver&&awayRuns>homeRuns, homeWon=isOver&&homeRuns>awayRuns;
  const numInn=Math.max(9,innings.length);
  const venue=game.venue?.name||'';
  const awayBs=bs.teams?.away||{}, homeBs=bs.teams?.home||{};

  let innHdr='';
  for (let i=1;i<=numInn;i++) innHdr+=`<th>${i}</th>`;

  function innCells(key) {
    let out='';
    for (let i=0;i<numInn;i++) {
      const inn=innings[i];
      const v=inn?(inn[key]?.runs??'·'):(key==='home'&&isOver&&homeWon?'x':'·');
      out+=`<td class="${v==='x'?'x':''}">${v}</td>`;
    }
    return out;
  }

  const awayH=ls.teams?.away?.hits??'–', homeH=ls.teams?.home?.hits??'–';
  const awayE=ls.teams?.away?.errors??'–', homeE=ls.teams?.home?.errors??'–';
  const notes=buildGameNotes(bs);

  return `
    <div class="box-full">
      <div class="box-header">
        <span>${h(away.team.name)} at ${h(home.team.name)}</span>
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
        <div class="pitching-columns">
          <div class="pitching-col">
            <div class="team-label">${h(away.team.name.toUpperCase())}</div>
            <table class="pitching-tbl">
              <thead><tr><th></th><th>ip</th><th>h</th><th>r</th><th>er</th><th>bb</th><th>so</th></tr></thead>
              <tbody>${renderPitcherRows(awayBs, game.decisions)}</tbody>
            </table>
          </div>
          <div class="pitching-col">
            <div class="team-label">${h(home.team.name.toUpperCase())}</div>
            <table class="pitching-tbl">
              <thead><tr><th></th><th>ip</th><th>h</th><th>r</th><th>er</th><th>bb</th><th>so</th></tr></thead>
              <tbody>${renderPitcherRows(homeBs, game.decisions)}</tbody>
            </table>
          </div>
        </div>
      </div>
      ${notes?`<div class="game-notes">${notes}</div>`:''}
    </div>`;
}

function renderScores(games) {
  if (!games.length) return '<div class="loading">No games scheduled for this date.</div>';
  const alGames=games.filter(g =>  AL_TEAMS.has(g.teams.home.team.id)).sort((a,b)=>a.gamePk-b.gamePk);
  const nlGames=games.filter(g => !AL_TEAMS.has(g.teams.home.team.id)).sort((a,b)=>a.gamePk-b.gamePk);

  function leagueSection(lg, label) {
    if (!lg.length) return '';
    return `<div class="league-subsection">
      <div class="league-subsection-hed">${label}</div>
      <div class="games-grid">${lg.map(renderBoxScore).join('')}</div>
    </div>`;
  }

  return `<div class="scores-layout">
    ${leagueSection(alGames,'American League')}
    ${leagueSection(nlGames,'National League')}
  </div>`;
}

// ── STANDINGS ─────────────────────────────────────────────────────────────────

const DIVISION_NAMES={201:'AL East',202:'AL Central',200:'AL West',204:'NL East',205:'NL Central',203:'NL West'};
const DIVISION_ORDER=[201,202,200,204,205,203];

function renderStandings(standings) {
  const divMap={};
  for (const rec of (standings.records||[])) if (rec.division?.id!=null) divMap[rec.division.id]=rec.teamRecords||[];
  let html='<div class="standings-grid">';
  for (const divId of DIVISION_ORDER) {
    const teams=divMap[divId]; if (!teams) continue;
    let rows='';
    teams.forEach((t,i)=>{
      const rec=t.leagueRecord;
      const gb=(!t.gamesBack||t.gamesBack==='-'||t.gamesBack==='0')?'—':t.gamesBack;
      rows+=`<tr class="${i===0?'div-leader':''}">
        <td>${h(teamAbbr(t.team.name))}</td>
        <td>${rec.wins}</td><td>${rec.losses}</td><td>${gb}</td><td>${winPct(rec.wins,rec.losses)}</td>
      </tr>`;
    });
    html+=`<div class="div-block">
      <div class="div-hed">${DIVISION_NAMES[divId]}</div>
      <table class="standings-tbl">
        <thead><tr><th>Club</th><th>W</th><th>L</th><th>GB</th><th>Pct</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }
  return html+'</div>';
}

// ── LEADERS ───────────────────────────────────────────────────────────────────

function renderLeadersBlock(title, leaders, fmt) {
  const ranks=['1.','2.','3.','4.','5.','6.','7.','8.','9.','10.'];
  const rows=(leaders||[]).slice(0,10).map((l,i)=>`<tr>
    <td><span class="rank">${ranks[i]}</span>${h(l.person?.fullName||'—')} <span class="player-team">${h(l.team?.abbreviation||'')}</span></td>
    <td>${h(fmt(l.value))}</td>
  </tr>`).join('');
  return `<div class="leaders-block"><div class="leaders-hed">${title}</div><table class="leaders-tbl"><tbody>${rows}</tbody></table></div>`;
}

function renderLeagueSection(leagueName, hitting, pitching) {
  function extract(data,cat){return (data.leagueLeaders||[]).find(c=>c.leaderCategory===cat)?.leaders||[];}
  return `<div class="league-section">
    <div class="league-section-hed">${leagueName}</div>
    <div class="leaders-row">
      ${renderLeadersBlock('Batting Average',extract(hitting,'battingAverage'),formatAvg)}
      ${renderLeadersBlock('Home Runs',extract(hitting,'homeRuns'),v=>v)}
      ${renderLeadersBlock('RBI',extract(hitting,'runsBattedIn'),v=>v)}
    </div>
    <div class="leaders-row">
      ${renderLeadersBlock('Wins',extract(pitching,'wins'),v=>v)}
      ${renderLeadersBlock('Saves',extract(pitching,'saves'),v=>v)}
      ${renderLeadersBlock('Strikeouts',extract(pitching,'strikeouts'),v=>v)}
    </div>
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
.standings-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.div-block{border:1px solid var(--rule)}
.div-hed{background:var(--ink);color:var(--paper);font-family:'Playfair Display SC',serif;font-size:10px;letter-spacing:.1em;padding:3px 8px;text-align:center}
.standings-tbl{width:100%;border-collapse:collapse;font-size:11.5px}
.standings-tbl th{font-family:'Playfair Display SC',serif;font-weight:400;font-size:8.5px;letter-spacing:.1em;padding:2px 6px;border-bottom:1px solid var(--rule);color:var(--faint)}
.standings-tbl th:first-child{text-align:left}.standings-tbl th:not(:first-child){text-align:right}
.standings-tbl td{padding:2px 6px;border-bottom:1px dotted #d4c9b0}.standings-tbl td:first-child{font-weight:700}.standings-tbl td:not(:first-child){text-align:right}
.standings-tbl tr.div-leader td:first-child{border-left:3px solid var(--ink);padding-left:3px}
.standings-tbl tr:last-child td{border-bottom:none}
.scores-layout{display:flex;flex-direction:column;gap:18px}
.league-subsection{display:flex;flex-direction:column;gap:12px}
.league-subsection-hed{font-family:'Playfair Display SC',serif;font-size:10px;letter-spacing:.2em;color:var(--faint);padding:4px 0 3px;border-top:1px solid var(--faint2);border-bottom:1px solid var(--faint2)}
.games-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.box-full{border:1px solid var(--rule)}
.box-header{background:var(--ink);color:var(--paper);font-family:'Playfair Display SC',serif;font-size:10px;letter-spacing:.1em;padding:3px 8px;display:flex;justify-content:space-between}
.batting-columns{display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid var(--rule)}
.batting-col+.batting-col{border-left:1px solid var(--rule)}
.team-label{font-family:'Playfair Display SC',serif;font-size:9px;letter-spacing:.1em;padding:2px 5px;background:var(--paper-dark);border-bottom:1px solid var(--rule)}
.batting-table{width:100%;border-collapse:collapse;font-size:10.5px}
.batting-table th{font-family:'Playfair Display SC',serif;font-weight:400;font-size:8px;letter-spacing:.08em;padding:1px 3px;text-align:right;color:var(--faint);border-bottom:1px solid var(--faint2)}
.batting-table th:first-child{text-align:left}
.batting-table td{padding:1px 3px;text-align:right;border-bottom:1px dotted #d8cfbc}
.batting-table td:first-child{text-align:left;white-space:nowrap;overflow:hidden;max-width:130px}
.batting-table tr.totals-row td{border-top:1px solid var(--rule);border-bottom:none;font-weight:700;background:var(--paper-dark)}
.batting-table tr.totals-row td:first-child{font-size:8.5px}
.batting-table tr.sub-row td:first-child{padding-left:10px}
.pos-abbr{font-size:8.5px;color:var(--faint);margin-right:2px}
.linescore-section{padding:4px 8px;border-bottom:1px solid var(--rule)}
.linescore-tbl{width:100%;border-collapse:collapse;font-size:11px}
.linescore-tbl th{font-family:'Playfair Display SC',serif;font-weight:400;font-size:8px;letter-spacing:.06em;color:var(--faint);text-align:center;padding:0 2px;border-bottom:1px solid var(--faint2)}
.linescore-tbl th:first-child{text-align:left;width:90px}
.linescore-tbl td{text-align:center;padding:1px 2px}.linescore-tbl td:first-child{text-align:left;font-weight:700}
.linescore-tbl td.sep{border-left:1px solid var(--rule);font-weight:700}.linescore-tbl td.x{color:var(--faint)}
.pitching-section{border-bottom:1px solid var(--rule)}
.pitching-columns{display:grid;grid-template-columns:1fr 1fr}
.pitching-col{padding:4px 5px}.pitching-col+.pitching-col{border-left:1px solid var(--rule)}
.pitching-tbl{width:100%;border-collapse:collapse;font-size:10.5px}
.pitching-tbl th{font-family:'Playfair Display SC',serif;font-weight:400;font-size:8px;letter-spacing:.08em;color:var(--faint);text-align:right;padding:0 3px;border-bottom:1px solid var(--faint2)}
.pitching-tbl th:first-child{text-align:left}
.pitching-tbl td{padding:1px 3px;text-align:right;border-bottom:1px dotted #d8cfbc}.pitching-tbl td:first-child{text-align:left}.pitching-tbl tr:last-child td{border-bottom:none}
.game-notes{padding:4px 8px;font-size:10px;line-height:1.6}
.note-label{font-weight:700;font-size:9px}
.league-leaders-layout{display:flex;flex-direction:column;gap:14px}
.league-section{border:1px solid var(--rule)}
.league-section-hed{background:var(--ink);color:var(--paper);font-family:'Playfair Display SC',serif;font-size:11px;letter-spacing:.18em;padding:4px 10px;text-align:center}
.leaders-row{display:grid;grid-template-columns:repeat(3,1fr)}.leaders-row+.leaders-row{border-top:1px solid var(--rule)}
.leaders-block+.leaders-block{border-left:1px solid var(--rule)}
.leaders-hed{font-family:'Playfair Display SC',serif;font-size:9.5px;letter-spacing:.12em;padding:3px 8px;background:var(--paper-dark);border-bottom:1px solid var(--faint2)}
.leaders-tbl{width:100%;border-collapse:collapse;font-size:11px}
.leaders-tbl td{padding:2px 8px;border-bottom:1px dotted #d4c9b0}.leaders-tbl td:last-child{text-align:right;font-weight:700;white-space:nowrap}
.leaders-tbl tr:last-child td{border-bottom:none}
.rank{font-family:'Playfair Display SC',serif;font-size:8.5px;color:var(--faint);margin-right:3px}
.player-team{font-size:9px;color:var(--faint);font-style:italic}
.matchups-layout{display:flex;flex-direction:column;gap:0}
.matchup-league-hed{font-family:'Playfair Display SC',serif;font-size:9.5px;letter-spacing:.18em;color:var(--faint);padding:6px 0 3px;border-bottom:1px solid var(--faint2);margin-bottom:4px}
.matchup-league{margin-bottom:10px}
.matchup-line{font-size:11.5px;padding:2px 0;border-bottom:1px dotted #d4c9b0;display:flex;justify-content:space-between;gap:8px}
.matchup-line:last-child{border-bottom:none}
.matchup-teams{flex:1}.matchup-time{white-space:nowrap;color:var(--faint);font-size:10.5px}
.paper-footer{border-top:3px double var(--rule);text-align:center;font-size:9px;color:var(--faint);padding:8px;font-style:italic;letter-spacing:.05em}
@media(max-width:700px){.masthead-name{font-size:48px}.standings-grid{grid-template-columns:1fr 1fr}.games-grid{grid-template-columns:1fr}.batting-columns,.pitching-columns{grid-template-columns:1fr}.batting-col+.batting-col,.pitching-col+.pitching-col{border-left:none;border-top:1px solid var(--rule)}.leaders-row{grid-template-columns:1fr}.leaders-block+.leaders-block{border-left:none;border-top:1px solid var(--rule)}}
`;

// ── HTML TEMPLATE ─────────────────────────────────────────────────────────────

const DAYS   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function formatDisplayDate(dateStr) {
  const [y,m,d]=dateStr.split('-').map(Number);
  const dt=new Date(y,m-1,d);
  return `${DAYS[dt.getDay()]}, ${MONTHS[m-1]} ${d}, ${y}`;
}

function buildHTML({ matchupsHtml, scoresHtml, standingsHtml, leadersHtml }) {
  const gameDate   = formatDisplayDate(DATE);
  const pubDate    = formatDisplayDate(MATCHUPS_DATE);
  const [y,m,d]   = DATE.split('-').map(Number);
  const dayOfYear  = Math.floor((new Date(y,m-1,d)-new Date(y,0,0))/86400000);
  const dayName    = DAYS[new Date(y,m-1,d).getDay()];

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
    <h2 class="section-hed">Standings — Through ${gameDate}</h2>
    ${standingsHtml}
  </section>

  <section class="section">
    <h2 class="section-hed">${dayName}'s Scores &amp; Box Scores</h2>
    ${scoresHtml}
  </section>

  <section class="section">
    <h2 class="section-hed">League Leaders</h2>
    ${leadersHtml}
  </section>

  <section class="section">
    <h2 class="section-hed">Today's Matchups — ${formatDisplayDate(MATCHUPS_DATE)}</h2>
    ${matchupsHtml}
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
  const { games, matchupGames, pitcherStats, standings, alHit, nlHit, alPit, nlPit } = await fetchAll();

  const html = buildHTML({
    matchupsHtml:  renderMatchups(matchupGames, pitcherStats),
    scoresHtml:    renderScores(games),
    standingsHtml: renderStandings(standings),
    leadersHtml:   `<div class="league-leaders-layout">
      ${renderLeagueSection('American League Leaders', alHit, alPit)}
      ${renderLeagueSection('National League Leaders', nlHit, nlPit)}
    </div>`,
  });

  const outDir = join(__dirname, '..', 'papers');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `${DATE}.html`), html, 'utf8');
  console.log(`✓ Written: papers/${DATE}.html`);
}

main().catch(err => { console.error(err); process.exit(1); });
