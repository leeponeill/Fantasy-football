/**
 * Fetches France vs Morocco (fixture 1578539, 2026-07-09) player stats from
 * API-Sports, calculates GW6 fantasy points using the same logic as server.mjs,
 * then POSTs them to the Pi at http://192.168.1.5:4173.
 *
 * Only touches fantasy-football-player-points — does not change matchday or any
 * other storage key.
 */
import { readFile } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const PI_BASE = 'http://192.168.1.5:4173'
const FIXTURE_ID = 1578539  // France 2-0 Morocco, 2026-07-09
const EXPECTED_GW = 6

// ---- Load .env ----
const envRaw = await readFile(join(root, '.env'), 'utf8').catch(() => '')
for (const line of envRaw.split('\n')) {
  const eq = line.indexOf('=')
  if (eq > 0) {
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim()
    if (!process.env[key]) process.env[key] = value
  }
}
const apiSportsKey =
  process.env.APIFOOTBALL_API_KEY || process.env.API_FOOTBALL_KEY || process.env.APISPORTS_KEY || ''
if (!apiSportsKey) { console.error('No API-Sports key found.'); process.exit(1) }

// ---- Helpers (mirrors server.mjs) ----
async function fetchJson(url, headers = {}) {
  const res = await fetch(url, { headers: { Accept: 'application/json', ...headers } })
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
  return res.json()
}

