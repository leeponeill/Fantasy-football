import { renderPage } from './renderPage'
import { addMatchdayPointsToTotal, getAllPlayers, getPlayerPoints, updatePlayerPoints, type SelectablePlayer } from './teamsData'
import { calculatePlayerPoints, getPointsBreakdownText, type PlayerPerformance } from './pointsCalculator'
import { getCurrentUsername, requireAuth } from './auth'
import { getFixtureMatchdays, type FixtureGame, type FixtureMatchday } from './fixturesData'
import { flushSharedLeagueStorage, getSharedItem, setSharedItem } from './sharedLeague'

requireAuth()

const currentUsername = getCurrentUsername()
if (currentUsername?.toLowerCase() !== 'lee') {
  window.location.href = '/fixtures.html'
  throw new Error('Access denied: only lee can use Award Points')
}

type MatchSearchResult = {
  idEvent: string
  idApiFootball: string
  name: string
  date: string
  league: string
  season: string
  homeTeam: string
  awayTeam: string
  homeScore: string
  awayScore: string
  status: string
}

type ImportedPlayerStat = {
  playerName: string
  teamName: string
  apiPosition: string
  minutesPlayed: number
  goalsScored: number
  assists: number
  goalsConceded: number
  shotSaves: number
  yellowCards: number
  redCards: number
  penaltyMisses: number
  penaltySaves: number
  defensiveContributions: number
}

type ImportedMatchResponse = {
  event?: MatchSearchResult
  players?: ImportedPlayerStat[]
  error?: string
}

type CalculatedImportRow = {
  sourceName: string
  sourceTeam: string
  matchedPlayer: SelectablePlayer
  points: number
  breakdownText: string
}

type CalculatedImportResult = {
  calculated: CalculatedImportRow[]
  skipped: number
  zeroPoint: number
}

type FixtureDueMatch = {
  game: FixtureGame
  kickoff: Date
}

