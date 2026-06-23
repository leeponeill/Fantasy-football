import { renderPage } from './renderPage'
import {
  getAllUsernames,
  getUserTotalPoints,
  getTeamNameForUser,
  getTeamTileDisplayPreferenceForUser,
  requireAuth,
  userScopedStorageKey,
} from './auth'
import { getLeaguesForUser, joinLeague, type LeagueRecord } from './leagues'
import {
  getAllPlayers,
  getCurrentMatchdayPlayerPoints,
  type SelectablePlayer,
  getCountryFlag,
  getTeamKitColors,
} from './teamsData'
import { flushSharedLeagueStorage, getSharedItem, sharedLeagueUpdatedEvent } from './sharedLeague'
import {
  getTransferAwarePlayerCurrentPoints,
  parseTransferPointEvents,
  type TransferPointEvent,
} from './transferPoints'

type SavedTeamState = {
  selectedPlayerKeys: string[]
  isTeamLocked?: boolean
  transfersUsedThisMatchday?: number
  captainPlayerKey?: string | null
  captainBonusTotal?: number
  ownedPointsTotal?: number
  currentMatchday?: number
  transferPointEvents?: TransferPointEvent[]
}

type UserTeamState = {
  selectedPlayerKeys: string[]
  players: SelectablePlayer[]
  isTeamLocked: boolean
  transfersUsedThisMatchday: number
  currentMatchday: number
  transferPointEvents: TransferPointEvent[]
  ownedPointsTotal: number | null
}

type LeaderboardRow = {
  username: string
  teamName: string
  points: number
  teamValue: number
  players: SelectablePlayer[]
  captainPlayerKey: string | null
  selectedPlayerKeys: string[]
  transfersUsedThisMatchday: number
  currentMatchday: number
  transferPointEvents: TransferPointEvent[]
}

const maxTransfersPerMatchday = 3
const unlimitedTransferMatchday = 0

function getGlobalMatchday(): number {
  const raw = getSharedItem('fantasy-football-global-matchday')
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed
  }

  return 1
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function renderPitchPlayerName(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 2) {
    return `${escapeHtml(parts[0])}<br />${escapeHtml(parts[1])}`
  }

  return escapeHtml(name)
}

requireAuth()
const currentUsername = requireAuth()

const allPlayers = getAllPlayers()
const playerByKey = new Map(allPlayers.map((player) => [`${player.team}::${player.name}`, player]))

function teamPlayedToken(name: string): string {
  const t = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '')
  if (t === 'iriran') return 'iran'
  if (t === 'korearepublic') return 'southkorea'
  return t
}

let teamsPlayedThisMatchday = new Set<string>()

type TeamTileDisplayMode = 'flag' | 'name'

function getTeamTileDisplayMode(): TeamTileDisplayMode {
  const perUserPreference = getTeamTileDisplayPreferenceForUser(currentUsername)
  if (perUserPreference) {
    return perUserPreference
  }

  return 'flag'
}

function renderTeamIdentity(player: SelectablePlayer): string {
  if (getTeamTileDisplayMode() === 'name') {
    return `<div class="player-flag player-team-name">${escapeHtml(player.team)}</div>`
  }

  return `<div class="player-flag">${getCountryFlag(player.team)}</div>`
}

