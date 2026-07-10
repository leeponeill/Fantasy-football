// One-off script: fetch France vs Morocco stats from API-Sports, calculate fantasy points
import { readFile } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

// Load .env
const envRaw = await readFile(join(root, '.env'), 'utf8').catch(() => '')
for (const line of envRaw.split('\n')) {
  const eq = line.indexOf('=')
  if (eq > 0) {
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim()
    if (!process.env[key]) process.env[key] = value
  }
}

const apiSportsKey = process.env.APIFOOTBALL_API_KEY || process.env.API_FOOTBALL_KEY || process.env.APISPORTS_KEY || ''

if (!apiSportsKey) {
  console.error('No API-Sports key found. Set APIFOOTBALL_API_KEY in .env')
  process.exit(1)
}

async function fetchJson(url, headers = {}) {
  const res = await fetch(url, { headers: { Accept: 'application/json', ...headers } })
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}: ${await res.text().catch(() => '')}`)
  return res.json()
}

const authHeaders = { 'x-apisports-key': apiSportsKey }

// Step 1: find fixture ID for France vs Morocco on 2026-07-09
console.log('Searching for France vs Morocco on 2026-07-09…')
const fixturesByDate = await fetchJson(
  'https://v3.football.api-sports.io/fixtures?date=2026-07-09',
  authHeaders
)

function toToken(name) {
  return (name || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '')
}

const aliases = { mar: 'morocco', fra: 'france', maroc: 'morocco' }
function resolveToken(t) { return aliases[t] ?? t }

const fixtures = Array.isArray(fixturesByDate?.response) ? fixturesByDate.response : []
let target = null
for (const f of fixtures) {
  const h = resolveToken(toToken(f?.teams?.home?.name))
  const a = resolveToken(toToken(f?.teams?.away?.name))
  if ((h === 'france' && a === 'morocco') || (h === 'morocco' && a === 'france')) {
    target = f
    break
  }
}

if (!target) {
  console.error(`No France vs Morocco fixture found on 2026-07-09. Got ${fixtures.length} fixtures.`)
  if (fixtures.length > 0) {
    console.log('Available fixtures:', fixtures.map(f => `${f?.teams?.home?.name} vs ${f?.teams?.away?.name}`).join(', '))
  }
  process.exit(1)
}

const fixtureId = target.fixture?.id
const homeTeamName = target.teams?.home?.name
const awayTeamName = target.teams?.away?.name
const score = target.goals
console.log(`Found fixture ${fixtureId}: ${homeTeamName} ${score?.home ?? '?'}-${score?.away ?? '?'} ${awayTeamName}`)
console.log(`Status: ${target.fixture?.status?.long}`)
console.log()

// Step 2: get player stats
console.log('Fetching player stats…')
const playerData = await fetchJson(
  `https://v3.football.api-sports.io/fixtures/players?fixture=${fixtureId}`,
  authHeaders
)

const teams = Array.isArray(playerData?.response) ? playerData.response : []
if (teams.length === 0) {
  console.error('No player stats returned.')
  process.exit(1)
}

// Points calculation (from src/pointsCalculator.ts)
function getGoalPoints(position, goals) {
  if (goals === 0) return 0
  const map = { Goalkeeper: 10, Defender: 6, Midfielder: 5, Forward: 4 }
  return goals * (map[position] ?? 4)
}
function getCleanSheetPoints(position) {
  if (position === 'Goalkeeper' || position === 'Defender') return 4
  if (position === 'Midfielder') return 1
  return 0
}
function getDefensiveContributionPoints(position, contributions) {
  if (position === 'Defender' && contributions >= 10) return 2
  if ((position === 'Midfielder' || position === 'Forward') && contributions >= 12) return 2
  return 0
}
function positionBucket(raw) {
  const u = (raw || '').toUpperCase()
  if (u.includes('G')) return 'Goalkeeper'
  if (u.includes('D')) return 'Defender'
  if (u.includes('M')) return 'Midfielder'
  return 'Forward'
}

const isCleanSheet = score?.home === 0 || score?.away === 0

