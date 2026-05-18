import { createServer as createHttpServer } from 'node:http'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dataDirectory = path.join(__dirname, 'data')
const leagueStatePath = path.join(dataDirectory, 'league-state.json')
const distDirectory = path.join(__dirname, 'dist')
const envFilePath = path.join(__dirname, '.env')

function stripWrappingQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }

  return value
}

async function loadEnvFile() {
  try {
    const raw = await readFile(envFilePath, 'utf8')
    const lines = raw.split(/\r?\n/)

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) {
        continue
      }

      const separatorIndex = trimmed.indexOf('=')
      if (separatorIndex <= 0) {
        continue
      }

      const key = trimmed.slice(0, separatorIndex).trim()
      const value = stripWrappingQuotes(trimmed.slice(separatorIndex + 1).trim())
      if (!key || key in process.env) {
        continue
      }

      process.env[key] = value
    }
  } catch {
    // .env is optional.
  }
}

function getApiFootballKey() {
  return process.env.APIFOOTBALL_API_KEY ?? process.env.API_FOOTBALL_KEY ?? process.env.APISPORTS_KEY ?? ''
}

function parseArgs(argv) {
  const args = {
    host: '127.0.0.1',
    port: 4173,
    mode: 'production',
  }

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    const nextValue = argv[index + 1]

    if (token === '--host' && nextValue) {
      args.host = nextValue
      index += 1
      continue
    }

    if (token === '--port' && nextValue) {
      const parsedPort = Number.parseInt(nextValue, 10)
      if (Number.isFinite(parsedPort)) {
        args.port = parsedPort
      }
      index += 1
      continue
    }

    if (token === '--mode' && nextValue) {
      args.mode = nextValue === 'development' ? 'development' : 'production'
      index += 1
    }
  }

  return args
}

async function ensureDataFile() {
  await mkdir(dataDirectory, { recursive: true })

  try {
    await stat(leagueStatePath)
  } catch {
    const initialState = {
      storage: {},
      updatedAt: new Date().toISOString(),
    }
    await writeFile(leagueStatePath, `${JSON.stringify(initialState, null, 2)}\n`, 'utf8')
  }
}

function sanitizeStorage(storage) {
  if (!storage || typeof storage !== 'object' || Array.isArray(storage)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(storage).filter(
      ([key, value]) =>
        typeof key === 'string' &&
        key.startsWith('fantasy-football-') &&
        key !== 'fantasy-football-current-user' &&
        typeof value === 'string',
    ),
  )
}

async function readLeagueState() {
  await ensureDataFile()

  try {
    const raw = await readFile(leagueStatePath, 'utf8')
    const parsed = JSON.parse(raw)
    return {
      storage: sanitizeStorage(parsed.storage),
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
    }
  } catch {
    return {
      storage: {},
      updatedAt: new Date().toISOString(),
    }
  }
}

async function writeLeagueState(storage) {
  const nextState = {
    storage: sanitizeStorage(storage),
    updatedAt: new Date().toISOString(),
  }

  await ensureDataFile()
  await writeFile(leagueStatePath, `${JSON.stringify(nextState, null, 2)}\n`, 'utf8')
  return nextState
}

async function readJsonBody(request) {
  const chunks = []

  for await (const chunk of request) {
    chunks.push(chunk)
  }

  const rawBody = Buffer.concat(chunks).toString('utf8').trim()
  if (!rawBody) {
    return {}
  }

  return JSON.parse(rawBody)
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  response.end(JSON.stringify(payload))
}

function sendPlainText(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
  })
  response.end(payload)
}

function getAsString(value) {
  return typeof value === 'string' ? value : ''
}

function getAsNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return 0
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.headers ?? {}),
    },
  })

  if (!response.ok) {
    throw new Error(`Request failed (${response.status})`)
  }

  return response.json()
}

await loadEnvFile()

async function searchFinishedSoccerEvents(query) {
  const encodedQuery = encodeURIComponent(query)
  const payload = await fetchJson(`https://www.thesportsdb.com/api/v1/json/3/searchevents.php?e=${encodedQuery}`)
  const events = Array.isArray(payload?.event) ? payload.event : []

  return events
    .filter((event) => getAsString(event?.strSport).toLowerCase() === 'soccer')
    .filter((event) => {
      const status = getAsString(event?.strStatus).toLowerCase()
      if (status.includes('match finished') || status.includes('finished')) {
        return true
      }

      const hasScore = getAsString(event?.intHomeScore) !== '' && getAsString(event?.intAwayScore) !== ''
      return hasScore
    })
    .map((event) => ({
      idEvent: getAsString(event?.idEvent),
      idApiFootball: getAsString(event?.idAPIfootball),
      name: getAsString(event?.strEvent),
      date: getAsString(event?.dateEvent),
      league: getAsString(event?.strLeague),
      season: getAsString(event?.strSeason),
      homeTeam: getAsString(event?.strHomeTeam),
      awayTeam: getAsString(event?.strAwayTeam),
      homeScore: getAsString(event?.intHomeScore),
      awayScore: getAsString(event?.intAwayScore),
      status: getAsString(event?.strStatus),
    }))
}