function readUserTeam(username: string): UserTeamState {
  const storageKey = userScopedStorageKey('fantasy-football-my-team-state', username)
  const raw = getSharedItem(storageKey)

  if (!raw) {
    return {
      selectedPlayerKeys: [],
      players: [],
      isTeamLocked: false,
      transfersUsedThisMatchday: 0,
      currentMatchday: 1,
      transferPointEvents: [],
      ownedPointsTotal: null,
    }
  }

  try {
    const state = JSON.parse(raw) as SavedTeamState
    const keys = Array.isArray(state.selectedPlayerKeys) ? state.selectedPlayerKeys : []
    const players = keys
      .map((key) => playerByKey.get(key))
      .filter((player): player is SelectablePlayer => Boolean(player))

    return {
      selectedPlayerKeys: keys,
      players,
      transfersUsedThisMatchday: Number.isFinite(state.transfersUsedThisMatchday)
        ? Math.max(0, Math.floor(Number(state.transfersUsedThisMatchday)))
        : 0,
      currentMatchday: Number.isFinite(state.currentMatchday) ? Math.max(0, Number(state.currentMatchday)) : 1,
      transferPointEvents: parseTransferPointEvents(state.transferPointEvents),
      ownedPointsTotal: Number.isFinite(state.ownedPointsTotal) ? Math.max(0, Number(state.ownedPointsTotal)) : null,
      isTeamLocked: (Number.isFinite(state.currentMatchday) ? Math.max(0, Number(state.currentMatchday)) : 1) !== unlimitedTransferMatchday,
    }
  } catch {
    return {
      selectedPlayerKeys: [],
      players: [],
      isTeamLocked: false,
      transfersUsedThisMatchday: 0,
      currentMatchday: 1,
      transferPointEvents: [],
      ownedPointsTotal: null,
    }
  }
}

function getTransfersRemainingForRow(row: LeaderboardRow): number {
  const globalMatchday = getGlobalMatchday()
  const effectiveMatchday = row.currentMatchday === globalMatchday ? row.currentMatchday : globalMatchday

  if (effectiveMatchday === unlimitedTransferMatchday) {
    return Number.POSITIVE_INFINITY
  }

  if (row.currentMatchday !== globalMatchday) {
    return maxTransfersPerMatchday
  }

  return Math.max(0, maxTransfersPerMatchday - row.transfersUsedThisMatchday)
}

function getCurrentPointsByPlayerKey(playerKey: string): number {
  const parts = playerKey.split('::')
  if (parts.length < 2) {
    return 0
  }

  const teamName = parts[0]
  const playerName = parts.slice(1).join('::')
  return getCurrentMatchdayPlayerPoints(playerName, teamName)
}

function getTeamValue(players: SelectablePlayer[]): number {
  return Number(players.reduce((sum, player) => sum + player.price, 0).toFixed(1))
}

function buildLeaderboard(usernames: string[]): LeaderboardRow[] {
  return usernames
    .map((username) => {
      const userTeamState = readUserTeam(username)
      const players = userTeamState.players
      const storageKey = userScopedStorageKey('fantasy-football-my-team-state', username)
      const raw = getSharedItem(storageKey)

      let captainPlayerKey: string | null = null
      if (raw) {
        try {
          const state = JSON.parse(raw) as SavedTeamState
          captainPlayerKey = typeof state.captainPlayerKey === 'string' ? state.captainPlayerKey : null
        } catch {
          captainPlayerKey = null
        }
      }

      const displayedPoints = getUserTotalPoints(username)
      return {
        username,
        teamName: getTeamNameForUser(username) ?? username,
        players,
        points: displayedPoints,
        teamValue: getTeamValue(players),
        captainPlayerKey,
        selectedPlayerKeys: userTeamState.selectedPlayerKeys,
        transfersUsedThisMatchday: userTeamState.transfersUsedThisMatchday,
        currentMatchday: userTeamState.currentMatchday,
        transferPointEvents: userTeamState.transferPointEvents,
      }
    })
    .sort((a, b) => {
      if (b.points !== a.points) {
        return b.points - a.points
      }
      if (b.teamValue !== a.teamValue) {
        return b.teamValue - a.teamValue
      }
      return a.teamName.localeCompare(b.teamName)
    })
}

function getUserRank(username: string, rows: LeaderboardRow[]): number | null {
  const index = rows.findIndex((row) => row.username === username)
  return index === -1 ? null : index + 1
}