type ScanImportSummary = {
  importedMatchCount: number
  appliedPlayerCount: number
  skippedPlayersTotal: number
  zeroPointPlayersTotal: number
  alreadyImportedCount: number
  unresolvedCount: number
  errorCount: number
  playerImportFailureCount: number
  replacedValuesCount: number
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function toToken(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

const teamAliases: Record<string, string> = {
  unitedstates: 'usa',
  us: 'usa',
  korearepublic: 'southkorea',
  republicofkorea: 'southkorea',
  czechrepublic: 'czechia',
  coteivoire: 'ivorycoast',
  manutd: 'manchesterunited',
  manchesterutd: 'manchesterunited',
  manchesterunited: 'manchesterunited',
  mancity: 'manchestercity',
  manchestercity: 'manchestercity',
  spurs: 'tottenham',
  tottenham: 'tottenham',
  tottenhamhotspur: 'tottenham',
  nottmforest: 'nottinghamforest',
  nottinghamforest: 'nottinghamforest',
  westham: 'westham',
  westhamunited: 'westham',
  wolves: 'wolves',
  wolverhampton: 'wolves',
  wolverhamptonwanderers: 'wolves',
  brighton: 'brighton',
  brightonandhovealbion: 'brighton',
  newcastle: 'newcastle',
  newcastleunited: 'newcastle',
}

const fixtureTeamSearchExpansions: Record<string, string> = {
  "Nott'm Forest": 'Nottingham Forest',
  'Man Utd': 'Manchester United',
  'Man City': 'Manchester City',
  Spurs: 'Tottenham',
}

function normalizeTeamToken(teamName: string): string {
  const token = toToken(teamName)
  const trimmedToken = token.startsWith('afc') && token.length > 3
    ? token.slice(3)
    : token.endsWith('fc') && token.length > 2
      ? token.slice(0, -2)
      : token

  return teamAliases[token] ?? teamAliases[trimmedToken] ?? trimmedToken
}

function getNameParts(value: string): string[] {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((part) => part.length > 0)
}

function namesMatchByInitialAndSurname(sourceName: string, candidateName: string): boolean {
  const sourceParts = getNameParts(sourceName)
  const candidateParts = getNameParts(candidateName)
  if (sourceParts.length < 2 || candidateParts.length < 2) {
    return false
  }

  const sourceSurname = sourceParts[sourceParts.length - 1]
  const candidateSurname = candidateParts[candidateParts.length - 1]
  if (sourceSurname !== candidateSurname) {
    return false
  }

  const sourceInitial = sourceParts[0]?.[0] ?? ''
  const candidateInitial = candidateParts[0]?.[0] ?? ''
  return sourceInitial.length > 0 && sourceInitial === candidateInitial
}

function findLooseNameMatchInTeam(row: ImportedPlayerStat, teamToken: string): SelectablePlayer | null {
  const sourceParts = getNameParts(row.playerName)
  if (sourceParts.length === 0) {
    return null
  }

  const teamPlayers = allPlayers.filter((player) => normalizeTeamToken(player.team) === teamToken)
  if (teamPlayers.length === 0) {
    return null
  }

  // Handle abbreviated source names such as "L. Smyth" by matching initial + surname.
  const initialSurnameMatches = teamPlayers.filter((player) => namesMatchByInitialAndSurname(row.playerName, player.name))
  if (initialSurnameMatches.length === 1) {
    return initialSurnameMatches[0]
  }

  const sourceSurname = sourceParts[sourceParts.length - 1]
  const surnameMatches = teamPlayers.filter((player) => {
    const playerParts = getNameParts(player.name)
    if (playerParts.length === 0) {
      return false
    }

    return playerParts[playerParts.length - 1] === sourceSurname
  })

  if (surnameMatches.length === 1) {
    return surnameMatches[0]
  }

  return null
}

function getPositionType(player: SelectablePlayer): 'Goalkeeper' | 'Defender' | 'Midfielder' | 'Forward' {
  if (player.position === 'Goalkeeper') {
    return 'Goalkeeper'
  }

  if (player.position === 'Defender') {
    return 'Defender'
  }

  if (player.position === 'Forward') {
    return 'Forward'
  }

  return 'Midfielder'
}

const allPlayers = getAllPlayers()
const autoImportedEventIdsStorageKey = 'fantasy-football-auto-imported-event-ids'
const autoImportedGameweeksStorageKey = 'fantasy-football-auto-imported-gameweeks'
const autoAdvancedGameweeksStorageKey = 'fantasy-football-auto-advanced-gameweeks'
const globalMatchdayStorageKey = 'fantasy-football-global-matchday'
const dueFixtureScanDelayMs = 150 * 60 * 1000
const autoGameweekScanDelayMs = 180 * 60 * 1000
const autoGameweekAdvanceDelayMs = 12 * 60 * 60 * 1000
const oneTimeScanMaxDelayMs = 2_147_000_000
let fixtureMatchdays: FixtureMatchday[] = []

const playersByTeamAndName = new Map<string, SelectablePlayer>()
const playersByName = new Map<string, SelectablePlayer[]>()
const knownTeamTokens = new Set<string>()

for (const player of allPlayers) {
  const teamToken = normalizeTeamToken(player.team)
  const nameToken = toToken(player.name)
  knownTeamTokens.add(teamToken)
  playersByTeamAndName.set(`${teamToken}::${nameToken}`, player)

  const existing = playersByName.get(nameToken) ?? []
  existing.push(player)
  playersByName.set(nameToken, existing)
}

function findPlayerForImportedStat(row: ImportedPlayerStat): SelectablePlayer | null {
  const teamToken = normalizeTeamToken(row.teamName)
  const nameToken = toToken(row.playerName)

  const strictMatch = playersByTeamAndName.get(`${teamToken}::${nameToken}`)
  if (strictMatch) {
    return strictMatch
  }

  const byName = playersByName.get(nameToken) ?? []
  if (byName.length === 1) {
    return byName[0]
  }

  const byNameAndTeam = byName.find((player) => normalizeTeamToken(player.team) === teamToken)
  if (byNameAndTeam) {
    return byNameAndTeam
  }

  return findLooseNameMatchInTeam(row, teamToken)
}

const statsMarkup = `
  <section class="stats-container">
    <h2>Award Player Points</h2>
    <p class="section-help">Auto-import stats from a finished game, or enter performance manually.</p>

    <section class="performance-panel" style="margin-bottom: 1.5rem;">
      <h3>Auto Import From Match</h3>
      <div class="performance-form" style="grid-template-columns: 1fr;">
        <div class="form-group">
          <label for="match-search-query">Game Search</label>
          <input id="match-search-query" type="text" placeholder="e.g. England vs France" />
        </div>
        <button id="match-search-btn" type="button" class="calculate-btn">Search Finished Games</button>
        <div class="form-group">
          <label for="match-result-select">Select Match</label>
          <select id="match-result-select">
            <option value="">No match selected</option>
          </select>
        </div>
        <button id="import-match-btn" type="button" class="award-btn" disabled>Auto Calculate And Apply Points</button>
        <button id="scan-due-fixtures-btn" type="button" class="calculate-btn">Scan Due Fixtures (Kickoff + 2.5h)</button>
        <div class="form-group">
          <label for="gameweek-select">Gameweek</label>
          <select id="gameweek-select">
            <option value="">Select gameweek</option>
          </select>
        </div>
        <button id="scan-gameweek-btn" type="button" class="calculate-btn" disabled>Scan Selected Gameweek</button>
        <p id="auto-import-message" class="search-info"></p>
        <p id="auto-scan-schedule" class="search-info">Next auto scans: fixture - ; gameweek -</p>
      </div>
      <ul id="auto-import-preview" class="stats-results" style="margin-top: 1rem;"></ul>
    </section>

    <div class="stats-grid">
      <div class="search-panel">
        <h3>Select Player</h3>
        <input id="player-search-stats" type="text" placeholder="Search player name or team" aria-label="Search players" />
        <p class="search-info" id="search-info"></p>
        <ul class="stats-results" id="stats-results"></ul>
      </div>

      <div class="performance-panel">
        <h3>Manual Performance Data</h3>
        <form id="performance-form" class="performance-form">
          <div class="form-group">
            <label for="minutes-played">Minutes Played:</label>
            <input id="minutes-played" type="number" min="0" max="120" value="90" />
          </div>

          <div class="form-group">
            <label for="goals-scored">Goals Scored:</label>
            <input id="goals-scored" type="number" min="0" value="0" />
          </div>

          <div class="form-group">
            <label for="assists">Assists:</label>
            <input id="assists" type="number" min="0" value="0" />
          </div>

          <div class="form-group">
            <label for="clean-sheet">
              <input id="clean-sheet" type="checkbox" />
              Clean Sheet
            </label>
          </div>

          <div class="form-group">
            <label for="shot-saves">Shot Saves (GK only):</label>
            <input id="shot-saves" type="number" min="0" value="0" />
          </div>

          <div class="form-group">
            <label for="defensive-contributions">Defensive Contributions (CBI+Tackles):</label>
            <input id="defensive-contributions" type="number" min="0" value="0" />
          </div>

          <div class="form-group">
            <label for="penalty-saves">Penalty Saves:</label>
            <input id="penalty-saves" type="number" min="0" value="0" />
          </div>

          <div class="form-group">
            <label for="penalty-misses">Penalty Misses:</label>
            <input id="penalty-misses" type="number" min="0" value="0" />
          </div>

          <div class="form-group">
            <label for="goals-conceded">Goals Conceded (DEF/GK):</label>
            <input id="goals-conceded" type="number" min="0" value="0" />
          </div>

          <div class="form-group">
            <label for="yellow-cards">Yellow Cards:</label>
            <input id="yellow-cards" type="number" min="0" value="0" />
          </div>

          <div class="form-group">
            <label for="red-cards">Red Cards:</label>
            <input id="red-cards" type="number" min="0" value="0" />
          </div>

          <div class="form-group">
            <label for="own-goals">Own Goals:</label>
            <input id="own-goals" type="number" min="0" value="0" />
          </div>

          <div class="form-group">
            <label for="bonus-points">Bonus Points (1-3):</label>
            <input id="bonus-points" type="number" min="0" max="3" value="0" />
          </div>

          <button id="calculate-btn" type="button" class="calculate-btn" disabled>Calculate Points</button>
        </form>

        <div id="points-result" class="points-result" style="display: none;">
          <p class="result-label">Total Points: <span id="total-points-awarded">0</span></p>
          <p class="result-breakdown" id="points-breakdown"></p>
          <button id="award-btn" type="button" class="award-btn">Award Points to Player</button>
        </div>
      </div>
    </div>
  </section>
`

renderPage('Award Points', 'stats', statsMarkup)

const playerSearchStats = document.querySelector<HTMLInputElement>('#player-search-stats')
const statsResults = document.querySelector<HTMLUListElement>('#stats-results')
const searchInfo = document.querySelector<HTMLParagraphElement>('#search-info')
const performanceForm = document.querySelector<HTMLFormElement>('#performance-form')
const calculateBtn = document.querySelector<HTMLButtonElement>('#calculate-btn')
const pointsResult = document.querySelector<HTMLDivElement>('#points-result')
const totalPointsAwarded = document.querySelector<HTMLSpanElement>('#total-points-awarded')
const pointsBreakdown = document.querySelector<HTMLParagraphElement>('#points-breakdown')
const awardBtn = document.querySelector<HTMLButtonElement>('#award-btn')

const matchSearchQuery = document.querySelector<HTMLInputElement>('#match-search-query')
const matchSearchBtn = document.querySelector<HTMLButtonElement>('#match-search-btn')
const matchResultSelect = document.querySelector<HTMLSelectElement>('#match-result-select')
const importMatchBtn = document.querySelector<HTMLButtonElement>('#import-match-btn')
const scanDueFixturesBtn = document.querySelector<HTMLButtonElement>('#scan-due-fixtures-btn')
const gameweekSelect = document.querySelector<HTMLSelectElement>('#gameweek-select')
const scanGameweekBtn = document.querySelector<HTMLButtonElement>('#scan-gameweek-btn')
const autoImportMessage = document.querySelector<HTMLParagraphElement>('#auto-import-message')
const autoScanScheduleMessage = document.querySelector<HTMLParagraphElement>('#auto-scan-schedule')
const autoImportPreview = document.querySelector<HTMLUListElement>('#auto-import-preview')

let selectedPlayer: SelectablePlayer | null = null
let calculatedPoints = 0
let foundMatches: MatchSearchResult[] = []
let isAutoScanRunning = false
const scheduledAutoScanGameweekKeys = new Set<number>()
let nextScheduledFixtureScanAt: number | null = null
let nextScheduledGameweekScanAt: number | null = null

function formatAutoScanTime(timestamp: number | null): string {
  if (timestamp === null) {
    return '-'
  }

  const date = new Date(timestamp)
  return date.toLocaleString([], {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function renderAutoScanScheduleMessage(): void {
  if (!autoScanScheduleMessage) {
    return
  }

  const fixtureLabel = formatAutoScanTime(nextScheduledFixtureScanAt)
  const gameweekLabel = formatAutoScanTime(nextScheduledGameweekScanAt)
  autoScanScheduleMessage.textContent = `Next auto scans: fixture ${fixtureLabel} ; gameweek ${gameweekLabel}`
}

function readAutoImportedEventIds(): Set<string> {
  const raw = getSharedItem(autoImportedEventIdsStorageKey)
  if (!raw) {
    return new Set()
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      return new Set()
    }

    return new Set(parsed.filter((value): value is string => typeof value === 'string'))
  } catch {
    return new Set()
  }
}

function saveAutoImportedEventIds(ids: Set<string>): void {
  setSharedItem(autoImportedEventIdsStorageKey, JSON.stringify(Array.from(ids).sort()))
}

function readAutoImportedGameweeks(): Set<number> {
  const raw = getSharedItem(autoImportedGameweeksStorageKey)
  if (!raw) {
    return new Set()
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      return new Set()
    }

    const values = parsed
      .map((value) => Number.parseInt(String(value), 10))
      .filter((value) => Number.isFinite(value) && value >= 1)
    return new Set(values)
  } catch {
    return new Set()
  }
}

function saveAutoImportedGameweeks(gameweeks: Set<number>): void {
  const sorted = Array.from(gameweeks.values()).sort((a, b) => a - b)
  setSharedItem(autoImportedGameweeksStorageKey, JSON.stringify(sorted))
}

function readAutoAdvancedGameweeks(): Set<number> {
  const raw = getSharedItem(autoAdvancedGameweeksStorageKey)
  if (!raw) {
    return new Set()
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      return new Set()
    }

    const values = parsed
      .map((value) => Number.parseInt(String(value), 10))
      .filter((value) => Number.isFinite(value) && value >= 1)
    return new Set(values)
  } catch {
    return new Set()
  }
}

function saveAutoAdvancedGameweeks(gameweeks: Set<number>): void {
  const sorted = Array.from(gameweeks.values()).sort((a, b) => a - b)
  setSharedItem(autoAdvancedGameweeksStorageKey, JSON.stringify(sorted))
}

function getGlobalMatchday(): number {
  const raw = getSharedItem(globalMatchdayStorageKey)
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  if (Number.isFinite(parsed) && parsed >= 1) {
    return parsed
  }

  return 1
}

function setGlobalMatchday(matchday: number): void {
  const safe = Math.max(1, Math.floor(matchday))
  setSharedItem(globalMatchdayStorageKey, String(safe))
}

function parseFixtureKickoff(game: FixtureGame, now: Date): Date | null {
  const dateWithoutWeekday = game.date.includes(',') ? game.date.split(',').slice(1).join(',').trim() : game.date.trim()
  const dateMatch = dateWithoutWeekday.match(/^([A-Za-z]+)\s+(\d{1,2})$/)
  if (!dateMatch) {
    return null
  }

  const timeMatch = game.time.trim().toLowerCase().match(/^(\d{1,2})(?:\.(\d{1,2}))?(am|pm)$/)
  if (!timeMatch) {
    return null
  }

  const monthName = dateMatch[1]
  const day = Number.parseInt(dateMatch[2], 10)
  const monthIndex = [
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
  ].indexOf(monthName.toLowerCase())

  if (monthIndex < 0 || !Number.isFinite(day)) {
    return null
  }

  const hour12 = Number.parseInt(timeMatch[1], 10)
  const minute = Number.parseInt(timeMatch[2] ?? '0', 10)
  const meridian = timeMatch[3]
  if (!Number.isFinite(hour12) || !Number.isFinite(minute)) {
    return null
  }

  let hour24 = hour12 % 12
  if (meridian === 'pm') {
    hour24 += 12
  }

  const currentYear = now.getFullYear()
  const kickoff = new Date(currentYear, monthIndex, day, hour24, minute, 0, 0)

  const halfYearMs = 180 * 24 * 60 * 60 * 1000
  if (kickoff.getTime() - now.getTime() > halfYearMs) {
    kickoff.setFullYear(currentYear - 1)
  } else if (now.getTime() - kickoff.getTime() > halfYearMs) {
    kickoff.setFullYear(currentYear + 1)
  }

  return kickoff
}

function extractFixtureTeams(matchText: string): [string, string] | null {
  if (!matchText.includes(' vs ')) {
    return null
  }

  const [home, away] = matchText.split(' vs ')
  const homeTeam = home.trim()
  const awayTeam = away.trim()
  if (!homeTeam || !awayTeam) {
    return null
  }

  const homeToken = normalizeTeamToken(homeTeam)
  const awayToken = normalizeTeamToken(awayTeam)
  if (!knownTeamTokens.has(homeToken) || !knownTeamTokens.has(awayToken)) {
    return null
  }

  return [homeTeam, awayTeam]
}

function getFixtureSearchQueries(matchText: string): string[] {
  const queries = new Set<string>()
  const normalized = matchText.trim()
  if (normalized.length >= 3) {
    queries.add(normalized)
  }

  if (!normalized.includes(' vs ')) {
    return Array.from(queries)
  }

  const [rawHome, rawAway] = normalized.split(' vs ')
  const home = rawHome.trim()
  const away = rawAway.trim()
  if (!home || !away) {
    return Array.from(queries)
  }

  const expandedHome = fixtureTeamSearchExpansions[home] ?? home
  const expandedAway = fixtureTeamSearchExpansions[away] ?? away

  queries.add(`${expandedHome} vs ${expandedAway}`)
  queries.add(`${expandedHome} ${expandedAway}`)
  queries.add(`${home} ${away}`)

  return Array.from(queries)
}

type ApiCallResult<T> = {
  ok: boolean
  payload: T
  status: number
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

async function fetchJsonWithRetry<T>(url: string, maxAttempts = 2): Promise<ApiCallResult<T>> {
  let lastStatus = 0
  let lastPayload = {} as T

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url)
      let payload = {} as T

      try {
        payload = (await response.json()) as T
      } catch {
        payload = {} as T
      }

      if (response.ok) {
        return {
          ok: true,
          payload,
          status: response.status,
        }
      }

      lastStatus = response.status
      lastPayload = payload
    } catch {
      lastStatus = 0
      lastPayload = {} as T
    }

    if (attempt < maxAttempts) {
      await delay(250 * attempt)
    }
  }

  return {
    ok: false,
    payload: lastPayload,
    status: lastStatus,
  }
}