async function getEventById(eventId) {
  const encodedEventId = encodeURIComponent(eventId)
  const payload = await fetchJson(`https://www.thesportsdb.com/api/v1/json/3/lookupevent.php?id=${encodedEventId}`)
  const event = Array.isArray(payload?.events) ? payload.events[0] : null
  if (!event) {
    return null
  }

  return {
    idEvent: getAsString(event.idEvent),
    idApiFootball: getAsString(event.idAPIfootball),
    name: getAsString(event.strEvent),
    date: getAsString(event.dateEvent),
    league: getAsString(event.strLeague),
    season: getAsString(event.strSeason),
    homeTeam: getAsString(event.strHomeTeam),
    awayTeam: getAsString(event.strAwayTeam),
    homeScore: getAsString(event.intHomeScore),
    awayScore: getAsString(event.intAwayScore),
    status: getAsString(event.strStatus),
  }
}

async function getApiFootballPlayerStats(fixtureId, apiFootballKey) {
  const encodedFixtureId = encodeURIComponent(fixtureId)
  const payload = await fetchJson(`https://v3.football.api-sports.io/fixtures/players?fixture=${encodedFixtureId}`, {
    headers: {
      'x-apisports-key': apiFootballKey,
    },
  })

  const teams = Array.isArray(payload?.response) ? payload.response : []
  const rows = []

  for (const teamEntry of teams) {
    const teamName = getAsString(teamEntry?.team?.name)
    const players = Array.isArray(teamEntry?.players) ? teamEntry.players : []

    for (const playerEntry of players) {
      const statistics = Array.isArray(playerEntry?.statistics)
        ? playerEntry.statistics[0]
        : null

      if (!statistics) {
        continue
      }

      const tackles = statistics.tackles ?? {}
      const goals = statistics.goals ?? {}
      const cards = statistics.cards ?? {}
      const penalty = statistics.penalty ?? {}
      const games = statistics.games ?? {}

      rows.push({
        playerName: getAsString(playerEntry?.player?.name),
        teamName,
        apiPosition: getAsString(games.position),
        minutesPlayed: getAsNumber(games.minutes),
        goalsScored: getAsNumber(goals.total),
        assists: getAsNumber(goals.assists),
        goalsConceded: getAsNumber(goals.conceded),
        shotSaves: getAsNumber(goals.saves),
        yellowCards: getAsNumber(cards.yellow),
        redCards: getAsNumber(cards.red),
        penaltyMisses: getAsNumber(penalty.missed),
        penaltySaves: getAsNumber(penalty.saved),
        defensiveContributions:
          getAsNumber(tackles.total) + getAsNumber(tackles.blocks) + getAsNumber(tackles.interceptions),
      })
    }
  }

  return rows
}