function calcPoints(p) {
  const position = positionBucket(p.games?.position)
  const mins = p.games?.minutes ?? 0
  const goals = p.goals?.total ?? 0
  const assists = p.goals?.assists ?? 0
  const saves = p.goals?.saves ?? 0
  const conceded = p.goals?.conceded ?? 0
  const yellowCards = p.cards?.yellow ?? 0
  const redCards = p.cards?.red ?? 0
  const penMissed = p.penalty?.missed ?? 0
  const penSaved = p.penalty?.saved ?? 0
  const tackles = (p.tackles?.total ?? 0) + (p.tackles?.blocks ?? 0) + (p.tackles?.interceptions ?? 0)

  const breakdown = {}
  let pts = 0

  const playTime = mins >= 60 ? 2 : mins > 0 ? 1 : 0
  if (playTime) { breakdown['Playing Time'] = playTime; pts += playTime }

  const goalPts = getGoalPoints(position, goals)
  if (goalPts) { breakdown['Goals'] = goalPts; pts += goalPts }

  const assistPts = assists * 3
  if (assistPts) { breakdown['Assists'] = assistPts; pts += assistPts }

  // Clean sheet: the player is on the "clean side" if their team didn't concede
  // We'll pass this in from the outer loop
  if (p._cleanSheet && mins >= 60) {
    const csPts = getCleanSheetPoints(position)
    if (csPts) { breakdown['Clean Sheet'] = csPts; pts += csPts }
  }

  if (position === 'Goalkeeper') {
    const savePts = Math.floor(saves / 3)
    if (savePts) { breakdown['Shot Saves'] = savePts; pts += savePts }
  }

  const defPts = getDefensiveContributionPoints(position, tackles)
  if (defPts) { breakdown['Defensive Contributions'] = defPts; pts += defPts }

  const penSavePts = penSaved * 5
  if (penSavePts) { breakdown['Penalty Saves'] = penSavePts; pts += penSavePts }

  const penMissPts = penMissed * -2
  if (penMissPts) { breakdown['Penalty Misses'] = penMissPts; pts += penMissPts }

  if (position === 'Goalkeeper' || position === 'Defender') {
    const concededPts = Math.floor(conceded / 2) * -1
    if (concededPts < 0) { breakdown['Goals Conceded'] = concededPts; pts += concededPts }
  }

  const ycPts = yellowCards * -1
  if (ycPts < 0) { breakdown['Yellow Cards'] = ycPts; pts += ycPts }

  const rcPts = redCards * -3
  if (rcPts < 0) { breakdown['Red Cards'] = rcPts; pts += rcPts }

  return { points: pts, breakdown, position, mins }
}

// Print results
const homeGoals = score?.home ?? '?'
const awayGoals = score?.away ?? '?'

console.log('='.repeat(72))
console.log(`  FRANCE vs MOROCCO  —  ${homeTeamName} ${homeGoals}-${awayGoals} ${awayTeamName}`)
console.log('='.repeat(72))

for (const teamEntry of teams) {
  const teamName = teamEntry?.team?.name
  const isHome = toToken(teamName) === toToken(homeTeamName)
  const teamGoalsScored = isHome ? homeGoals : awayGoals
  const teamCleanSheet = (isHome ? awayGoals : homeGoals) === 0

  const players = Array.isArray(teamEntry?.players) ? teamEntry.players : []

  console.log()
  console.log(`── ${teamName} ──`)
  console.log()
  console.log(`${'Name'.padEnd(30)} ${'Pos'.padEnd(4)} ${'Min'.padStart(3)} ${'Pts'.padStart(4)}  Breakdown`)
  console.log('-'.repeat(72))

  const rows = []
  for (const pe of players) {
    const stats = Array.isArray(pe?.statistics) ? pe.statistics[0] : null
    if (!stats) continue
    const mins = stats.games?.minutes ?? 0
    if (mins === 0 && !stats.games?.substitute) continue // skip unused subs

    stats._cleanSheet = teamCleanSheet
    const { points, breakdown, position } = calcPoints(stats)
    const bStr = Object.entries(breakdown).map(([k, v]) => `${k}: ${v > 0 ? '+' : ''}${v}`).join(', ')
    rows.push({ name: pe?.player?.name ?? '?', position, mins, points, breakdown: bStr })
  }

  rows.sort((a, b) => b.points - a.points)

  for (const r of rows) {
    const nameTrunc = r.name.length > 28 ? r.name.slice(0, 27) + '…' : r.name
    console.log(
      `${nameTrunc.padEnd(30)} ${r.position.slice(0, 4).padEnd(4)} ${String(r.mins).padStart(3)} ${String(r.points).padStart(4)}  ${r.breakdown || '—'}`
    )
  }
}

console.log()
console.log('='.repeat(72))