function getDueFixtureMatches(now: Date): FixtureDueMatch[] {
  const due: FixtureDueMatch[] = []

  for (const matchday of fixtureMatchdays) {
    for (const game of matchday.games) {
      const teams = extractFixtureTeams(game.match)
      if (!teams) {
        continue
      }

      const kickoff = parseFixtureKickoff(game, now)
      if (!kickoff) {
        continue
      }

      if (kickoff.getTime() + dueFixtureScanDelayMs <= now.getTime()) {
        due.push({ game, kickoff })
      }
    }
  }

  return due
}

function selectBestMatchForFixture(game: FixtureGame, matches: MatchSearchResult[]): MatchSearchResult | null {
  const teams = extractFixtureTeams(game.match)
  if (!teams) {
    return null
  }

  const [homeTeam, awayTeam] = teams
  const expectedHomeToken = normalizeTeamToken(homeTeam)
  const expectedAwayToken = normalizeTeamToken(awayTeam)

  const strict = matches.find((match) => {
    const homeToken = normalizeTeamToken(match.homeTeam)
    const awayToken = normalizeTeamToken(match.awayTeam)
    return homeToken === expectedHomeToken && awayToken === expectedAwayToken
  })
  if (strict) {
    return strict
  }

  const swapped = matches.find((match) => {
    const homeToken = normalizeTeamToken(match.homeTeam)
    const awayToken = normalizeTeamToken(match.awayTeam)
    return homeToken === expectedAwayToken && awayToken === expectedHomeToken
  })
  if (swapped) {
    return swapped
  }

  return matches[0] ?? null
}