async function handleApiRequest(request, response) {
  const url = new URL(request.url ?? '/', 'http://localhost')

  if (request.method === 'GET' && url.pathname === '/api/league-state') {
    const state = await readLeagueState()
    sendJson(response, 200, state)
    return true
  }

  if (request.method === 'POST' && url.pathname === '/api/league-storage/batch') {
    try {
      const currentState = await readLeagueState()
      const body = await readJsonBody(request)
      const setEntries = sanitizeStorage(body.set)
      const removeKeys = Array.isArray(body.remove)
        ? body.remove.filter(
            (key) =>
              typeof key === 'string' &&
              key.startsWith('fantasy-football-') &&
              key !== 'fantasy-football-current-user',
          )
        : []

      const nextStorage = {
        ...currentState.storage,
        ...setEntries,
      }

      for (const key of removeKeys) {
        delete nextStorage[key]
      }

      const nextState = await writeLeagueState(nextStorage)
      sendJson(response, 200, nextState)
    } catch {
      sendJson(response, 400, { error: 'Invalid shared storage request.' })
    }
    return true
  }

  if (request.method === 'GET' && url.pathname === '/api/match-stats/search') {
    const query = (url.searchParams.get('query') ?? '').trim()
    if (query.length < 3) {
      sendJson(response, 400, { error: 'Query must be at least 3 characters.' })
      return true
    }

    try {
      const matches = await searchFinishedSoccerEvents(query)
      sendJson(response, 200, { matches })
    } catch {
      sendJson(response, 502, { error: 'Unable to search matches right now.' })
    }

    return true
  }

  if (request.method === 'GET' && url.pathname === '/api/match-stats/players') {
    const eventId = (url.searchParams.get('eventId') ?? '').trim()
    if (!eventId) {
      sendJson(response, 400, { error: 'eventId is required.' })
      return true
    }

    try {
      const event = await getEventById(eventId)
      if (!event) {
        sendJson(response, 404, { error: 'Match not found.' })
        return true
      }

      if (!event.idApiFootball) {
        sendJson(response, 422, {
          error: 'No player-stat provider ID is available for this match.',
          event,
        })
        return true
      }

      const apiFootballKey = getApiFootballKey()
      if (!apiFootballKey) {
        sendJson(response, 422, {
          error:
            'Player-stat auto import requires APIFOOTBALL_API_KEY (or API_FOOTBALL_KEY/APISPORTS_KEY) on the host server.',
          event,
        })
        return true
      }

      const players = await getApiFootballPlayerStats(event.idApiFootball, apiFootballKey)
      sendJson(response, 200, {
        event,
        players,
      })
    } catch {
      sendJson(response, 502, { error: 'Unable to fetch player stats for this match.' })
    }

    return true
  }

  return false
}

function getContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase()

  if (extension === '.html') return 'text/html; charset=utf-8'
  if (extension === '.js') return 'text/javascript; charset=utf-8'
  if (extension === '.css') return 'text/css; charset=utf-8'
  if (extension === '.json') return 'application/json; charset=utf-8'
  if (extension === '.svg') return 'image/svg+xml'
  if (extension === '.png') return 'image/png'
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.webp') return 'image/webp'
  if (extension === '.ico') return 'image/x-icon'
  if (extension === '.txt') return 'text/plain; charset=utf-8'

  return 'application/octet-stream'
}

async function serveStaticFile(request, response) {
  const requestUrl = new URL(request.url ?? '/', 'http://localhost')
  const normalizedPath = decodeURIComponent(requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname)
  const filePath = path.join(distDirectory, normalizedPath)

  if (!filePath.startsWith(distDirectory)) {
    sendPlainText(response, 403, 'Forbidden')
    return
  }

  try {
    const fileStats = await stat(filePath)
    if (!fileStats.isFile()) {
      sendPlainText(response, 404, 'Not found')
      return
    }

    response.writeHead(200, {
      'Content-Type': getContentType(filePath),
    })
    createReadStream(filePath).pipe(response)
  } catch {
    sendPlainText(response, 404, 'Not found')
  }
}

async function createDevelopmentServer(host, port) {
  const { createServer } = await import('vite')
  const vite = await createServer({
    server: {
      middlewareMode: true,
      host,
      port,
      allowedHosts: true,
    },
    appType: 'mpa',
  })

  const server = createHttpServer(async (request, response) => {
    if (await handleApiRequest(request, response)) {
      return
    }

    vite.middlewares(request, response, () => {
      sendPlainText(response, 404, 'Not found')
    })
  })

  return { server, vite }
}

async function createProductionServer() {
  await ensureDataFile()

  const server = createHttpServer(async (request, response) => {
    if (await handleApiRequest(request, response)) {
      return
    }

    await serveStaticFile(request, response)
  })

  return { server }
}

// ========== SERVER-SIDE FIXTURE AUTO-SCANNER ==========

const teamsFilePath = path.join(__dirname, 'teams.txt')
const serverAutoImportedIdsKey = 'fantasy-football-auto-imported-event-ids'
const serverPlayerPointsKey = 'fantasy-football-player-points'
const serverAutoScanDelayMs = 150 * 60 * 1000 // 2.5 hours
const serverSchedulerMaxDelayMs = 2_147_000_000