const tableMarkup = `
  <div id="league-tables" class="league-tables"></div>

  <section class="league-join-card">
    <div class="league-join-copy">
      <h2>Your Leagues</h2>
      <p class="players-help">Enter a league ID from admin to join a table. You can belong to multiple leagues.</p>
    </div>
    <form id="league-join-form" class="league-join-form">
      <input
        id="league-join-id"
        class="admin-team-name-input"
        name="leagueId"
        type="text"
        placeholder="Enter league ID"
        autocomplete="off"
        required
      />
      <button type="submit" class="lock-team-btn">Join League</button>
    </form>
    <p id="league-join-message" class="admin-message" aria-live="polite"></p>
  </section>
`

renderPage('Table', 'table', tableMarkup)

const leagueTables = document.querySelector<HTMLDivElement>('#league-tables')
const leagueJoinForm = document.querySelector<HTMLFormElement>('#league-join-form')
const leagueJoinMessage = document.querySelector<HTMLParagraphElement>('#league-join-message')
const selectedUsernamesByLeague = new Map<string, string | null>()
const expandedLeagues = new Map<string, boolean>()

function setLeagueJoinMessage(text: string, type: 'ok' | 'error'): void {
  if (!leagueJoinMessage) {
    return
  }

  leagueJoinMessage.textContent = text
  leagueJoinMessage.classList.remove('ok', 'error')
  leagueJoinMessage.classList.add(type)
}

function getLeagueLeaderboards(): Array<{ league: LeagueRecord; rows: LeaderboardRow[] }> {
  const registeredUsernames = new Set(getAllUsernames().map((username) => username.toLowerCase()))
  return getLeaguesForUser(currentUsername)
    .map((league) => ({
      league,
      rows: buildLeaderboard(
        league.members.filter((member) => registeredUsernames.has(member.toLowerCase())),
      ),
    }))
}

function renderSelectedTeamMarkup(selected: LeaderboardRow | undefined): string {
  if (!selected) {
    return '<p class="empty-state">No team found.</p>'
  }

  if (selected.players.length === 0) {
    return '<p class="empty-state">No players selected.</p>'
  }

  const positionBucket = (position: string): 'Goalkeeper' | 'Defender' | 'Midfielder' | 'Forward' => {
    if (position === 'Goalkeeper') return 'Goalkeeper'
    if (position === 'Defender') return 'Defender'
    if (position === 'Forward' || position === 'Midfielder/Forward') return 'Forward'
    return 'Midfielder'
  }

  const renderRow = (players: SelectablePlayer[], leadingMarkup = '', rowClass = ''): string => {
    if (players.length === 0) {
      return ''
    }

    const playerCards = players
      .map(
        (player) => {
          const kitColors = getTeamKitColors(player.team)
          const key = `${player.team}::${player.name}`
          const played = teamsPlayedThisMatchday.has(teamPlayedToken(player.team))
          const currentPlayerPoints = getTransferAwarePlayerCurrentPoints(
            key,
            selected.selectedPlayerKeys,
            selected.currentMatchday,
            selected.transferPointEvents,
            getCurrentPointsByPlayerKey,
          )
          const displayedPlayerPoints = selected.captainPlayerKey === key
            ? currentPlayerPoints * 2
            : currentPlayerPoints
          return `
          <div class="pitch-player">
            <div class="player-card${played ? ' team-has-played' : ''}" style="--kit-bg: ${kitColors.backgroundColor}; --kit-text: ${kitColors.textColor}; --kit-border: ${kitColors.borderColor};">
              ${selected.captainPlayerKey === key ? '<div class="captain-badge">C</div>' : ''}
              ${played ? '<div class="team-played-badge">✓</div>' : ''}
              <div class="player-name">${renderPitchPlayerName(player.name)}</div>
              <div class="player-details">
                <div class="player-price">£${player.price.toFixed(1)}</div>
                ${renderTeamIdentity(player)}
                <div class="player-points">${displayedPlayerPoints}pts</div>
              </div>
            </div>
          </div>
        `
        },
      )
      .join('')

    return `
      <div class="pitch-row${rowClass ? ` ${rowClass}` : ''}">
        ${leadingMarkup}
        <div class="pitch-row-players">${playerCards}</div>
      </div>
    `
  }

  const goalkeepers = selected.players.filter((player) => positionBucket(player.position) === 'Goalkeeper')
  const defenders = selected.players.filter((player) => positionBucket(player.position) === 'Defender')
  const midfielders = selected.players.filter((player) => positionBucket(player.position) === 'Midfielder')
  const forwards = selected.players.filter((player) => positionBucket(player.position) === 'Forward')
  const transfersRemaining = getTransfersRemainingForRow(selected)
  const transfersCopy = Number.isFinite(transfersRemaining)
    ? `Transfers Left This Gameweek: ${transfersRemaining}`
    : 'Transfers Left This Gameweek: Unlimited'
  const transferNoteMarkup = `<p class="readonly-transfer-note pitch-transfer-note">${escapeHtml(transfersCopy)}</p>`

  return `
    <h3 class="selected-team-heading">${escapeHtml(selected.teamName)}</h3>
    <div class="football-pitch">
      <div class="pitch">
        ${renderRow(goalkeepers, transferNoteMarkup, 'pitch-row-with-transfer-note')}
        ${renderRow(defenders)}
        ${renderRow(midfielders)}
        ${renderRow(forwards)}
      </div>
    </div>
    <p class="readonly-team-summary">Total Points: ${selected.points} | Team Value: £${selected.teamValue.toFixed(1)}</p>
  `
}