function setAutoImportMessage(text: string, type: 'ok' | 'error' | 'info'): void {
  if (!autoImportMessage) {
    return
  }

  autoImportMessage.textContent = text
  autoImportMessage.classList.remove('ok', 'error')
  if (type === 'ok' || type === 'error') {
    autoImportMessage.classList.add(type)
  }
}

function renderAutoImportPreview(rows: CalculatedImportRow[], skippedCount: number): void {
  if (!autoImportPreview) {
    return
  }

  if (rows.length === 0) {
    autoImportPreview.innerHTML = skippedCount > 0
      ? `<li class="stats-player-item"><div class="player-select-btn">No matching players found in your fantasy pool. Skipped: ${skippedCount}</div></li>`
      : ''
    return
  }

  const items = rows
    .slice(0, 80)
    .map(
      (row) => `
        <li class="stats-player-item">
          <div class="player-select-btn" style="display: block; cursor: default;">
            <strong>${escapeHtml(row.matchedPlayer.name)} (${escapeHtml(row.matchedPlayer.team)})</strong>
            <div class="player-meta">Source: ${escapeHtml(row.sourceName)} (${escapeHtml(row.sourceTeam)})</div>
            <div class="player-meta">Points: ${row.points >= 0 ? '+' : ''}${row.points} | ${escapeHtml(row.breakdownText)}</div>
          </div>
        </li>
      `,
    )
    .join('')

  const skippedLine =
    skippedCount > 0
      ? `<li class="stats-player-item"><div class="player-select-btn" style="cursor: default;">Skipped unmatched players: ${skippedCount}</div></li>`
      : ''

  autoImportPreview.innerHTML = `${items}${skippedLine}`
}

function parseScoreValue(value: string): number | null {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) {
    return null
  }

  return parsed
}

function getConcededFromFixtureScore(row: ImportedPlayerStat, event?: MatchSearchResult): number | null {
  if (!event) {
    return null
  }

  const homeToken = normalizeTeamToken(event.homeTeam)
  const awayToken = normalizeTeamToken(event.awayTeam)
  const teamToken = normalizeTeamToken(row.teamName)
  const homeScore = parseScoreValue(event.homeScore)
  const awayScore = parseScoreValue(event.awayScore)
  if (homeScore === null || awayScore === null) {
    return null
  }

  if (teamToken === homeToken) {
    return awayScore
  }

  if (teamToken === awayToken) {
    return homeScore
  }

  return null
}