/** All fixture matchdays (mirrors fixturesData.ts) */
const serverFixtureMatchdays = [
  {
    matchday: 1,
    games: [
      { match: 'Mexico vs South Africa', time: '8pm', date: 'Thursday, June 11' },
      { match: 'South Korea vs Czech Republic', time: '3am', date: 'Friday, June 12' },
      { match: 'Canada vs Bosnia & Herzegovina', time: '8pm', date: 'Friday, June 12' },
      { match: 'USA vs Paraguay', time: '2am', date: 'Saturday, June 13' },
      { match: 'Qatar vs Switzerland', time: '8pm', date: 'Saturday, June 13' },
      { match: 'Brazil vs Morocco', time: '11pm', date: 'Saturday, June 13' },
      { match: 'Haiti vs Scotland', time: '2am', date: 'Sunday, June 14' },
      { match: 'Australia vs Turkey', time: '5am', date: 'Sunday, June 14' },
      { match: 'Germany vs Curacao', time: '6pm', date: 'Sunday, June 14' },
      { match: 'Netherlands vs Japan', time: '9pm', date: 'Sunday, June 14' },
      { match: 'Ivory Coast vs Ecuador', time: '12am', date: 'Monday, June 15' },
      { match: 'Sweden vs Tunisia', time: '3am', date: 'Monday, June 15' },
      { match: 'Spain vs Cape Verde', time: '5pm', date: 'Monday, June 15' },
      { match: 'Belgium vs Egypt', time: '8pm', date: 'Monday, June 15' },
      { match: 'Saudi Arabia vs Uruguay', time: '11pm', date: 'Monday, June 15' },
      { match: 'Iran vs New Zealand', time: '2am', date: 'Tuesday, June 16' },
      { match: 'France vs Senegal', time: '8pm', date: 'Tuesday, June 16' },
      { match: 'Iraq vs Norway', time: '11pm', date: 'Tuesday, June 16' },
      { match: 'Argentina vs Algeria', time: '2am', date: 'Wednesday, June 17' },
      { match: 'Austria vs Jordan', time: '5am', date: 'Wednesday, June 17' },
      { match: 'Portugal vs DR Congo', time: '6pm', date: 'Wednesday, June 17' },
      { match: 'England vs Croatia', time: '9pm', date: 'Wednesday, June 17' },
    ],
  },
  {
    matchday: 2,
    games: [
      { match: 'Ghana vs Panama', time: '12am', date: 'Thursday, June 18' },
      { match: 'Uzbekistan vs Colombia', time: '3am', date: 'Thursday, June 18' },
      { match: 'Czech Republic vs South Africa', time: '5pm', date: 'Thursday, June 18' },
      { match: 'Switzerland vs Bosnia & Herzegovina', time: '8pm', date: 'Thursday, June 18' },
      { match: 'Canada vs Qatar', time: '11pm', date: 'Thursday, June 18' },
      { match: 'Mexico vs South Korea', time: '2am', date: 'Friday, June 19' },
      { match: 'USA vs Australia', time: '8pm', date: 'Friday, June 19' },
      { match: 'Scotland vs Morocco', time: '11pm', date: 'Friday, June 19' },
      { match: 'Brazil vs Haiti', time: '1.30am', date: 'Saturday, June 20' },
      { match: 'Turkey vs Paraguay', time: '4am', date: 'Saturday, June 20' },
      { match: 'Netherlands vs Sweden', time: '6pm', date: 'Saturday, June 20' },
      { match: 'Germany vs Ivory Coast', time: '9pm', date: 'Saturday, June 20' },
      { match: 'Ecuador vs Curacao', time: '1am', date: 'Sunday, June 21' },
      { match: 'Tunisia vs Japan', time: '5am', date: 'Sunday, June 21' },
      { match: 'Spain vs Saudi Arabia', time: '5pm', date: 'Sunday, June 21' },
      { match: 'Belgium vs Iran', time: '8pm', date: 'Sunday, June 21' },
      { match: 'Uruguay vs Cape Verde', time: '11pm', date: 'Sunday, June 21' },
      { match: 'New Zealand vs Egypt', time: '2am', date: 'Monday, June 22' },
      { match: 'Argentina vs Austria', time: '6pm', date: 'Monday, June 22' },
      { match: 'France vs Iraq', time: '10pm', date: 'Monday, June 22' },
      { match: 'Norway vs Senegal', time: '1am', date: 'Tuesday, June 23' },
      { match: 'Jordan vs Algeria', time: '4am', date: 'Tuesday, June 23' },
      { match: 'Portugal vs Uzbekistan', time: '6pm', date: 'Tuesday, June 23' },
      { match: 'England vs Ghana', time: '9pm', date: 'Tuesday, June 23' },
    ],
  },
  {
    matchday: 3,
    games: [
      { match: 'Panama vs Croatia', time: '12am', date: 'Wednesday, June 24' },
      { match: 'Colombia vs DR Congo', time: '3am', date: 'Wednesday, June 24' },
      { match: 'Switzerland vs Canada', time: '8pm', date: 'Wednesday, June 24' },
      { match: 'Bosnia & Herzegovina vs Qatar', time: '8pm', date: 'Wednesday, June 24' },
      { match: 'Morocco vs Haiti', time: '11pm', date: 'Wednesday, June 24' },
      { match: 'Scotland vs Brazil', time: '11pm', date: 'Wednesday, June 24' },
      { match: 'South Africa vs South Korea', time: '2am', date: 'Thursday, June 25' },
      { match: 'Czech Republic vs Mexico', time: '2am', date: 'Thursday, June 25' },
      { match: 'Curacao vs Ivory Coast', time: '9pm', date: 'Thursday, June 25' },
      { match: 'Ecuador vs Germany', time: '9pm', date: 'Thursday, June 25' },
      { match: 'Tunisia vs Netherlands', time: '12am', date: 'Friday, June 26' },
      { match: 'Japan vs Sweden', time: '12am', date: 'Friday, June 26' },
      { match: 'Turkey vs USA', time: '3am', date: 'Friday, June 26' },
      { match: 'Paraguay vs Australia', time: '3am', date: 'Friday, June 26' },
      { match: 'Norway vs France', time: '8pm', date: 'Friday, June 26' },
      { match: 'Senegal vs Iraq', time: '8pm', date: 'Friday, June 26' },
      { match: 'Cape Verde vs Saudi Arabia', time: '1am', date: 'Saturday, June 27' },
      { match: 'Uruguay vs Spain', time: '1am', date: 'Saturday, June 27' },
      { match: 'New Zealand vs Belgium', time: '4am', date: 'Saturday, June 27' },
      { match: 'Egypt vs Iran', time: '4am', date: 'Saturday, June 27' },
      { match: 'Panama vs England', time: '10pm', date: 'Saturday, June 27' },
      { match: 'Croatia vs Ghana', time: '10pm', date: 'Saturday, June 27' },
      { match: 'Colombia vs Portugal', time: '12.30am', date: 'Sunday, June 28' },
      { match: 'DR Congo vs Uzbekistan', time: '12.30am', date: 'Sunday, June 28' },
      { match: 'Algeria vs Austria', time: '3am', date: 'Sunday, June 28' },
      { match: 'Jordan vs Argentina', time: '3am', date: 'Sunday, June 28' },
    ],
  },
]