function renderLeagueTables(): void {
  if (!leagueTables) {
    return
  }

  const existingSections = leagueTables.querySelectorAll<HTMLDetailsElement>('details.league-table-section')
  for (const section of existingSections) {
    const leagueId = section.dataset.leagueId
    if (leagueId) {
      expandedLeagues.set(leagueId, section.open)
    }
  }

  const leagueLeaderboards = getLeagueLeaderboards()
  const leagueIds = new Set(leagueLeaderboards.map(({ league }) => league.id))
  for (const knownLeagueId of Array.from(expandedLeagues.keys())) {
    if (!leagueIds.has(knownLeagueId)) {
      expandedLeagues.delete(knownLeagueId)
    }
  }

  if (leagueLeaderboards.length === 0) {
    leagueTables.innerHTML = '<section class="leaderboard-panel"><p class="empty-state">You are not in any leagues yet. Join one with a league ID.</p></section>'
    return
  }

  leagueTables.innerHTML = leagueLeaderboards
    .map(({ league, rows }) => {
        const isExpanded = expandedLeagues.get(league.id) ?? true
      const selectedUsername = selectedUsernamesByLeague.get(league.id)
      const activeUsername = selectedUsername && rows.some((row) => row.username === selectedUsername)
        ? selectedUsername
        : rows[0]?.username ?? null
      selectedUsernamesByLeague.set(league.id, activeUsername)

      const activeRow = rows.find((row) => row.username === activeUsername)
      const currentRank = getUserRank(currentUsername, rows)
      const rankCopy = currentRank === null
        ? 'Your Rank: -'
        : `Your Rank: #${currentRank} (${rows[currentRank - 1]?.teamName ?? currentUsername})`

      const leaderboardMarkup = rows.length === 0
        ? '<li class="empty-state">No users in this league yet.</li>'
        : rows
            .map((row, index) => {
              const isActive = row.username === activeUsername
              return `
                <li>
                  <button
                    type="button"
                    class="leaderboard-row ${isActive ? 'active' : ''}"
                    data-league-id="${escapeHtml(league.id)}"
                    data-username="${escapeHtml(row.username)}"
                  >
                    <span class="leaderboard-rank">#${index + 1}</span>
                    <span class="leaderboard-name">
                      <span class="leaderboard-team-name">${escapeHtml(row.teamName)}</span>
                      <span class="leaderboard-username">${escapeHtml(row.username)}</span>
                    </span>
                    <span class="leaderboard-value">£${row.teamValue.toFixed(1)}</span>
                    <span class="leaderboard-points">${row.points} pts</span>
                  </button>
                </li>
              `
            })
            .join('')

        return `
          <details class="league-table-section" data-league-id="${escapeHtml(league.id)}"${isExpanded ? ' open' : ''}>
          <summary class="league-table-summary">
            <div class="league-summary-copy">
              <h2>${escapeHtml(league.name)}</h2>
              <div class="league-summary-meta">
                <span class="league-id-chip">${escapeHtml(league.id)}</span>
                <span class="league-summary-count">${league.members.length} member${league.members.length === 1 ? '' : 's'}</span>
              </div>
            </div>
          </summary>

          <div class="league-table-content">
            <section class="leaderboard-grid">
              <div class="leaderboard-panel">
                <h3>League Table</h3>
                <p class="players-help">Users are ordered by total points, then team value.</p>
                <p class="rank-badge">${rankCopy}</p>
                <ol class="leaderboard-list">${leaderboardMarkup}</ol>
              </div>

              <div class="leaderboard-panel">
                <h3>Selected Team</h3>
                <p class="players-help">Read-only view. Team cannot be edited from this tab.</p>
                <div class="readonly-team-wrap">${renderSelectedTeamMarkup(activeRow)}</div>
              </div>
            </section>
          </div>
        </details>
      `
    })
    .join('')
}