function setAutoScanButtonsDisabled(disabled: boolean): void {
  if (scanDueFixturesBtn) {
    scanDueFixturesBtn.disabled = disabled
  }

  if (scanGameweekBtn) {
    scanGameweekBtn.disabled = disabled || !gameweekSelect?.value
  }
}

function renderGameweekOptions(): void {
  if (!gameweekSelect) {
    return
  }

  const options = fixtureMatchdays
    .map((matchday) => `<option value="${matchday.matchday}">Gameweek ${matchday.matchday}</option>`)
    .join('')

  gameweekSelect.innerHTML = '<option value="">Select gameweek</option>' + options

  if (scanGameweekBtn) {
    scanGameweekBtn.disabled = !gameweekSelect.value
  }
}

function renderPlayerSearch(): void {
  if (!playerSearchStats || !statsResults || !searchInfo) {
    return
  }

  const query = playerSearchStats.value.trim().toLowerCase()

  if (!query) {
    statsResults.innerHTML = ''
    searchInfo.textContent = ''
    return
  }

  const filtered = allPlayers.filter(
    (player) => player.name.toLowerCase().includes(query) || player.team.toLowerCase().includes(query),
  )

  searchInfo.textContent = `${filtered.length} results found`

  statsResults.innerHTML = filtered
    .slice(0, 50)
    .map((player) => {
      const isSelected = selectedPlayer && selectedPlayer.name === player.name && selectedPlayer.team === player.team
      return `
        <li class="stats-player-item ${isSelected ? 'selected' : ''}">
          <button type="button" class="player-select-btn" data-name="${escapeHtml(player.name)}" data-team="${escapeHtml(player.team)}">
            <div class="player-info">
              <strong>${escapeHtml(player.name)}</strong>
              <span class="player-meta">${escapeHtml(player.team)} • ${escapeHtml(player.position)}</span>
            </div>
          </button>
        </li>
      `
    })
    .join('')
}

function calculatePointsForForm(): void {
  if (!performanceForm || !selectedPlayer) {
    return
  }

  const minutesPlayed = parseInt(performanceForm.querySelector<HTMLInputElement>('#minutes-played')?.value ?? '0', 10)
  const goalsScored = parseInt(performanceForm.querySelector<HTMLInputElement>('#goals-scored')?.value ?? '0', 10)
  const assists = parseInt(performanceForm.querySelector<HTMLInputElement>('#assists')?.value ?? '0', 10)
  const cleanSheet = performanceForm.querySelector<HTMLInputElement>('#clean-sheet')?.checked ?? false
  const shotSaves = parseInt(performanceForm.querySelector<HTMLInputElement>('#shot-saves')?.value ?? '0', 10)
  const defensiveContributions = parseInt(
    performanceForm.querySelector<HTMLInputElement>('#defensive-contributions')?.value ?? '0',
    10,
  )
  const penaltySaves = parseInt(performanceForm.querySelector<HTMLInputElement>('#penalty-saves')?.value ?? '0', 10)
  const penaltyMisses = parseInt(performanceForm.querySelector<HTMLInputElement>('#penalty-misses')?.value ?? '0', 10)
  const goalsConceded = parseInt(performanceForm.querySelector<HTMLInputElement>('#goals-conceded')?.value ?? '0', 10)
  const yellowCards = parseInt(performanceForm.querySelector<HTMLInputElement>('#yellow-cards')?.value ?? '0', 10)
  const redCards = parseInt(performanceForm.querySelector<HTMLInputElement>('#red-cards')?.value ?? '0', 10)
  const ownGoals = parseInt(performanceForm.querySelector<HTMLInputElement>('#own-goals')?.value ?? '0', 10)
  const bonusPoints = parseInt(performanceForm.querySelector<HTMLInputElement>('#bonus-points')?.value ?? '0', 10)

  const performance: PlayerPerformance = {
    position: getPositionType(selectedPlayer),
    minutesPlayed,
    goalsScored,
    assists,
    cleanSheet,
    shotSaves,
    defensiveContributions,
    penaltySaves,
    penaltyMisses,
    goalsConceded,
    yellowCards,
    redCards,
    ownGoals,
    bonusPoints,
  }

  const { points, breakdown } = calculatePlayerPoints(performance)
  calculatedPoints = points

  if (totalPointsAwarded && pointsBreakdown && pointsResult) {
    totalPointsAwarded.textContent = `${points}`
    pointsBreakdown.textContent = getPointsBreakdownText(breakdown)
    pointsResult.style.display = 'block'
  }
}

function calculateImportedRows(
  rows: ImportedPlayerStat[],
  event?: MatchSearchResult,
  options?: { includeZeroPoints?: boolean },
): CalculatedImportResult {
  const calculated: CalculatedImportRow[] = []
  let skipped = 0
  let zeroPoint = 0
  const includeZeroPoints = options?.includeZeroPoints === true

  for (const row of rows) {
    const matchedPlayer = findPlayerForImportedStat(row)
    if (!matchedPlayer) {
      skipped += 1
      continue
    }

    const minutesPlayed = Math.max(0, Math.floor(row.minutesPlayed))
    const resolvedConceded = getConcededFromFixtureScore(row, event)
    const goalsConceded = Math.max(
      0,
      Math.floor(resolvedConceded === null ? row.goalsConceded : resolvedConceded),
    )

    const performance: PlayerPerformance = {
      position: getPositionType(matchedPlayer),
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
      ownGoals: 0,
      bonusPoints: 0,
    }

    const { points, breakdown } = calculatePlayerPoints(performance)
    if (points === 0 && !includeZeroPoints) {
      zeroPoint += 1
      continue
    }

    const breakdownText = getPointsBreakdownText(breakdown)

    calculated.push({
      sourceName: row.playerName,
      sourceTeam: row.teamName,
      matchedPlayer,
      points,
      breakdownText,
    })
  }

  return { calculated, skipped, zeroPoint }
}