// ---- Player data parsing (mirrors teamsData.ts) ----

const serverSquadLineRegex = /^(Goalkeepers|Defenders|Midfielders|Forwards|Midfielders\s*&\s*forwards)\s*:/i

function serverNormalizePosition(position) {
  const n = position.trim().toLowerCase()
  if (n.includes('goalkeeper')) return 'Goalkeeper'
  if (n.includes('defender')) return 'Defender'
  if (n.includes('forwards') || n.includes('forwad') || n.includes('forward')) return 'Forward'
  if (n.includes('midfielders') && n.includes('forwards')) return 'Midfielder/Forward'
  if (n.includes('midfielder')) return 'Midfielder'
  return 'Player'
}

function serverIsLikelyTeamLine(line) {
  if (!line || line.includes(':')) return false
  if (line.startsWith('FIFA World Cup')) return false
  const lower = line.toLowerCase()
  if (lower === 'all' || lower === 'exclusive' || lower === 'highlights') return false
  if (lower.includes('spain win gold') || lower.includes('duration time')) return false
  if (line.length > 70) return false
  return /^[A-Za-z0-9\u00C0-\u024F''&.\-\s()]+$/.test(line)
}

function serverParseTeamLine(line) {
  const m = line.match(/^(.*?)\s*\(([^)]+)\)\s*$/)
  if (m) return { name: m[1].trim(), status: m[2].toLowerCase().includes('final') ? 'final' : 'preliminary' }
  return { name: line.trim(), status: 'preliminary' }
}

function serverNormalizePlayerName(raw) {
  return raw.replace(/\s*\([^)]*\)/g, '').replace(/^[^A-Za-z0-9\u00C0-\u024F]+/, '').trim()
}

function serverParsePlayerToken(token) {
  const priceMatch = token.match(/\[(\d+(?:\.\d+)?)\]\s*$/)
  if (priceMatch) {
    const price = parseFloat(priceMatch[1])
    token = token.slice(0, token.lastIndexOf('[')).trimEnd()
    return { name: serverNormalizePlayerName(token), price }
  }
  return { name: serverNormalizePlayerName(token), price: undefined }
}

