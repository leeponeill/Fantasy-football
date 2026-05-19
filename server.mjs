import { createServer as createHttpServer } from 'node:http'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dataDirectory = path.join(__dirname, 'data')
const leagueStatePath = path.join(dataDirectory, 'league-state.json')
const fixturesPath = path.join(dataDirectory, 'fixtures.json')
const distDirectory = path.join(__dirname, 'dist')
const envFilePath = path.join(__dirname, '.env')
const teamStatePrefix = 'fantasy-football-my-team-state::'
const usersStorageKey = 'fantasy-football-users'
const draftModeStorageKey = 'fantasy-football-draft-mode'
const benchModeStorageKey = 'fantasy-football-bench-mode'
const draftOrderStorageKey = 'fantasy-football-draft-order'
const draftNextIndexStorageKey = 'fantasy-football-draft-next-index'
const globalMatchdayStorageKey = 'fantasy-football-global-matchday'
const transferRequestsStorageKey = 'fantasy-football-transfer-requests'
const transferHistoryStorageKey = 'fantasy-football-transfer-history'

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

const positionLimits = {
  'Goalkeeper': 1,
  'Defender': 5,
  'Midfielder': 5,
  'Forward': 3,
}

function positionBucket(position) {
  if (!position || typeof position !== 'string') {
    return 'Forward'
  }

  const upper = position.toUpperCase()
  if (upper.includes('GOAL')) {
    return 'Goalkeeper'
  }
  if (upper.includes('DEF') || upper === 'D') {
    return 'Defender'
  }
  if (upper.includes('MID') || upper === 'M') {
    return 'Midfielder'
  }
  return 'Forward'
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

function sanitizeFixtureMatchdays(value) {
  if (!Array.isArray(value)) {
    return []
  }

  const validCountries = new Set(['Mexico', 'USA', 'Canada'])
  const sanitized = []

  for (const item of value) {
    if (!item || typeof item !== 'object') {
      continue
    }

    const matchdayRaw = item.matchday
    const gamesRaw = item.games
    if (!Number.isFinite(matchdayRaw) || !Array.isArray(gamesRaw)) {
      continue
    }

    const games = gamesRaw
      .filter((game) => game && typeof game === 'object')
      .map((game) => ({
        match: typeof game.match === 'string' ? game.match : '',
        time: typeof game.time === 'string' ? game.time : '',
        country: typeof game.country === 'string' && validCountries.has(game.country) ? game.country : null,
        date: typeof game.date === 'string' ? game.date : '',
      }))
      .filter((game) => game.match && game.time && game.date && game.country)
      .map((game) => ({
        match: game.match,
        time: game.time,
        country: game.country,
        date: game.date,
      }))

    if (games.length === 0) {
      continue
    }

    sanitized.push({
      matchday: Number(matchdayRaw),
      games,
    })
  }

  return sanitized
}

async function readFixtureMatchdays() {
  const raw = await readFile(fixturesPath, 'utf8')
  const parsed = JSON.parse(raw)
  return sanitizeFixtureMatchdays(parsed)
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

function getRegisteredUsernames(storage) {
  const raw = storage[usersStorageKey]
  if (typeof raw !== 'string') {
    return []
  }

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }

    const usernames = []
    for (const entry of parsed) {
      const username = typeof entry?.username === 'string' ? entry.username.trim() : ''
      if (username.length > 0) {
        usernames.push(username)
      }
    }

    return usernames
  } catch {
    return []
  }
}

function getGlobalMatchday(storage) {
  const raw = storage[globalMatchdayStorageKey]
  const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : Number.NaN
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1
}

function parseSelectedPlayerKeys(rawValue) {
  try {
    const parsed = JSON.parse(rawValue)
    if (!parsed || typeof parsed !== 'object') {
      return []
    }

    return Array.isArray(parsed.selectedPlayerKeys)
      ? parsed.selectedPlayerKeys.filter((value) => typeof value === 'string')
      : []
  } catch {
    return []
  }
}