async function searchMatches(): Promise<void> {
  if (!matchSearchQuery || !matchResultSelect || !importMatchBtn) {
    return
  }

  const query = matchSearchQuery.value.trim()
  if (query.length < 3) {
    setAutoImportMessage('Enter at least 3 characters to search.', 'error')
    return
  }

  setAutoImportMessage('Searching finished games...', 'info')
  importMatchBtn.disabled = true

  try {
    const response = await fetch(`/api/match-stats/search?query=${encodeURIComponent(query)}`)
    const data = (await response.json()) as { matches?: MatchSearchResult[]; error?: string }

    if (!response.ok) {
      setAutoImportMessage(data.error ?? 'Unable to search matches.', 'error')
      return
    }

    foundMatches = Array.isArray(data.matches) ? data.matches : []

    matchResultSelect.innerHTML =
      '<option value="">Choose a finished match</option>' +
      foundMatches
        .slice(0, 50)
        .map(
          (match) =>
            `<option value="${escapeHtml(match.idEvent)}">${escapeHtml(match.date)} | ${escapeHtml(match.name)} (${escapeHtml(match.homeScore)}-${escapeHtml(match.awayScore)})</option>`,
        )
        .join('')

    setAutoImportMessage(`Found ${foundMatches.length} finished matches.`, 'ok')
  } catch {
    setAutoImportMessage('Unable to search matches right now.', 'error')
  }
}

async function importAndApplyMatchStats(): Promise<void> {
  if (!matchResultSelect) {
    return
  }

  const eventId = matchResultSelect.value
  if (!eventId) {
    setAutoImportMessage('Select a match first.', 'error')
    return
  }

  setAutoImportMessage('Fetching player stats and calculating points...', 'info')

  try {
    const response = await fetch(`/api/match-stats/players?eventId=${encodeURIComponent(eventId)}`)
    const payload = (await response.json()) as ImportedMatchResponse

    if (!response.ok) {
      setAutoImportMessage(payload.error ?? 'Unable to import stats.', 'error')
      renderAutoImportPreview([], 0)
      return
    }

    const importedRows = Array.isArray(payload.players) ? payload.players : []
    const { calculated, skipped, zeroPoint } = calculateImportedRows(importedRows, payload.event)

    for (const row of calculated) {
      updatePlayerPoints(row.matchedPlayer.name, row.matchedPlayer.team, row.points)
    }

    const importedEventIds = readAutoImportedEventIds()
    importedEventIds.add(eventId)
    saveAutoImportedEventIds(importedEventIds)

    await flushSharedLeagueStorage()

    renderAutoImportPreview(calculated, skipped)
    const matchLabel = payload.event?.name ?? 'selected match'
    setAutoImportMessage(
      `Auto import complete for ${matchLabel}: applied ${calculated.length} players, zero-point ${zeroPoint}, skipped ${skipped}.`,
      'ok',
    )
  } catch {
    setAutoImportMessage('Unable to import player stats right now.', 'error')
  }
}

async function scanFixtureGamesAndImport(
  games: FixtureGame[],
  scanLabel: string,
  options?: { skipAlreadyImported?: boolean; includeZeroPoints?: boolean; replaceExistingValues?: boolean },
): Promise<ScanImportSummary> {
  const emptySummary: ScanImportSummary = {
    importedMatchCount: 0,
    appliedPlayerCount: 0,
    skippedPlayersTotal: 0,
    zeroPointPlayersTotal: 0,
    alreadyImportedCount: 0,
    unresolvedCount: 0,
    errorCount: 0,
    playerImportFailureCount: 0,
    replacedValuesCount: 0,
  }

  if (isAutoScanRunning) {
    return emptySummary
  }

  const skipAlreadyImported = options?.skipAlreadyImported !== false
  const includeZeroPoints = options?.includeZeroPoints === true
  const replaceExistingValues = options?.replaceExistingValues === true

  isAutoScanRunning = true
  setAutoScanButtonsDisabled(true)
  setAutoImportMessage(`Scanning ${scanLabel}...`, 'info')

  const importedEventIds = readAutoImportedEventIds()

  let importedMatchCount = 0
  let appliedPlayerCount = 0
  let skippedPlayersTotal = 0
  let zeroPointPlayersTotal = 0
  let alreadyImportedCount = 0
  let unresolvedCount = 0
  let errorCount = 0
  let playerImportFailureCount = 0
  let replacedValuesCount = 0
  let lastSearchErrorDetail = ''
  let lastPlayerImportErrorDetail = ''
  let lastPreviewRows: CalculatedImportRow[] = []

  try {
    for (const game of games) {
      const teams = extractFixtureTeams(game.match)
      if (!teams) {
        unresolvedCount += 1
        continue
      }

      const fixtureQuery = game.match

      try {
        const queries = getFixtureSearchQueries(fixtureQuery)
        let matches: MatchSearchResult[] = []
        let encounteredSearchError = false

        for (let index = 0; index < queries.length; index += 1) {
          const query = queries[index]
          const searchCall = await fetchJsonWithRetry<{ matches?: MatchSearchResult[]; error?: string }>(
            `/api/match-stats/search?query=${encodeURIComponent(query)}`,
            3,
          )

          if (!searchCall.ok) {
            encounteredSearchError = true
            const payloadError = typeof searchCall.payload.error === 'string' ? searchCall.payload.error : ''
            lastSearchErrorDetail = payloadError || `status ${searchCall.status || 'network'}`

            // If the first query fails with server/network issue, skip extra fallback queries for this game.
            if (index === 0) {
              break
            }

            continue
          }

          matches = Array.isArray(searchCall.payload.matches) ? searchCall.payload.matches : []
          if (matches.length > 0) {
            break
          }
        }

        if (matches.length === 0 && encounteredSearchError) {
          errorCount += 1
          continue
        }

        const bestMatch = selectBestMatchForFixture(game, matches)
        if (!bestMatch) {
          unresolvedCount += 1
          continue
        }

        if (skipAlreadyImported && importedEventIds.has(bestMatch.idEvent)) {
          alreadyImportedCount += 1
          continue
        }

        const playerCall = await fetchJsonWithRetry<ImportedMatchResponse>(
          `/api/match-stats/players?eventId=${encodeURIComponent(bestMatch.idEvent)}`,
          2,
        )
        if (!playerCall.ok) {
          playerImportFailureCount += 1
          lastPlayerImportErrorDetail = playerCall.payload.error ?? `status ${playerCall.status || 'network'}`
          unresolvedCount += 1
          continue
        }

        const importedRows = Array.isArray(playerCall.payload.players) ? playerCall.payload.players : []
        const eventForScoring = playerCall.payload.event ?? bestMatch
        const { calculated, skipped, zeroPoint } = calculateImportedRows(importedRows, eventForScoring, {
          includeZeroPoints,
        })
        for (const row of calculated) {
          if (replaceExistingValues) {
            const existingPoints = getPlayerPoints(row.matchedPlayer.name, row.matchedPlayer.team)
            if (existingPoints !== row.points) {
              replacedValuesCount += 1
            }
          }

          updatePlayerPoints(row.matchedPlayer.name, row.matchedPlayer.team, row.points)
        }

        importedEventIds.add(bestMatch.idEvent)
        importedMatchCount += 1
        appliedPlayerCount += calculated.length
        skippedPlayersTotal += skipped
        zeroPointPlayersTotal += zeroPoint
        lastPreviewRows = calculated
      } catch {
        errorCount += 1
      }
    }

    if (importedMatchCount > 0) {
      saveAutoImportedEventIds(importedEventIds)
      await flushSharedLeagueStorage()
    }

    if (lastPreviewRows.length > 0) {
      renderAutoImportPreview(lastPreviewRows, skippedPlayersTotal)
    }

    const details: string[] = []
    if (errorCount > 0 && lastSearchErrorDetail) {
      details.push(`search error: ${lastSearchErrorDetail}`)
    }
    if (playerImportFailureCount > 0 && lastPlayerImportErrorDetail) {
      details.push(`player import error: ${lastPlayerImportErrorDetail}`)
    }
    if (replaceExistingValues) {
      details.push(`replaced values: ${replacedValuesCount}`)
    }

    const detailSuffix = details.length > 0 ? ` (${details.join(' | ')})` : ''

    setAutoImportMessage(
      `${scanLabel} complete: imported matches ${importedMatchCount}, players applied ${appliedPlayerCount}, zero-point ${zeroPointPlayersTotal}, already imported ${alreadyImportedCount}, unresolved ${unresolvedCount}, errors ${errorCount}.${detailSuffix}`,
      importedMatchCount > 0 ? 'ok' : 'info',
    )

    return {
      importedMatchCount,
      appliedPlayerCount,
      skippedPlayersTotal,
      zeroPointPlayersTotal,
      alreadyImportedCount,
      unresolvedCount,
      errorCount,
      playerImportFailureCount,
      replacedValuesCount,
    }
  } finally {
    isAutoScanRunning = false
    setAutoScanButtonsDisabled(false)
  }
}