function serverParseTeamsFromText(rawText) {
  const teams = []
  const lines = rawText.split(/\r?\n/).map((l) => l.trim())
  let currentTeam = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue

    if (serverIsLikelyTeamLine(line)) {
      const lookAhead = lines.slice(i + 1, i + 6).join(' ')
      if (!/Goalkeepers\s*:/.test(lookAhead)) continue
      const { name, status } = serverParseTeamLine(line)
      currentTeam = { name, status, players: [] }
      teams.push(currentTeam)
      continue
    }

    if (!currentTeam || !serverSquadLineRegex.test(line)) continue

    const positionPart = line.split(':')[0]?.trim() ?? ''
    const position = serverNormalizePosition(positionPart)
    const playersPart = line.split(':').slice(1).join(':').trim()
    if (!playersPart) continue

    for (const token of playersPart.split(',').map((t) => t.trim()).filter(Boolean)) {
      const { name } = serverParsePlayerToken(token)
      if (name && !currentTeam.players.some((p) => p.name === name)) {
        currentTeam.players.push({ name, position })
      }
    }
  }

  return teams
}

let cachedServerPlayers = null

async function getServerPlayers() {
  if (cachedServerPlayers) return { players: cachedServerPlayers }
  const rawText = await readFile(teamsFilePath, 'utf8')
  const teams = serverParseTeamsFromText(rawText)
  cachedServerPlayers = teams.flatMap((team) => team.players.map((p) => ({ name: p.name, position: p.position, team: team.name })))
  return { players: cachedServerPlayers }
}

// ---- Team/player name tokenisation (mirrors stats.ts) ----

