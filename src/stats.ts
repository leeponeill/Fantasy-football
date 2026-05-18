import { renderPage } from './renderPage'
import { getAllPlayers, updatePlayerPoints, type SelectablePlayer } from './teamsData'
import { calculatePlayerPoints, getPointsBreakdownText, type PlayerPerformance } from './pointsCalculator'
import { getCurrentUsername, requireAuth } from './auth'
import { fixtureMatchdays, type FixtureGame } from './fixturesData'
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

type FixtureDueMatch = {
  game: FixtureGame
  kickoff: Date
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
}

function normalizeTeamToken(teamName: string): string {
  const token = toToken(teamName)
  return teamAliases[token] ?? token
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
const autoScanDelayMs = 150 * 60 * 1000
const oneTimeScanMaxDelayMs = 2_147_000_000

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
  return byNameAndTeam ?? null
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
        <p id="auto-import-message" class="search-info"></p>
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
const autoImportMessage = document.querySelector<HTMLParagraphElement>('#auto-import-message')
const autoImportPreview = document.querySelector<HTMLUListElement>('#auto-import-preview')

let selectedPlayer: SelectablePlayer | null = null
let calculatedPoints = 0
let foundMatches: MatchSearchResult[] = []
let isAutoScanRunning = false
const scheduledAutoScanFixtureKeys = new Set<string>()

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

function getFixtureKey(game: FixtureGame): string {
  return `${game.date}::${game.time}::${game.match}`
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

      if (kickoff.getTime() + autoScanDelayMs <= now.getTime()) {
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

function calculateImportedRows(rows: ImportedPlayerStat[]): { calculated: CalculatedImportRow[]; skipped: number } {
  const calculated: CalculatedImportRow[] = []
  let skipped = 0

  for (const row of rows) {
    const matchedPlayer = findPlayerForImportedStat(row)
    if (!matchedPlayer) {
      skipped += 1
      continue
    }

    const minutesPlayed = Math.max(0, Math.floor(row.minutesPlayed))
    const goalsConceded = Math.max(0, Math.floor(row.goalsConceded))

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
    const breakdownText = getPointsBreakdownText(breakdown)

    calculated.push({
      sourceName: row.playerName,
      sourceTeam: row.teamName,
      matchedPlayer,
      points,
      breakdownText,
    })
  }

  return { calculated, skipped }
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
    const { calculated, skipped } = calculateImportedRows(importedRows)

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
      `Auto import complete for ${matchLabel}: applied ${calculated.length} players, skipped ${skipped}.`,
      'ok',
    )
  } catch {
    setAutoImportMessage('Unable to import player stats right now.', 'error')
  }
}

async function scanDueFixturesAndImport(): Promise<void> {
  if (isAutoScanRunning) {
    return
  }

  isAutoScanRunning = true
  if (scanDueFixturesBtn) {
    scanDueFixturesBtn.disabled = true
  }
  setAutoImportMessage('Scanning due fixtures (kickoff + 2.5h)...', 'info')

  const now = new Date()
  const dueFixtures = getDueFixtureMatches(now)
  const importedEventIds = readAutoImportedEventIds()

  let importedMatchCount = 0
  let appliedPlayerCount = 0
  let skippedPlayersTotal = 0
  let alreadyImportedCount = 0
  let unresolvedCount = 0
  let errorCount = 0
  let lastPreviewRows: CalculatedImportRow[] = []

  for (const dueFixture of dueFixtures) {
    const fixtureQuery = dueFixture.game.match

    try {
      const searchResponse = await fetch(`/api/match-stats/search?query=${encodeURIComponent(fixtureQuery)}`)
      const searchPayload = (await searchResponse.json()) as { matches?: MatchSearchResult[]; error?: string }
      if (!searchResponse.ok) {
        errorCount += 1
        continue
      }

      const matches = Array.isArray(searchPayload.matches) ? searchPayload.matches : []
      const bestMatch = selectBestMatchForFixture(dueFixture.game, matches)
      if (!bestMatch) {
        unresolvedCount += 1
        continue
      }

      if (importedEventIds.has(bestMatch.idEvent)) {
        alreadyImportedCount += 1
        continue
      }

      const playerResponse = await fetch(`/api/match-stats/players?eventId=${encodeURIComponent(bestMatch.idEvent)}`)
      const playerPayload = (await playerResponse.json()) as ImportedMatchResponse
      if (!playerResponse.ok) {
        unresolvedCount += 1
        continue
      }

      const importedRows = Array.isArray(playerPayload.players) ? playerPayload.players : []
      const { calculated, skipped } = calculateImportedRows(importedRows)
      for (const row of calculated) {
        updatePlayerPoints(row.matchedPlayer.name, row.matchedPlayer.team, row.points)
      }

      importedEventIds.add(bestMatch.idEvent)
      importedMatchCount += 1
      appliedPlayerCount += calculated.length
      skippedPlayersTotal += skipped
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

  setAutoImportMessage(
    `Due fixture scan complete: imported matches ${importedMatchCount}, players applied ${appliedPlayerCount}, already imported ${alreadyImportedCount}, unresolved ${unresolvedCount}, errors ${errorCount}.`,
    importedMatchCount > 0 ? 'ok' : 'info',
  )

  if (scanDueFixturesBtn) {
    scanDueFixturesBtn.disabled = false
  }
  isAutoScanRunning = false
}

function scheduleOneTimeFixtureScans(now: Date): void {
  let shouldRunImmediateScan = false

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

      const fixtureKey = getFixtureKey(game)
      if (scheduledAutoScanFixtureKeys.has(fixtureKey)) {
        continue
      }

      const dueAtMs = kickoff.getTime() + autoScanDelayMs
      const delayMs = dueAtMs - now.getTime()

      if (delayMs <= 0) {
        scheduledAutoScanFixtureKeys.add(fixtureKey)
        shouldRunImmediateScan = true
        continue
      }

      if (delayMs > oneTimeScanMaxDelayMs) {
        continue
      }

      scheduledAutoScanFixtureKeys.add(fixtureKey)
      window.setTimeout(() => {
        void scanDueFixturesAndImport()
      }, delayMs)
    }
  }

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

renderPlayerSearch()
void scanDueFixturesAndImport()
scheduleOneTimeFixtureScans(new Date())