async function scanDueFixturesAndImport(): Promise<void> {
  const now = new Date()
  const dueFixtures = getDueFixtureMatches(now)
  await scanFixtureGamesAndImport(
    dueFixtures.map((dueFixture) => dueFixture.game),
    'Due fixture scan (kickoff + 2.5h)',
    { skipAlreadyImported: true },
  )
}

async function scanSelectedGameweekAndImport(): Promise<void> {
  if (!gameweekSelect) {
    return
  }

  const selectedGameweek = Number.parseInt(gameweekSelect.value, 10)
  if (!Number.isFinite(selectedGameweek)) {
    setAutoImportMessage('Select a gameweek first.', 'error')
    return
  }

  const matchday = fixtureMatchdays.find((entry) => entry.matchday === selectedGameweek)
  if (!matchday) {
    setAutoImportMessage(`Gameweek ${selectedGameweek} was not found in fixtures.`, 'error')
    return
  }

  await scanFixtureGamesAndImport(matchday.games, `Gameweek ${selectedGameweek} scan`, {
    skipAlreadyImported: false,
    includeZeroPoints: true,
    replaceExistingValues: true,
  })
}

function getLatestKickoffForGameweek(matchday: FixtureMatchday, now: Date): Date | null {
  let latestKickoff: Date | null = null

  for (const game of matchday.games) {
    const teams = extractFixtureTeams(game.match)
    if (!teams) {
      continue
    }

    const kickoff = parseFixtureKickoff(game, now)
    if (!kickoff) {
      continue
    }

    if (!latestKickoff || kickoff.getTime() > latestKickoff.getTime()) {
      latestKickoff = kickoff
    }
  }

  return latestKickoff
}

async function triggerAutoGameweekScan(matchdayNumber: number): Promise<void> {
  const matchday = fixtureMatchdays.find((entry) => entry.matchday === matchdayNumber)
  if (!matchday) {
    return
  }

  const importedGameweeks = readAutoImportedGameweeks()
  if (importedGameweeks.has(matchdayNumber)) {
    return
  }

  if (isAutoScanRunning) {
    window.setTimeout(() => {
      void triggerAutoGameweekScan(matchdayNumber)
    }, 30_000)
    return
  }

  const summary = await scanFixtureGamesAndImport(
    matchday.games,
    `Gameweek ${matchdayNumber} scan (auto +3h after final kickoff)`,
    {
      skipAlreadyImported: false,
      includeZeroPoints: true,
      replaceExistingValues: true,
    },
  )

  const hasPendingFixtures =
    summary.unresolvedCount > 0 ||
    summary.errorCount > 0 ||
    summary.playerImportFailureCount > 0

  if (hasPendingFixtures) {
    window.setTimeout(() => {
      void triggerAutoGameweekScan(matchdayNumber)
    }, 30 * 60 * 1000)
    return
  }

  importedGameweeks.add(matchdayNumber)
  saveAutoImportedGameweeks(importedGameweeks)
  await flushSharedLeagueStorage()
}

async function triggerAutoGameweekAdvance(matchdayNumber: number): Promise<void> {
  const advancedGameweeks = readAutoAdvancedGameweeks()
  if (advancedGameweeks.has(matchdayNumber)) {
    return
  }

  const current = getGlobalMatchday()
  if (current <= matchdayNumber) {
    // Keep auto-advance behavior aligned with manual End Gameweek: roll points and clear current map.
    addMatchdayPointsToTotal()
    setGlobalMatchday(matchdayNumber + 1)
  }

  advancedGameweeks.add(matchdayNumber)
  saveAutoAdvancedGameweeks(advancedGameweeks)
  await flushSharedLeagueStorage()
}