function serverToToken(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

const serverTeamAliases = {
  unitedstates: 'usa',
  us: 'usa',
  korearepublic: 'southkorea',
  republicofkorea: 'southkorea',
  czechrepublic: 'czechia',
  coteivoire: 'ivorycoast',
}

function serverNormalizeTeamToken(teamName) {
  const token = serverToToken(teamName)
  return serverTeamAliases[token] ?? token
}

function serverFindPlayer(players, row) {
  const teamToken = serverNormalizeTeamToken(row.teamName)
  const nameToken = serverToToken(row.playerName)

  const strict = players.find(
    (p) => serverNormalizeTeamToken(p.team) === teamToken && serverToToken(p.name) === nameToken,
  )
  if (strict) return strict

  const byName = players.filter((p) => serverToToken(p.name) === nameToken)
  if (byName.length === 1) return byName[0]
  return byName.find((p) => serverNormalizeTeamToken(p.team) === teamToken) ?? null
}

// ---- Points calculation (mirrors pointsCalculator.ts) ----

function serverGetGoalPoints(position, goals) {
  if (goals === 0) return 0
  const pts = { Goalkeeper: 10, Defender: 6, Midfielder: 5, Forward: 4 }
  return goals * (pts[position] ?? 0)
}

function serverGetCleanSheetPoints(position) {
  if (position === 'Goalkeeper' || position === 'Defender') return 4
  if (position === 'Midfielder') return 1
  return 0
}

function serverGetDefensePoints(position, contributions) {
  if (position === 'Defender' && contributions >= 10) return 2
  if ((position === 'Midfielder' || position === 'Forward') && contributions >= 12) return 2
  return 0
}

function serverCalculatePlayerPoints(perf) {
  let points = 0
  const playingTimePoints = perf.minutesPlayed >= 60 ? 2 : perf.minutesPlayed > 0 ? 1 : 0
  points += playingTimePoints
  points += serverGetGoalPoints(perf.position, perf.goalsScored)
  points += perf.assists * 3
  if (perf.cleanSheet && perf.minutesPlayed >= 60) points += serverGetCleanSheetPoints(perf.position)
  if (perf.position === 'Goalkeeper') points += Math.floor(perf.shotSaves / 3)
  points += serverGetDefensePoints(perf.position, perf.defensiveContributions)
  points += perf.penaltySaves * 5
  points += perf.penaltyMisses * -2
  if (perf.position === 'Goalkeeper' || perf.position === 'Defender') {
    points += Math.floor(perf.goalsConceded / 2) * -1
  }
  points += perf.yellowCards * -1
  points += perf.redCards * -3
  return points
}

function serverGetPositionType(player) {
  if (player.position === 'Goalkeeper') return 'Goalkeeper'
  if (player.position === 'Defender') return 'Defender'
  if (player.position === 'Forward') return 'Forward'
  return 'Midfielder'
}

function serverCalculateImportedRows(players, importedRows) {
  const calculated = []
  let skipped = 0
  for (const row of importedRows) {
    const matched = serverFindPlayer(players, row)
    if (!matched) { skipped++; continue }
    const minutesPlayed = Math.max(0, Math.floor(row.minutesPlayed))
    const goalsConceded = Math.max(0, Math.floor(row.goalsConceded))
    const perf = {
      position: serverGetPositionType(matched),
      minutesPlayed,
      goalsScored: Math.max(0, Math.floor(row.goalsScored)),
      assists: Math.max(0, Math.floor(row.assists)),
      cleanSheet: goalsConceded === 0 && minutesPlayed >= 60,
      shotSaves: Math.max(0, Math.floor(row.shotSaves)),
      defensiveContributions: Math.max(0, Math.floor(row.defensiveContributions)),
      penaltySaves: Math.max(0, Math.floor(row.penaltySaves)),
      penaltyMisses: Math.max(0, Math.floor(row.penaltyMisses)),
      goalsConceded,
      yellowCards: Math.max(0, Math.floor(row.yellowCards)),
      redCards: Math.max(0, Math.floor(row.redCards)),
    }
    calculated.push({ player: matched, points: serverCalculatePlayerPoints(perf) })
  }
  return { calculated, skipped }
}

// ---- Fixture time/team parsing (mirrors stats.ts) ----

function serverParseFixtureKickoff(game, now) {
  const dateWithoutWeekday = game.date.includes(',') ? game.date.split(',').slice(1).join(',').trim() : game.date.trim()
  const dateMatch = dateWithoutWeekday.match(/^([A-Za-z]+)\s+(\d{1,2})$/)
  if (!dateMatch) return null
  const timeMatch = game.time.trim().toLowerCase().match(/^(\d{1,2})(?:\.(\d{1,2}))?(am|pm)$/)
  if (!timeMatch) return null
  const months = ['january','february','march','april','may','june','july','august','september','october','november','december']
  const monthIndex = months.indexOf(dateMatch[1].toLowerCase())
  const day = Number.parseInt(dateMatch[2], 10)
  if (monthIndex < 0 || !Number.isFinite(day)) return null
  const hour12 = Number.parseInt(timeMatch[1], 10)
  const minute = Number.parseInt(timeMatch[2] ?? '0', 10)
  if (!Number.isFinite(hour12) || !Number.isFinite(minute)) return null
  let hour24 = hour12 % 12
  if (timeMatch[3] === 'pm') hour24 += 12
  const currentYear = now.getFullYear()
  const kickoff = new Date(currentYear, monthIndex, day, hour24, minute, 0, 0)
  const halfYearMs = 180 * 24 * 60 * 60 * 1000
  if (kickoff.getTime() - now.getTime() > halfYearMs) kickoff.setFullYear(currentYear - 1)
  else if (now.getTime() - kickoff.getTime() > halfYearMs) kickoff.setFullYear(currentYear + 1)
  return kickoff
}

function serverExtractFixtureTeams(game) {
  if (!game.match.includes(' vs ')) return null
  const [home, away] = game.match.split(' vs ')
  const homeTeam = home.trim()
  const awayTeam = away.trim()
  if (!homeTeam || !awayTeam) return null
  // Skip knockout-round placeholders like "Group A Winner" / "Match 1 Winner"
  const placeholderPattern = /winner|runner.?up|match\s+\d/i
  if (placeholderPattern.test(homeTeam) || placeholderPattern.test(awayTeam)) return null
  return [homeTeam, awayTeam]
}

function serverSelectBestMatch(game, matches) {
  if (!game.match.includes(' vs ')) return matches[0] ?? null
  const [home, away] = game.match.split(' vs ')
  const expectedHome = serverNormalizeTeamToken(home.trim())
  const expectedAway = serverNormalizeTeamToken(away.trim())
  return (
    matches.find((m) => serverNormalizeTeamToken(m.homeTeam) === expectedHome && serverNormalizeTeamToken(m.awayTeam) === expectedAway) ??
    matches.find((m) => serverNormalizeTeamToken(m.homeTeam) === expectedAway && serverNormalizeTeamToken(m.awayTeam) === expectedHome) ??
    matches[0] ?? null
  )
}

// ---- Auto-imported event ID helpers ----

function serverReadAutoImportedIds(storage) {
  const raw = storage[serverAutoImportedIdsKey]
  if (!raw) return new Set()
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((v) => typeof v === 'string'))
  } catch { return new Set() }
}

function serverReadPlayerPointsMap(storage) {
  const raw = storage[serverPlayerPointsKey]
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).filter(([k, v]) => typeof k === 'string' && typeof v === 'number' && Number.isFinite(v))
    )
  } catch { return {} }
}

// ---- Main server-side scan ----

let serverScanRunning = false