function parseBenchPlayerKeys(rawValue) {
  try {
    const parsed = JSON.parse(rawValue)
    if (!parsed || typeof parsed !== 'object') {
      return []
    }

    return Array.isArray(parsed.benchPlayerKeys)
      ? parsed.benchPlayerKeys.filter((value) => typeof value === 'string')
      : []
  } catch {
    return []
  }
}

function getTeamPlayerCounts(storage) {
  const counts = new Map()

  for (const [storageKey, rawValue] of Object.entries(storage)) {
    if (!storageKey.startsWith(teamStatePrefix) || typeof rawValue !== 'string') {
      continue
    }

    const username = storageKey.slice(teamStatePrefix.length)
    counts.set(username, parseSelectedPlayerKeys(rawValue).length)
  }

  return counts
}

function areAllTeamsEmpty(storage) {
  for (const [storageKey, rawValue] of Object.entries(storage)) {
    if (!storageKey.startsWith(teamStatePrefix) || typeof rawValue !== 'string') {
      continue
    }

    if (parseSelectedPlayerKeys(rawValue).length > 0) {
      return false
    }

    if (parseBenchPlayerKeys(rawValue).length > 0) {
      return false
    }
  }

  return true
}

function getBenchModeStatus(storage) {
  return {
    enabled: storage[benchModeStorageKey] !== 'false',
    canToggle: areAllTeamsEmpty(storage),
  }
}

function normalizeDraftOrder(rawOrder, validUsernames) {
  const canonicalByLower = new Map(validUsernames.map((username) => [username.toLowerCase(), username]))
  const seen = new Set()
  const order = []

  for (const entry of rawOrder) {
    if (typeof entry !== 'string') {
      continue
    }

    const normalized = entry.trim().toLowerCase()
    if (!normalized || seen.has(normalized) || !canonicalByLower.has(normalized)) {
      continue
    }

    seen.add(normalized)
    order.push(canonicalByLower.get(normalized))
  }

  return order
}

function getDraftOrder(storage, validUsernames) {
  const raw = storage[draftOrderStorageKey]
  if (typeof raw !== 'string') {
    return []
  }

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }

    return normalizeDraftOrder(parsed, validUsernames)
  } catch {
    return []
  }
}

function getNextEligibleDraftIndex(order, counts, startIndex) {
  if (order.length === 0) {
    return -1
  }

  for (let offset = 0; offset < order.length; offset += 1) {
    const index = (startIndex + offset) % order.length
    const username = order[index]
    const playerCount = counts.get(username) ?? 0
    if (playerCount < 11) {
      return index
    }
  }

  return -1
}

function getDraftStatus(storage) {
  const enabled = storage[draftModeStorageKey] === 'true'
  const usernames = getRegisteredUsernames(storage)
  const order = getDraftOrder(storage, usernames)
  const playerCounts = getTeamPlayerCounts(storage)
  const matchday = getGlobalMatchday(storage)
  const canEnable = matchday === 1 && areAllTeamsEmpty(storage)

  const rawNextIndex = Number.parseInt(storage[draftNextIndexStorageKey] ?? '0', 10)
  const startIndex = Number.isFinite(rawNextIndex) && rawNextIndex >= 0 ? rawNextIndex : 0
  const currentIndex = getNextEligibleDraftIndex(order, playerCounts, startIndex)

  return {
    enabled,
    canEnable,
    order,
    complete: order.length > 0 && currentIndex === -1,
    currentTurn: currentIndex === -1 ? null : order[currentIndex],
    currentIndex,
    matchday,
    playerCounts,
  }
}