function serverToToken(value) {
  return (value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

const teamAliases = {
  mar: 'morocco', fra: 'france', maroc: 'morocco',
  unitedstates: 'usa', us: 'usa', mex: 'mexico',
}
function serverNormalizeTeamToken(raw) {
  const t = serverToToken(raw)
  const withoutFC = t.endsWith('fc') && t.length > 2 ? t.slice(0, -2) : t
  return teamAliases[withoutFC] ?? withoutFC
}

function serverPlayerLastWordToken(name) {
  const parts = (name || '').trim().split(/\s+/)
  return serverToToken(parts[parts.length - 1] || '')
}

const playerNameAliases = {
  // Add known API-Sports name oddities here if needed
  tagnaouti: 'ahmedredatagnaouti',
}

function serverFindPlayer(players, row) {
  const teamToken = serverNormalizeTeamToken(row.teamName)
  const rawToken = serverToToken(row.playerName)
  const nameToken = playerNameAliases[rawToken] ?? rawToken

  // 1. strict
  const strict = players.find(p => serverNormalizeTeamToken(p.team) === teamToken && serverToToken(p.name) === nameToken)
  if (strict) return strict

  // 2. unique globally
  const byName = players.filter(p => serverToToken(p.name) === nameToken)
  if (byName.length === 1) return byName[0]

  // 3. name + team
  const byNameTeam = byName.find(p => serverNormalizeTeamToken(p.team) === teamToken)
  if (byNameTeam) return byNameTeam

  // 3a/3b. reversed name
  const parts = (row.playerName || '').trim().split(/\s+/)
  if (parts.length >= 2) {
    const rev = [parts[parts.length - 1], ...parts.slice(0, -1)].join(' ')
    const revToken = serverToToken(rev)
    if (revToken !== nameToken) {
      const byRevTeam = players.filter(p => serverNormalizeTeamToken(p.team) === teamToken && serverToToken(p.name) === revToken)
      if (byRevTeam.length === 1) return byRevTeam[0]
      const byRevAll = players.filter(p => serverToToken(p.name) === revToken)
      if (byRevAll.length === 1) return byRevAll[0]
    }
  }

  const byTeam = players.filter(p => serverNormalizeTeamToken(p.team) === teamToken)

  // 4. last-word match on team
  const lastWord = serverPlayerLastWordToken(row.playerName)
  if (lastWord.length >= 4) {
    const byLastWord = byTeam.filter(p => serverPlayerLastWordToken(p.name) === lastWord)
    if (byLastWord.length === 1) return byLastWord[0]
  }

  // 5. suffix/prefix on team
  if (nameToken.length >= 5) {
    const partial = byTeam.filter(p => {
      const pt = serverToToken(p.name)
      return pt !== nameToken && (pt.endsWith(nameToken) || nameToken.endsWith(pt) || pt.startsWith(nameToken) || nameToken.startsWith(pt))
    })
    if (partial.length === 1) return partial[0]
  }

  // 6. last-word globally
  if (lastWord.length >= 4) {
    const byLwAll = players.filter(p => serverPlayerLastWordToken(p.name) === lastWord)
    if (byLwAll.length === 1) return byLwAll[0]
  }

  // 7. suffix/prefix globally
  if (nameToken.length >= 5) {
    const partialAll = players.filter(p => {
      const pt = serverToToken(p.name)
      return pt !== nameToken && (pt.endsWith(nameToken) || nameToken.endsWith(pt) || pt.startsWith(nameToken) || nameToken.startsWith(pt))
    })
    if (partialAll.length === 1) return partialAll[0]
  }

  return null
}

// ---- Parse teams.txt ----
function parseTeamsFromText(text) {
  const teams = []
  let current = null
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue

    // Team header line: "France (group I)" or "France"
    if (!line.includes(':') && !line.startsWith('-')) {
      const teamName = line.replace(/\s*\(.*\)/, '').trim()
      current = { name: teamName, players: [] }
      teams.push(current)
      continue
    }

    if (!current) continue
    const colonIdx = line.indexOf(':')
    if (colonIdx < 0) continue
    const posLabel = line.slice(0, colonIdx).trim()
    const position =
      posLabel.startsWith('G') ? 'Goalkeeper' :
      posLabel.startsWith('D') ? 'Defender' :
      posLabel.startsWith('M') ? 'Midfielder' : 'Forward'

    const rest = line.slice(colonIdx + 1).trim()
    for (const entry of rest.split(',')) {
      const nameMatch = entry.trim().match(/^(.+?)\s*\[/)
      const name = nameMatch ? nameMatch[1].trim() : entry.trim()
      if (name) current.players.push({ name, position })
    }
  }
  return teams
}

// ---- Points calculation (mirrors server.mjs) ----
function calcPoints(perf) {
  let pts = 0
  const playTime = perf.minutesPlayed >= 60 ? 2 : perf.minutesPlayed > 0 ? 1 : 0
  pts += playTime
  const goalPts = { Goalkeeper: 10, Defender: 6, Midfielder: 5, Forward: 4 }
  pts += perf.goalsScored * (goalPts[perf.position] ?? 4)
  pts += perf.assists * 3
  if (perf.cleanSheet && perf.minutesPlayed >= 60) {
    const csPts = { Goalkeeper: 4, Defender: 4, Midfielder: 1, Forward: 0 }
    pts += csPts[perf.position] ?? 0
  }
  if (perf.position === 'Goalkeeper') pts += Math.floor(perf.shotSaves / 3)
  if (perf.position === 'Defender' && perf.defensiveContributions >= 10) pts += 2
  if ((perf.position === 'Midfielder' || perf.position === 'Forward') && perf.defensiveContributions >= 12) pts += 2
  pts += perf.penaltySaves * 5
  pts += perf.penaltyMisses * -2
  if (perf.position === 'Goalkeeper' || perf.position === 'Defender') {
    pts += Math.floor(Math.max(0, perf.goalsConceded - perf.penaltyShootoutGoalsConceded) / 2) * -1
  }
  pts += perf.yellowCards * -1
  pts += perf.redCards * -3
  return pts
}

// ---- Main ----

// 1. Read teams.txt
const teamsText = await readFile(join(root, 'teams.txt'), 'utf8')
const teams = parseTeamsFromText(teamsText)
const allPlayers = teams.flatMap(t => t.players.map(p => ({ name: p.name, position: p.position, team: t.name })))
console.log(`Loaded ${allPlayers.length} players from teams.txt`)

// 2. Check Pi GW
const piState = await fetchJson(`${PI_BASE}/api/league-state`)
const piGW = Number(piState.storage?.['fantasy-football-global-matchday'] ?? 0)
if (piGW !== EXPECTED_GW) {
  console.error(`Pi is on GW${piGW}, expected GW${EXPECTED_GW}. Aborting.`)
  process.exit(1)
}
console.log(`Pi confirmed on GW${piGW}`)

// 3. Fetch player stats from API-Sports
console.log(`Fetching API-Sports stats for fixture ${FIXTURE_ID}…`)
const authHeaders = { 'x-apisports-key': apiSportsKey }
const playerData = await fetchJson(
  `https://v3.football.api-sports.io/fixtures/players?fixture=${FIXTURE_ID}`,
  authHeaders
)

// Also fetch fixture for scores
const fixtureData = await fetchJson(
  `https://v3.football.api-sports.io/fixtures?id=${FIXTURE_ID}`,
  authHeaders
)
const fixture = Array.isArray(fixtureData?.response) ? fixtureData.response[0] : null
const homeTeamName = fixture?.teams?.home?.name ?? 'France'
const awayTeamName = fixture?.teams?.away?.name ?? 'Morocco'
const homeScore = Number(fixture?.goals?.home ?? 2)
const awayScore = Number(fixture?.goals?.away ?? 0)
console.log(`Fixture: ${homeTeamName} ${homeScore}-${awayScore} ${awayTeamName}`)

const teamEntries = Array.isArray(playerData?.response) ? playerData.response : []
if (teamEntries.length === 0) { console.error('No player stats returned.'); process.exit(1) }

// 4. Build importedRows
const importedRows = []
for (const teamEntry of teamEntries) {
  const teamName = teamEntry?.team?.name ?? ''
  const isHome = serverNormalizeTeamToken(teamName) === serverNormalizeTeamToken(homeTeamName)
  const goalsConceded = isHome ? awayScore : homeScore

  for (const pe of Array.isArray(teamEntry?.players) ? teamEntry.players : []) {
    const stats = Array.isArray(pe?.statistics) ? pe.statistics[0] : null
    if (!stats) continue
    const mins = Number(stats.games?.minutes ?? 0)
    if (mins === 0) continue

    const tackles = Number(stats.tackles?.total ?? 0)
    const blocks = Number(stats.tackles?.blocks ?? 0)
    const interceptions = Number(stats.tackles?.interceptions ?? 0)

    importedRows.push({
      playerName: pe?.player?.name ?? '',
      teamName,
      apiPosition: String(stats.games?.position ?? 'M'),
      minutesPlayed: mins,
      goalsScored: Number(stats.goals?.total ?? 0),
      assists: Number(stats.goals?.assists ?? 0),
      goalsConceded,
      penaltyShootoutGoalsConceded: 0,
      shotSaves: Number(stats.goals?.saves ?? 0),
      yellowCards: Number(stats.cards?.yellow ?? 0),
      redCards: Number(stats.cards?.red ?? 0),
      penaltyMisses: Number(stats.penalty?.missed ?? 0),
      penaltySaves: Number(stats.penalty?.saved ?? 0),
      defensiveContributions: tackles + blocks + interceptions,
    })
  }
}
console.log(`Got ${importedRows.length} players with minutes from API-Sports`)

// 5. Match & calculate
const newPoints = {}
const skipped = []

for (const row of importedRows) {
  const matched = serverFindPlayer(allPlayers, row)
  if (!matched) {
    skipped.push(`${row.playerName} (${row.teamName})`)
    continue
  }

  const perf = {
    position: matched.position,
    minutesPlayed: Math.max(0, Math.floor(row.minutesPlayed)),
    goalsScored: Math.max(0, Math.floor(row.goalsScored)),
    assists: Math.max(0, Math.floor(row.assists)),
    cleanSheet: row.goalsConceded === 0,
    shotSaves: Math.max(0, Math.floor(row.shotSaves)),
    defensiveContributions: Math.max(0, Math.floor(row.defensiveContributions)),
    penaltySaves: Math.max(0, Math.floor(row.penaltySaves)),
    penaltyMisses: Math.max(0, Math.floor(row.penaltyMisses)),
    goalsConceded: Math.max(0, Math.floor(row.goalsConceded)),
    penaltyShootoutGoalsConceded: 0,
    yellowCards: Math.max(0, Math.floor(row.yellowCards)),
    redCards: Math.max(0, Math.floor(row.redCards)),
  }
  const pts = calcPoints(perf)
  const key = `${matched.team}::${matched.name}`
  newPoints[key] = pts
  console.log(`  ${key.padEnd(45)} ${pts} pts`)
}

if (skipped.length) console.log(`\nSkipped (no match in teams.txt): ${skipped.join(', ')}`)

// 6. Merge with any existing points on Pi (other GW6 games)
const existingPtsRaw = piState.storage?.['fantasy-football-player-points']
const existingPts = existingPtsRaw ? JSON.parse(existingPtsRaw) : {}
const mergedPts = { ...existingPts, ...newPoints }

console.log(`\nUploading ${Object.keys(newPoints).length} player points to Pi (GW${piGW})…`)

const res = await fetch(`${PI_BASE}/api/league-storage/batch`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    set: {
      'fantasy-football-player-points': JSON.stringify(mergedPts),
    },
  }),
})

if (!res.ok) {
  console.error(`Upload failed: HTTP ${res.status}`)
  console.error(await res.text())
  process.exit(1)
}

const result = await res.json()
const uploadedCount = Object.keys(JSON.parse(result.storage?.['fantasy-football-player-points'] ?? '{}')).length
console.log(`Done! Pi now has ${uploadedCount} player-points entries for GW${piGW}.`)