async function serverScanDueFixturesAndImport() {
  if (serverScanRunning) return
  const apiKey = getApiFootballKey()
  if (!apiKey) {
    console.log('[auto-scan] Skipping — no APIFOOTBALL_API_KEY set.')
    return
  }

  serverScanRunning = true
  console.log(`[auto-scan] Scanning due fixtures at ${new Date().toISOString()}`)

  try {
    const { players } = await getServerPlayers()
    const now = new Date()
    const state = await readLeagueState()
    const importedIds = serverReadAutoImportedIds(state.storage)
    const playerPointsMap = serverReadPlayerPointsMap(state.storage)

    let importedCount = 0
    let appliedPlayers = 0
    let skippedPlayers = 0
    let alreadyImported = 0
    let errors = 0

    for (const matchday of serverFixtureMatchdays) {
      for (const game of matchday.games) {
        const teams = serverExtractFixtureTeams(game)
        if (!teams) continue
        const kickoff = serverParseFixtureKickoff(game, now)
        if (!kickoff) continue
        if (kickoff.getTime() + serverAutoScanDelayMs > now.getTime()) continue

        try {
          const searchRes = await searchFinishedSoccerEvents(game.match)
          const bestMatch = serverSelectBestMatch(game, searchRes)
          if (!bestMatch) { console.log(`[auto-scan] No match found for: ${game.match}`); continue }

          if (importedIds.has(bestMatch.idEvent)) { alreadyImported++; continue }

          if (!bestMatch.idApiFootball) {
            console.log(`[auto-scan] No API-Football ID for: ${bestMatch.name}`)
            continue
          }

          const importedRows = await getApiFootballPlayerStats(bestMatch.idApiFootball, apiKey)
          const { calculated, skipped } = serverCalculateImportedRows(players, importedRows)

          for (const row of calculated) {
            const key = `${row.player.team}::${row.player.name}`
            playerPointsMap[key] = row.points
          }

          importedIds.add(bestMatch.idEvent)
          importedCount++
          appliedPlayers += calculated.length
          skippedPlayers += skipped
          console.log(`[auto-scan] Imported ${bestMatch.name}: ${calculated.length} players, ${skipped} skipped`)
        } catch (err) {
          console.error(`[auto-scan] Error processing ${game.match}:`, err.message)
          errors++
        }
      }
    }

    if (importedCount > 0) {
      const nextStorage = {
        ...state.storage,
        [serverAutoImportedIdsKey]: JSON.stringify(Array.from(importedIds).sort()),
        [serverPlayerPointsKey]: JSON.stringify(playerPointsMap),
      }
      await writeLeagueState(nextStorage)
      console.log(`[auto-scan] Done. Imported: ${importedCount} matches, ${appliedPlayers} players applied, ${skippedPlayers} skipped, ${alreadyImported} already done, ${errors} errors.`)
    } else {
      console.log(`[auto-scan] Done. Nothing new to import (${alreadyImported} already done, ${errors} errors).`)
    }
  } catch (err) {
    console.error('[auto-scan] Unexpected error:', err.message)
  } finally {
    serverScanRunning = false
  }
}

// ---- Scheduler ----

const serverScheduledKeys = new Set()

async function scheduleServerFixtureScans() {
  await getServerPlayers()
  const now = new Date()
  let shouldRunNow = false

  for (const matchday of serverFixtureMatchdays) {
    for (const game of matchday.games) {
      if (!serverExtractFixtureTeams(game)) continue
      const kickoff = serverParseFixtureKickoff(game, now)
      if (!kickoff) continue
      const key = `${game.date}::${game.time}::${game.match}`
      if (serverScheduledKeys.has(key)) continue
      serverScheduledKeys.add(key)
      const dueAtMs = kickoff.getTime() + serverAutoScanDelayMs
      const delayMs = dueAtMs - now.getTime()
      if (delayMs <= 0) {
        shouldRunNow = true
      } else if (delayMs <= serverSchedulerMaxDelayMs) {
        setTimeout(() => { void serverScanDueFixturesAndImport() }, delayMs)
        console.log(`[auto-scan] Scheduled scan for "${game.match}" in ${Math.round(delayMs / 60000)} min`)
      }
    }
  }

  if (shouldRunNow) {
    void serverScanDueFixturesAndImport()
  }
}

// ========== END SERVER-SIDE FIXTURE AUTO-SCANNER ==========

const args = parseArgs(process.argv.slice(2))
const { server } =
  args.mode === 'development'
    ? await createDevelopmentServer(args.host, args.port)
    : await createProductionServer()

server.listen(args.port, args.host, () => {
  console.log(`Fantasy Football server running on http://${args.host}:${args.port} (${args.mode})`)
  // Initial scheduling pass — picks up overdue fixtures and schedules near-future ones.
  void scheduleServerFixtureScans()
  // Re-check every 12 hours to schedule fixtures that were previously out of setTimeout range.
  setInterval(() => { void scheduleServerFixtureScans() }, 12 * 60 * 60 * 1000)
})