function getUserTeamState(rawValue) {
  try {
    const parsed = JSON.parse(rawValue)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { base: {}, selectedPlayerKeys: [], remainingBudget: 100 }
    }

    const remainingBudgetRaw = parsed.remainingBudget
    const remainingBudget = Number.isFinite(remainingBudgetRaw) ? Number(remainingBudgetRaw) : 100

    return {
      base: parsed,
      selectedPlayerKeys: Array.isArray(parsed.selectedPlayerKeys)
        ? parsed.selectedPlayerKeys.filter((value) => typeof value === 'string')
        : [],
      remainingBudget: Math.max(0, Number(remainingBudget.toFixed(1))),
    }
  } catch {
    return { base: {}, selectedPlayerKeys: [], remainingBudget: 100 }
  }
}

function readTransferRequests(storage) {
  const raw = storage[transferRequestsStorageKey]
  if (typeof raw !== 'string') {
    return []
  }

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({
        id: typeof item.id === 'string' ? item.id : '',
        playerKey: typeof item.playerKey === 'string' ? item.playerKey : '',
        playerName: typeof item.playerName === 'string' ? item.playerName : '',
        marketPrice: Number.isFinite(item.marketPrice) ? Number(item.marketPrice) : 0,
        position: typeof item.position === 'string' ? item.position : '',
        fromUser: typeof item.fromUser === 'string' ? item.fromUser : '',
        toUser: typeof item.toUser === 'string' ? item.toUser : '',
        offeredPrice: Number.isFinite(item.offeredPrice) ? Number(item.offeredPrice) : 0,
        status: typeof item.status === 'string' ? item.status : 'pending',
        createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
        resolvedAt: typeof item.resolvedAt === 'string' ? item.resolvedAt : '',
      }))
      .filter((item) => item.id && item.playerKey && item.fromUser && item.toUser)
  } catch {
    return []
  }
}

function getPlayerOwner(storage, playerKey) {
  for (const [storageKey, rawValue] of Object.entries(storage)) {
    if (!storageKey.startsWith(teamStatePrefix) || typeof rawValue !== 'string') {
      continue
    }

    const selectedPlayerKeys = parseSelectedPlayerKeys(rawValue)
    if (selectedPlayerKeys.includes(playerKey)) {
      return storageKey.slice(teamStatePrefix.length)
    }
  }

  return null
}

