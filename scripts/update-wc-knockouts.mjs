/**
 * Scrapes the FIFA World Cup 2026 fixtures page and updates the knockout round
 * entries in data/WCfixtures.json with the actual qualified team names.
 *
 * Run on or after 28 June 2026 once all group stage results are confirmed:
 *   node scripts/update-wc-knockouts.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = join(__dirname, '../data/WCfixtures.json');
const FIFA_URL = 'https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/scores-fixtures?country=GB&wtw-filter=ALL';

/** Map FIFA 3-letter codes to full team names */
const TEAM_NAMES = {
  MEX: 'Mexico', RSA: 'South Africa', KOR: 'Korea Republic', CZE: 'Czechia',
  CAN: 'Canada', BIH: 'Bosnia and Herzegovina', USA: 'USA', PAR: 'Paraguay',
  QAT: 'Qatar', SUI: 'Switzerland', BRA: 'Brazil', MAR: 'Morocco',
  HAI: 'Haiti', SCO: 'Scotland', AUS: 'Australia', TUR: 'Türkiye',
  GER: 'Germany', CUW: 'Curaçao', NED: 'Netherlands', JPN: 'Japan',
  CIV: "Côte d'Ivoire", ECU: 'Ecuador', SWE: 'Sweden', TUN: 'Tunisia',
  ESP: 'Spain', CPV: 'Cabo Verde', BEL: 'Belgium', EGY: 'Egypt',
  KSA: 'Saudi Arabia', URU: 'Uruguay', IRN: 'Iran', NZL: 'New Zealand',
  FRA: 'France', SEN: 'Senegal', IRQ: 'Iraq', NOR: 'Norway',
  ARG: 'Argentina', ALG: 'Algeria', AUT: 'Austria', JOR: 'Jordan',
  POR: 'Portugal', COD: 'Congo DR', ENG: 'England', CRO: 'Croatia',
  GHA: 'Ghana', PAN: 'Panama', UZB: 'Uzbekistan', COL: 'Colombia',
};

/** Convert 24h time string (e.g. "20:00") to display format (e.g. "8pm") */
function formatTime(time24) {
  const [h, m] = time24.split(':').map(Number);
  const suffix = h < 12 ? 'am' : 'pm';
  const hour = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${hour}${suffix}` : `${hour}.${String(m).padStart(2, '0')}${suffix}`;
}

/** Convert "Thursday 11 June 2026" → "Thursday, June 11" */
function formatDate(dayString) {
  const parts = dayString.trim().split(/\s+/);
  // parts: [DayOfWeek, Day, Month, Year]
  if (parts.length === 4) {
    return `${parts[0]}, ${parts[2]} ${parseInt(parts[1], 10)}`;
  }
  return dayString;
}

/** Parse a raw match text block from the FIFA page into structured data */
function parseMatchText(raw) {
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  // lines[0] = home code, lines[1] = time, lines[2] = away code
  // lines[3] = stage, lines[4] = group (or "·"), lines[6] = stadium name, lines[7] = city
  const homeCode = lines[0];
  const time = lines[1];
  const awayCode = lines[2];
  const stage = lines[3] || '';
  const group = lines[4] || '';
  const stadiumName = lines[6] || '';
  const stadiumCity = lines[7] ? lines[7].replace(/[()]/g, '') : '';

  const home = TEAM_NAMES[homeCode] || homeCode;
  const away = TEAM_NAMES[awayCode] || awayCode;

  return {
    match: `${home} vs ${away}`,
    time: formatTime(time),
    stadium: stadiumName,
    stadiumCity,
    stage: stage.trim(),
    group: group.startsWith('Group') ? group.trim() : null,
  };
}

async function fetchFixtures() {
  console.log('Fetching fixtures from FIFA website...');
  const res = await fetch(FIFA_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; fixture-updater/1.0)',
      'Accept': 'text/html',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${FIFA_URL}`);
  return res.text();
}

/**
 * Very basic HTML parser — extracts date headers and match link text.
 * Returns an array of { date, matches[] } objects.
 */
function parseHTML(html) {
  const dayBlocks = [];

  // Find all date header strings
  const datePattern = /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+\d+\s+(June|July|August)\s+2026/g;
  // Find all match-centre links
  const linkPattern = /<a[^>]+href="[^"]*match-centre[^"]*"[^>]*>([\s\S]*?)<\/a>/g;

  // Build a flat timeline of positions → dates and matches
  const events = [];
  let m;

  while ((m = datePattern.exec(html)) !== null) {
    events.push({ pos: m.index, type: 'date', text: m[0] });
  }
  while ((m = linkPattern.exec(html)) !== null) {
    // Strip inner HTML tags
    const text = m[1].replace(/<[^>]+>/g, '\n').replace(/&nbsp;/g, ' ').trim();
    events.push({ pos: m.index, type: 'match', text });
  }

  events.sort((a, b) => a.pos - b.pos);

  let currentDate = null;
  for (const ev of events) {
    if (ev.type === 'date') {
      currentDate = ev.text;
    } else if (ev.type === 'match' && currentDate) {
      const last = dayBlocks[dayBlocks.length - 1];
      if (last && last.date === currentDate) {
        last.matches.push(ev.text);
      } else {
        dayBlocks.push({ date: currentDate, matches: [ev.text] });
      }
    }
  }

  return dayBlocks;
}

/** Determine which round a stage string belongs to */
function roundLabel(stage) {
  if (stage.includes('First Stage')) return 'group';
  if (stage.includes('Round of 32')) return 'round32';
  if (stage.includes('Round of 16')) return 'round16';
  if (stage.includes('Quarter')) return 'qf';
  if (stage.includes('Semi')) return 'sf';
  if (stage.includes('third') || stage.includes('Third')) return 'third';
  if (stage.includes('Final')) return 'final';
  return 'unknown';
}

async function main() {
  const html = await fetchFixtures();
  const dayBlocks = parseHTML(html);

  const existing = JSON.parse(readFileSync(FIXTURES_PATH, 'utf8'));

  // Build a lookup: "date string" → parsed matches from FIFA
  const liveByDate = {};
  for (const block of dayBlocks) {
    const dateKey = formatDate(block.date);
    liveByDate[dateKey] = block.matches.map(parseMatchText);
  }

  let updatedCount = 0;

  for (const matchday of existing) {
    for (const game of matchday.games) {
      const gameRound = (game.round || matchday.round || '').toLowerCase();
      const isKnockout = ['round of 32', 'round of 16', 'quarter', 'semi', 'final', 'third'].some(
        r => gameRound.includes(r)
      );
      if (!isKnockout) continue;

      // Look up live data by date + stadium
      const liveMatches = liveByDate[game.date] || [];
      const live = liveMatches.find(
        lm => lm.stadium === game.stadium && lm.time === game.time
      );

      if (live && !live.match.includes('vs W') && !live.match.includes('vs 1') && !live.match.includes('vs 2') && !live.match.includes('vs 3') && !live.match.includes('vs RU')) {
        if (game.match !== live.match) {
          console.log(`  Updated: [${game.date} ${game.time}] ${game.match}  →  ${live.match}`);
          game.match = live.match;
          updatedCount++;
        }
      }
    }
  }

  if (updatedCount === 0) {
    console.log('No knockout matches could be updated yet — group stage may not be complete.');
  } else {
    writeFileSync(FIXTURES_PATH, JSON.stringify(existing, null, 2));
    console.log(`\nDone. Updated ${updatedCount} knockout match(es) in data/WCfixtures.json`);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