function refreshTableView(): void {
  renderLeagueTables()
}

if (leagueJoinForm) {
  leagueJoinForm.addEventListener('submit', async (event) => {
    event.preventDefault()

    const formData = new FormData(leagueJoinForm)
    const leagueId = String(formData.get('leagueId') ?? '')
    const result = joinLeague(leagueId, currentUsername)
    if (!result.ok || !result.league) {
      setLeagueJoinMessage(result.error ?? 'Unable to join league.', 'error')
      return
    }

    await flushSharedLeagueStorage()

    leagueJoinForm.reset()
    setLeagueJoinMessage(`Joined ${result.league.name}.`, 'ok')
    refreshTableView()
  })
}

if (leagueTables) {
  leagueTables.addEventListener('click', (event) => {
    const target = event.target as HTMLElement
    const button = target.closest<HTMLButtonElement>('button.leaderboard-row')
    if (!button) {
      return
    }

    const leagueId = button.dataset.leagueId
    const username = button.dataset.username
    if (!leagueId || !username) {
      return
    }

    selectedUsernamesByLeague.set(leagueId, username)
    refreshTableView()
  })
}

window.addEventListener('focus', refreshTableView)
window.addEventListener('storage', (event) => {
  if (!event.key || event.key.startsWith('fantasy-football-')) {
    refreshTableView()
  }
})
window.addEventListener(sharedLeagueUpdatedEvent, refreshTableView)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    refreshTableView()
  }
})

void (() => {
  const currentMatchdayRaw = getSharedItem('fantasy-football-global-matchday')
  const currentMatchday = currentMatchdayRaw ? Number.parseInt(currentMatchdayRaw, 10) : 1
  const raw = getSharedItem('fantasy-football-fixture-results')
  const results: Array<{ match: string; homeScore?: string; awayScore?: string }> =
    raw ? (JSON.parse(raw) as Array<{ match: string; homeScore?: string; awayScore?: string }>) : []
  const teamCount: Record<string, number> = {}
  for (const result of results) {
    if (result.homeScore !== undefined && result.awayScore !== undefined) {
      const [home, away] = result.match.split(' vs ')
      if (home) teamCount[home.trim()] = (teamCount[home.trim()] ?? 0) + 1
      if (away) teamCount[away.trim()] = (teamCount[away.trim()] ?? 0) + 1
    }
  }
  const played = new Set<string>()
  for (const [team, count] of Object.entries(teamCount)) {
    if (count >= currentMatchday) played.add(teamPlayedToken(team))
  }
  teamsPlayedThisMatchday = played
})()

refreshTableView()