function scheduleOneTimeGameweekScans(now: Date): void {
  const nowMs = now.getTime()
  let nextRunAt: number | null = null
  const advancedGameweeks = readAutoAdvancedGameweeks()

  for (const matchday of fixtureMatchdays) {
    if (scheduledAutoScanGameweekKeys.has(matchday.matchday)) {
      continue
    }

    const latestKickoff = getLatestKickoffForGameweek(matchday, now)
    if (!latestKickoff) {
      continue
    }

    const runAtMs = latestKickoff.getTime() + autoGameweekScanDelayMs
    const delayMs = runAtMs - now.getTime()
    scheduledAutoScanGameweekKeys.add(matchday.matchday)
    const advanceAtMs = runAtMs + autoGameweekAdvanceDelayMs
    const advanceDelayMs = advanceAtMs - nowMs

    if (delayMs <= 0) {
      if (nextRunAt === null || nowMs < nextRunAt) {
        nextRunAt = nowMs
      }
      void triggerAutoGameweekScan(matchday.matchday)
    } else {
      if (delayMs > oneTimeScanMaxDelayMs) {
        continue
      }

      if (nextRunAt === null || runAtMs < nextRunAt) {
        nextRunAt = runAtMs
      }

      window.setTimeout(() => {
        void triggerAutoGameweekScan(matchday.matchday)
      }, delayMs)
    }

    if (advancedGameweeks.has(matchday.matchday)) {
      continue
    }

    if (advanceDelayMs <= 0) {
      void triggerAutoGameweekAdvance(matchday.matchday)
      continue
    }

    if (advanceDelayMs > oneTimeScanMaxDelayMs) {
      continue
    }

    window.setTimeout(() => {
      void triggerAutoGameweekAdvance(matchday.matchday)
    }, advanceDelayMs)
  }

  nextScheduledGameweekScanAt = nextRunAt
  renderAutoScanScheduleMessage()
}

const scheduledAutoScanFixtureKeys = new Set<string>()

function getFixtureScheduleKey(game: FixtureGame): string {
  return `${game.date}::${game.time}::${game.match}`
}

function scheduleOneTimeFixtureScans(now: Date): void {
  let shouldRunImmediateScan = false
  const nowMs = now.getTime()
  let nextRunAt: number | null = null

  for (const matchday of fixtureMatchdays) {
    for (const game of matchday.games) {
      const teams = extractFixtureTeams(game.match)
      if (!teams) {
        continue
      }

      const kickoff = parseFixtureKickoff(game, now)
      if (!kickoff) {
        continue
      }

      const fixtureKey = getFixtureScheduleKey(game)
      if (scheduledAutoScanFixtureKeys.has(fixtureKey)) {
        continue
      }

      const dueAtMs = kickoff.getTime() + dueFixtureScanDelayMs
      const delayMs = dueAtMs - now.getTime()

      scheduledAutoScanFixtureKeys.add(fixtureKey)

      if (delayMs <= 0) {
        shouldRunImmediateScan = true
        if (nextRunAt === null || nowMs < nextRunAt) {
          nextRunAt = nowMs
        }
        continue
      }

      if (delayMs > oneTimeScanMaxDelayMs) {
        continue
      }

      if (nextRunAt === null || dueAtMs < nextRunAt) {
        nextRunAt = dueAtMs
      }

      window.setTimeout(() => {
        void scanDueFixturesAndImport()
      }, delayMs)
    }
  }

  nextScheduledFixtureScanAt = nextRunAt
  renderAutoScanScheduleMessage()

  if (shouldRunImmediateScan) {
    void scanDueFixturesAndImport()
  }
}

if (matchSearchBtn) {
  matchSearchBtn.addEventListener('click', () => {
    void searchMatches()
  })
}

if (matchResultSelect && importMatchBtn) {
  matchResultSelect.addEventListener('change', () => {
    importMatchBtn.disabled = !matchResultSelect.value
  })
}

if (importMatchBtn) {
  importMatchBtn.addEventListener('click', () => {
    void importAndApplyMatchStats()
  })
}

if (scanDueFixturesBtn) {
  scanDueFixturesBtn.addEventListener('click', () => {
    void scanDueFixturesAndImport()
  })
}

if (gameweekSelect) {
  gameweekSelect.addEventListener('change', () => {
    if (scanGameweekBtn && !isAutoScanRunning) {
      scanGameweekBtn.disabled = !gameweekSelect.value
    }
  })
}

if (scanGameweekBtn) {
  scanGameweekBtn.addEventListener('click', () => {
    void scanSelectedGameweekAndImport()
  })
}

if (playerSearchStats) {
  playerSearchStats.addEventListener('input', renderPlayerSearch)
}

if (statsResults) {
  statsResults.addEventListener('click', (event) => {
    const target = event.target as HTMLElement
    const btn = target.closest<HTMLButtonElement>('.player-select-btn')
    if (!btn) {
      return
    }

    const name = btn.dataset.name
    const team = btn.dataset.team

    if (!name || !team) {
      return
    }

    selectedPlayer = allPlayers.find((player) => player.name === name && player.team === team) ?? null

    if (playerSearchStats && selectedPlayer) {
      playerSearchStats.value = `${selectedPlayer.name} (${selectedPlayer.team})`
      calculateBtn?.removeAttribute('disabled')
    }

    renderPlayerSearch()
  })
}

if (calculateBtn) {
  calculateBtn.addEventListener('click', calculatePointsForForm)
}

if (performanceForm) {
  const inputs = performanceForm.querySelectorAll('input[type="number"], input[type="checkbox"]')
  inputs.forEach((input) => {
    input.addEventListener('input', () => {
      if (selectedPlayer && calculateBtn && !calculateBtn.disabled) {
        calculatePointsForForm()
      }
    })
    input.addEventListener('change', () => {
      if (selectedPlayer && calculateBtn && !calculateBtn.disabled) {
        calculatePointsForForm()
      }
    })
  })
}

if (awardBtn) {
  awardBtn.addEventListener('click', async () => {
    if (!selectedPlayer) {
      return
    }

    updatePlayerPoints(selectedPlayer.name, selectedPlayer.team, calculatedPoints)
    await flushSharedLeagueStorage()

    alert(`${selectedPlayer.name} awarded ${calculatedPoints} points!`)
    if (playerSearchStats) {
      playerSearchStats.value = ''
    }
    selectedPlayer = null
    calculateBtn?.setAttribute('disabled', '')
    if (pointsResult) {
      pointsResult.style.display = 'none'
    }
    renderPlayerSearch()
  })
}

async function initializeStatsPage(): Promise<void> {
  renderPlayerSearch()

  try {
    fixtureMatchdays = await getFixtureMatchdays()
    renderGameweekOptions()
  } catch {
    setAutoImportMessage('Unable to load fixture list for auto scan.', 'error')
  }

  scheduleOneTimeFixtureScans(new Date())
  scheduleOneTimeGameweekScans(new Date())
}

void initializeStatsPage()