function readTransferHistory(storage) {
  const raw = storage[transferHistoryStorageKey]
  if (typeof raw !== 'string') {
    return []
  }

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({
        id: typeof item.id === 'string' ? item.id : '',
        playerKey: typeof item.playerKey === 'string' ? item.playerKey : '',
        playerName: typeof item.playerName === 'string' ? item.playerName : '',
        buyerUser: typeof item.buyerUser === 'string' ? item.buyerUser : '',
        sellerUser: typeof item.sellerUser === 'string' ? item.sellerUser : '',
        marketPrice: Number.isFinite(item.marketPrice) ? Number(item.marketPrice) : 0,
        salePrice: Number.isFinite(item.salePrice) ? Number(item.salePrice) : 0,
        type: typeof item.type === 'string' ? item.type : 'unknown',
        createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
      }))
      .filter((item) => item.id && item.playerKey && item.createdAt)
  } catch {
    return []
  }
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

  if (request.method === 'GET' && url.pathname === '/api/draft-mode') {
    try {
      const state = await readLeagueState()
      const draft = getDraftStatus(state.storage)
      sendJson(response, 200, {
        enabled: draft.enabled,
        canEnable: draft.canEnable,
        order: draft.order,
        currentTurn: draft.currentTurn,
        complete: draft.complete,
        matchday: draft.matchday,
      })
    } catch {
      sendJson(response, 500, { error: 'Unable to read draft mode.' })
    }
    return true
  }

  if (request.method === 'GET' && url.pathname === '/api/bench-mode') {
    try {
      const state = await readLeagueState()
      const benchMode = getBenchModeStatus(state.storage)
      sendJson(response, 200, benchMode)
    } catch {
      sendJson(response, 500, { error: 'Unable to read bench mode.' })
    }
    return true
  }

  if (request.method === 'POST' && url.pathname === '/api/bench-mode') {
    try {
      const body = await readJsonBody(request)
      const user = typeof body.user === 'string' ? body.user.trim().toLowerCase() : ''
      if (user !== 'lee') {
        sendJson(response, 403, { error: 'Only lee can change bench mode.' })
        return true
      }

      const enabled = body.enabled === true
      const state = await readLeagueState()
      const benchMode = getBenchModeStatus(state.storage)
      if (!benchMode.canToggle) {
        sendJson(response, 409, { error: 'Cannot change bench mode while users have players selected.' })
        return true
      }

      const nextStorage = { ...state.storage, [benchModeStorageKey]: enabled ? 'true' : 'false' }
      await writeLeagueState(nextStorage)
      sendJson(response, 200, { enabled })
    } catch {
      sendJson(response, 500, { error: 'Unable to update bench mode.' })
    }
    return true
  }

  if (request.method === 'POST' && url.pathname === '/api/draft-mode') {
    try {
      const body = await readJsonBody(request)
      const user = typeof body.user === 'string' ? body.user.trim().toLowerCase() : ''
      if (user !== 'lee') {
        sendJson(response, 403, { error: 'Only lee can change draft mode.' })
        return true
      }
      const enabling = body.enabled === true
      const state = await readLeagueState()

      const matchday = getGlobalMatchday(state.storage)
      if (matchday !== 1) {
        sendJson(response, 409, { error: 'Draft mode can only be changed before matchday 1 starts.' })
        return true
      }

      if (enabling) {
        if (!areAllTeamsEmpty(state.storage)) {
          sendJson(response, 409, { error: 'Cannot enable draft mode while users have players selected.' })
          return true
        }
      }

      const nextStorage = { ...state.storage, [draftModeStorageKey]: enabling ? 'true' : 'false' }
      if (!enabling) {
        delete nextStorage[draftOrderStorageKey]
        delete nextStorage[draftNextIndexStorageKey]
      }
      await writeLeagueState(nextStorage)
      sendJson(response, 200, { enabled: enabling })
    } catch {
      sendJson(response, 500, { error: 'Unable to update draft mode.' })
    }
    return true
  }

  if (request.method === 'POST' && url.pathname === '/api/draft-order') {
    try {
      const body = await readJsonBody(request)
      const user = typeof body.user === 'string' ? body.user.trim().toLowerCase() : ''
      if (user !== 'lee') {
        sendJson(response, 403, { error: 'Only lee can set draft order.' })
        return true
      }

      const state = await readLeagueState()
      const draft = getDraftStatus(state.storage)
      if (!draft.enabled) {
        sendJson(response, 409, { error: 'Enable draft mode first.' })
        return true
      }
      if (draft.matchday !== 1) {
        sendJson(response, 409, { error: 'Draft can only be configured before matchday 1 starts.' })
        return true
      }
      if (!areAllTeamsEmpty(state.storage)) {
        sendJson(response, 409, { error: 'All users must have empty teams before setting draft order.' })
        return true
      }

      const usernames = getRegisteredUsernames(state.storage)
      if (usernames.length < 2) {
        sendJson(response, 409, { error: 'At least two registered users are required for draft mode.' })
        return true
      }

      const rawOrder = Array.isArray(body.order)
        ? body.order
        : typeof body.order === 'string'
          ? body.order.split(',')
          : []
      const order = normalizeDraftOrder(rawOrder, usernames)

      if (order.length !== usernames.length) {
        sendJson(response, 400, { error: 'Draft order must include each registered user exactly once.' })
        return true
      }

      const nextStorage = {
        ...state.storage,
        [draftOrderStorageKey]: JSON.stringify(order),
        [draftNextIndexStorageKey]: '0',
      }
      await writeLeagueState(nextStorage)
      sendJson(response, 200, { order, currentTurn: order[0] })
    } catch {
      sendJson(response, 500, { error: 'Unable to save draft order.' })
    }
    return true
  }

  if (request.method === 'POST' && url.pathname === '/api/draft-pick') {
    try {
      const state = await readLeagueState()
      const draft = getDraftStatus(state.storage)
      if (!draft.enabled) {
        sendJson(response, 409, { error: 'Draft mode is not enabled.' })
        return true
      }
      if (draft.matchday !== 1) {
        sendJson(response, 409, { error: 'Draft picks are only allowed before matchday 1 starts.' })
        return true
      }
      if (draft.complete || !draft.currentTurn || draft.currentIndex < 0) {
        sendJson(response, 409, { error: 'Draft is complete or not configured yet.' })
        return true
      }

      const body = await readJsonBody(request)
      const user = typeof body.user === 'string' ? body.user.trim() : ''
      const playerKey = typeof body.playerKey === 'string' ? body.playerKey.trim() : ''
      if (!user || !playerKey) {
        sendJson(response, 400, { error: 'user and playerKey are required.' })
        return true
      }
      if (user.toLowerCase() !== draft.currentTurn.toLowerCase()) {
        sendJson(response, 409, { error: `It is ${draft.currentTurn}'s turn.` })
        return true
      }

      for (const [storageKey, rawValue] of Object.entries(state.storage)) {
        if (!storageKey.startsWith(teamStatePrefix) || typeof rawValue !== 'string') {
          continue
        }
        const pickedKeys = parseSelectedPlayerKeys(rawValue)
        if (pickedKeys.includes(playerKey)) {
          sendJson(response, 409, { error: 'That player has already been drafted.' })
          return true
        }
      }

      const userStorageKey = `${teamStatePrefix}${draft.currentTurn}`
      const currentUserState = getUserTeamState(state.storage[userStorageKey] ?? '{}')
      if (currentUserState.selectedPlayerKeys.length >= 11) {
        sendJson(response, 409, { error: 'Current turn user already has 11 players.' })
        return true
      }

      const nextUserKeys = [...currentUserState.selectedPlayerKeys, playerKey]
      const nextStorage = {
        ...state.storage,
        [userStorageKey]: JSON.stringify({
          ...currentUserState.base,
          selectedPlayerKeys: nextUserKeys,
        }),
      }

      const nextCounts = getTeamPlayerCounts(nextStorage)
      const nextIndex = getNextEligibleDraftIndex(draft.order, nextCounts, draft.currentIndex + 1)
      nextStorage[draftNextIndexStorageKey] = String(nextIndex < 0 ? 0 : nextIndex)

      await writeLeagueState(nextStorage)
      sendJson(response, 200, {
        complete: nextIndex < 0,
        currentTurn: nextIndex < 0 ? null : draft.order[nextIndex],
      })
    } catch {
      sendJson(response, 500, { error: 'Unable to save draft pick.' })
    }
    return true
  }

  if (request.method === 'GET' && url.pathname === '/api/player-transfer-requests') {
    const user = (url.searchParams.get('user') ?? '').trim()
    if (!user) {
      sendJson(response, 400, { error: 'user is required.' })
      return true
    }

    try {
      const state = await readLeagueState()
      const draft = getDraftStatus(state.storage)
      if (!draft.enabled) {
        sendJson(response, 200, { incoming: [], outgoing: [] })
        return true
      }
      const requests = readTransferRequests(state.storage)
      const incoming = requests.filter((item) => item.toUser.toLowerCase() === user.toLowerCase())
      const outgoing = requests.filter((item) => item.fromUser.toLowerCase() === user.toLowerCase())
      sendJson(response, 200, { incoming, outgoing })
    } catch {
      sendJson(response, 500, { error: 'Unable to read transfer requests.' })
    }
    return true
  }

  if (request.method === 'GET' && url.pathname === '/api/transfer-history') {
    try {
      const state = await readLeagueState()
      const draft = getDraftStatus(state.storage)
      if (!draft.enabled) {
        sendJson(response, 200, { sales: [] })
        return true
      }

      const sales = readTransferHistory(state.storage)
        .slice()
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      sendJson(response, 200, { sales })
    } catch {
      sendJson(response, 500, { error: 'Unable to read transfer history.' })
    }
    return true
  }

  if (request.method === 'POST' && url.pathname === '/api/transfer-history') {
    try {
      const body = await readJsonBody(request)
      const user = typeof body.user === 'string' ? body.user.trim() : ''
      const eventType = typeof body.type === 'string' ? body.type.trim() : ''
      const playerKey = typeof body.playerKey === 'string' ? body.playerKey.trim() : ''
      const playerName = typeof body.playerName === 'string' ? body.playerName.trim() : ''
      const marketPriceRaw = Number(body.marketPrice)
      const salePriceRaw = Number(body.salePrice)
      const marketPrice = Number.isFinite(marketPriceRaw) ? Number(marketPriceRaw.toFixed(1)) : Number.NaN
      const salePrice = Number.isFinite(salePriceRaw) ? Number(salePriceRaw.toFixed(1)) : Number.NaN

      if (!user || !playerKey || !playerName || !Number.isFinite(marketPrice) || !Number.isFinite(salePrice)) {
        sendJson(response, 400, { error: 'Invalid transfer history payload.' })
        return true
      }

      if (eventType !== 'market-buy' && eventType !== 'market-sell') {
        sendJson(response, 400, { error: 'Invalid transfer history type.' })
        return true
      }

      const state = await readLeagueState()
      const draft = getDraftStatus(state.storage)
      if (!draft.enabled) {
        sendJson(response, 409, { error: 'Transfer history is only tracked in draft mode.' })
        return true
      }

      const sales = readTransferHistory(state.storage)
      const nextSale = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        playerKey,
        playerName,
        buyerUser: eventType === 'market-buy' ? user : 'Open Market',
        sellerUser: eventType === 'market-sell' ? user : 'Open Market',
        marketPrice,
        salePrice,
        type: eventType,
        createdAt: new Date().toISOString(),
      }

      const nextStorage = {
        ...state.storage,
        [transferHistoryStorageKey]: JSON.stringify([...sales, nextSale]),
      }
      await writeLeagueState(nextStorage)
      sendJson(response, 200, { sale: nextSale })
    } catch {
      sendJson(response, 500, { error: 'Unable to write transfer history.' })
    }
    return true
  }

  if (request.method === 'POST' && url.pathname === '/api/player-transfer-requests') {
    try {
      const body = await readJsonBody(request)
      const fromUser = typeof body.user === 'string' ? body.user.trim() : ''
      const playerKey = typeof body.playerKey === 'string' ? body.playerKey.trim() : ''
      const playerName = typeof body.playerName === 'string' ? body.playerName.trim() : ''
      const position = typeof body.position === 'string' ? body.position.trim() : ''
      const marketPriceRaw = Number(body.marketPrice)
      const marketPrice = Number.isFinite(marketPriceRaw) ? Number(marketPriceRaw.toFixed(1)) : Number.NaN
      const offeredPriceRaw = Number(body.offeredPrice)
      const offeredPrice = Number.isFinite(offeredPriceRaw) ? Number(offeredPriceRaw.toFixed(1)) : Number.NaN
      if (!fromUser || !playerKey || !playerName || !position || !Number.isFinite(marketPrice) || !Number.isFinite(offeredPrice) || offeredPrice < 0) {
        sendJson(response, 400, { error: 'user, playerKey, playerName, position, marketPrice and a valid offeredPrice are required.' })
        return true
      }

      const state = await readLeagueState()
      const draft = getDraftStatus(state.storage)
      if (!draft.enabled) {
        sendJson(response, 409, { error: 'Transfer requests require draft mode to be enabled.' })
        return true
      }
      if (draft.matchday === 1 && !draft.complete) {
        sendJson(response, 409, { error: 'Transfer requests are only available after the draft is complete.' })
        return true
      }

      const owner = getPlayerOwner(state.storage, playerKey)
      if (!owner) {
        sendJson(response, 404, { error: 'Player is not currently owned.' })
        return true
      }
      if (owner.toLowerCase() === fromUser.toLowerCase()) {
        sendJson(response, 409, { error: 'You already own that player.' })
        return true
      }

      const requests = readTransferRequests(state.storage)
      const hasPending = requests.some(
        (item) =>
          item.status === 'pending' &&
          item.playerKey === playerKey &&
          item.fromUser.toLowerCase() === fromUser.toLowerCase() &&
          item.toUser.toLowerCase() === owner.toLowerCase(),
      )
      if (hasPending) {
        sendJson(response, 409, { error: 'A request for this player is already pending.' })
        return true
      }

      const nextRequest = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        playerKey,
        playerName,
        marketPrice,
        position,
        fromUser,
        toUser: owner,
        offeredPrice,
        status: 'pending',
        createdAt: new Date().toISOString(),
      }
      const nextStorage = {
        ...state.storage,
        [transferRequestsStorageKey]: JSON.stringify([...requests, nextRequest]),
      }
      await writeLeagueState(nextStorage)
      sendJson(response, 200, { request: nextRequest })
    } catch {
      sendJson(response, 500, { error: 'Unable to create transfer request.' })
    }
    return true
  }

  if (request.method === 'POST' && url.pathname === '/api/player-transfer-requests/respond') {
    try {
      const body = await readJsonBody(request)
      const user = typeof body.user === 'string' ? body.user.trim() : ''
      const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : ''
      const decision = typeof body.decision === 'string' ? body.decision.trim().toLowerCase() : ''

      if (!user || !requestId || (decision !== 'accept' && decision !== 'deny')) {
        sendJson(response, 400, { error: 'user, requestId and decision (accept|deny) are required.' })
        return true
      }

      const state = await readLeagueState()
      const draft = getDraftStatus(state.storage)
      if (!draft.enabled) {
        sendJson(response, 409, { error: 'Transfer responses require draft mode to be enabled.' })
        return true
      }
      const requests = readTransferRequests(state.storage)
      const requestIndex = requests.findIndex((item) => item.id === requestId)
      if (requestIndex < 0) {
        sendJson(response, 404, { error: 'Transfer request not found.' })
        return true
      }

      const targetRequest = requests[requestIndex]
      if (targetRequest.toUser.toLowerCase() !== user.toLowerCase()) {
        sendJson(response, 403, { error: 'Only the current owner can respond to this request.' })
        return true
      }
      if (targetRequest.status !== 'pending') {
        sendJson(response, 409, { error: 'This request has already been processed.' })
        return true
      }

      const now = new Date().toISOString()
      const nextStorage = { ...state.storage }

      if (decision === 'accept') {
        const ownerStorageKey = `${teamStatePrefix}${targetRequest.toUser}`
        const requesterStorageKey = `${teamStatePrefix}${targetRequest.fromUser}`
        const ownerState = getUserTeamState(state.storage[ownerStorageKey] ?? '{}')
        const requesterState = getUserTeamState(state.storage[requesterStorageKey] ?? '{}')

        if (!ownerState.selectedPlayerKeys.includes(targetRequest.playerKey)) {
          sendJson(response, 409, { error: 'Owner no longer has this player.' })
          return true
        }
        if (requesterState.selectedPlayerKeys.includes(targetRequest.playerKey)) {
          sendJson(response, 409, { error: 'Requester already has this player.' })
          return true
        }
        if (requesterState.selectedPlayerKeys.length >= 11) {
          sendJson(response, 409, { error: 'Requester already has 11 players.' })
          return true
        }
        if (requesterState.remainingBudget < targetRequest.offeredPrice) {
          sendJson(response, 409, { error: 'Requester does not have enough budget for this offer.' })
          return true
        }

        const nextOwnerBudget = Number((ownerState.remainingBudget + targetRequest.offeredPrice).toFixed(1))
        const nextRequesterBudget = Number((requesterState.remainingBudget - targetRequest.offeredPrice).toFixed(1))

        nextStorage[ownerStorageKey] = JSON.stringify({
          ...ownerState.base,
          selectedPlayerKeys: ownerState.selectedPlayerKeys.filter((key) => key !== targetRequest.playerKey),
          remainingBudget: nextOwnerBudget,
        })
        nextStorage[requesterStorageKey] = JSON.stringify({
          ...requesterState.base,
          selectedPlayerKeys: [...requesterState.selectedPlayerKeys, targetRequest.playerKey],
          remainingBudget: Math.max(0, nextRequesterBudget),
        })

        const sales = readTransferHistory(state.storage)
        const nextSale = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          playerKey: targetRequest.playerKey,
          playerName: targetRequest.playerName ?? targetRequest.playerKey,
          buyerUser: targetRequest.fromUser,
          sellerUser: targetRequest.toUser,
          marketPrice: Number.isFinite(targetRequest.marketPrice)
            ? Number(targetRequest.marketPrice)
            : Number(targetRequest.offeredPrice ?? 0),
          salePrice: Number(targetRequest.offeredPrice ?? 0),
          type: 'user-transfer',
          createdAt: now,
        }
        nextStorage[transferHistoryStorageKey] = JSON.stringify([...sales, nextSale])
      }

      const nextRequests = [...requests]
      nextRequests[requestIndex] = {
        ...targetRequest,
        status: decision === 'accept' ? 'accepted' : 'denied',
        resolvedAt: now,
      }
      nextStorage[transferRequestsStorageKey] = JSON.stringify(nextRequests)

      await writeLeagueState(nextStorage)
      sendJson(response, 200, { ok: true })
    } catch {
      sendJson(response, 500, { error: 'Unable to respond to transfer request.' })
    }
    return true
  }

  if (request.method === 'GET' && url.pathname === '/api/claimed-players') {
    const requestingUser = (url.searchParams.get('user') ?? '').trim()
    try {
      const state = await readLeagueState()
      if (state.storage[draftModeStorageKey] !== 'true') {
        sendJson(response, 200, { claimed: {} })
        return true
      }
      // Map of playerKey -> username for all players claimed by other users
      const claimed = {}
      for (const [storageKey, rawValue] of Object.entries(state.storage)) {
        if (!storageKey.startsWith(teamStatePrefix)) continue
        const owner = storageKey.slice(teamStatePrefix.length)
        if (owner === requestingUser) continue
        try {
          const teamState = JSON.parse(rawValue)
          if (!Array.isArray(teamState.selectedPlayerKeys)) continue
          for (const playerKey of teamState.selectedPlayerKeys) {
            if (typeof playerKey === 'string') {
              claimed[playerKey] = owner
            }
          }
        } catch { /* skip malformed entries */ }
      }
      sendJson(response, 200, { claimed })
    } catch {
      sendJson(response, 500, { error: 'Unable to read claimed players.' })
    }
    return true
  }

  if (request.method === 'GET' && url.pathname === '/api/fixtures') {
    try {
      const matchdays = await readFixtureMatchdays()
      sendJson(response, 200, { matchdays })
    } catch {
      sendJson(response, 500, { error: 'Unable to read fixtures file.' })
    }
    return true
  }

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
    const fixtureMatchdays = await readFixtureMatchdays()
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

    for (const matchday of fixtureMatchdays) {
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
  let fixtureMatchdays = []
  try {
    fixtureMatchdays = await readFixtureMatchdays()
  } catch (err) {
    console.error('[auto-scan] Unable to read fixtures file:', err.message)
    return
  }

  await getServerPlayers()
  const now = new Date()
  let shouldRunNow = false

  for (const matchday of fixtureMatchdays) {
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