import { renderPage } from './renderPage'
import { getAllUsernames, getTeamNameForUser, requireAuth, userScopedStorageKey } from './auth'
import { getLeaguesForUser, joinLeague, type LeagueRecord } from './leagues'
import {
  getAllPlayers,
  getPlayerPoints,
  getTotalAccumulatedPoints,
  type SelectablePlayer,
  getCountryFlag,
  getTeamKitColors,
} from './teamsData'
import { flushSharedLeagueStorage, getSharedItem, sharedLeagueUpdatedEvent } from './sharedLeague'
import {
  getTransferAwareMatchdayPoints,
  getTransferAwarePlayerCurrentPoints,
  parseTransferPointEvents,
  type TransferPointEvent,
} from './transferPoints'

type SavedTeamState = {
  selectedPlayerKeys: string[]
  isTeamLocked?: boolean
  captainPlayerKey?: string | null
  captainBonusTotal?: number
  currentMatchday?: number
  transferPointEvents?: TransferPointEvent[]
}

type UserTeamState = {
  selectedPlayerKeys: string[]
  players: SelectablePlayer[]
  isTeamLocked: boolean
  currentMatchday: number
  transferPointEvents: TransferPointEvent[]
}

type LeaderboardRow = {
  username: string
  teamName: string
  points: number
  teamValue: number
  players: SelectablePlayer[]
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

function readUserTeam(username: string): UserTeamState {
  const storageKey = userScopedStorageKey('fantasy-football-my-team-state', username)
  const raw = getSharedItem(storageKey)

  if (!raw) {
    return { selectedPlayerKeys: [], players: [], isTeamLocked: false, currentMatchday: 1, transferPointEvents: [] }
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
      isTeamLocked: Boolean(state.isTeamLocked),
      currentMatchday: Number.isFinite(state.currentMatchday) ? Math.max(0, Number(state.currentMatchday)) : 1,
      transferPointEvents: parseTransferPointEvents(state.transferPointEvents),
    }
  } catch {
    return { selectedPlayerKeys: [], players: [], isTeamLocked: false, currentMatchday: 1, transferPointEvents: [] }
  }
}

function getCurrentPointsByPlayerKey(playerKey: string): number {
  const parts = playerKey.split('::')
  if (parts.length < 2) {
    return 0
  }

  const teamName = parts[0]
  const playerName = parts.slice(1).join('::')
  return getPlayerPoints(playerName, teamName)
}

function getUserPoints(
  players: SelectablePlayer[],
  selectedPlayerKeys: string[],
  currentMatchday: number,
  transferPointEvents: TransferPointEvent[],
): number {
  const accumulated = players.reduce(
    (sum, player) => sum + getPlayerPoints(player.name, player.team) + getTotalAccumulatedPoints(player.name, player.team),
    0,
  )

  const currentMatchdayPoints = getTransferAwareMatchdayPoints(
    selectedPlayerKeys,
    currentMatchday,
    transferPointEvents,
    getCurrentPointsByPlayerKey,
  )

  const currentSelectedRawPoints = players.reduce((sum, player) => sum + getPlayerPoints(player.name, player.team), 0)
  return accumulated - currentSelectedRawPoints + currentMatchdayPoints
}

function getCaptainCurrentBonus(
  players: SelectablePlayer[],
  selectedPlayerKeys: string[],
  currentMatchday: number,
  transferPointEvents: TransferPointEvent[],
  captainPlayerKey: string | null,
): number {
  if (!captainPlayerKey) {
    return 0
  }

  const captain = players.find((player) => `${player.team}::${player.name}` === captainPlayerKey)
  if (!captain) {
    return 0
  }

  return getTransferAwarePlayerCurrentPoints(
    captainPlayerKey,
    selectedPlayerKeys,
    currentMatchday,
    transferPointEvents,
    getCurrentPointsByPlayerKey,
  )
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
      let captainBonusTotal = 0
      if (raw) {
        try {
          const state = JSON.parse(raw) as SavedTeamState
          captainPlayerKey = typeof state.captainPlayerKey === 'string' ? state.captainPlayerKey : null
          captainBonusTotal = Number.isFinite(state.captainBonusTotal) ? Math.max(0, state.captainBonusTotal ?? 0) : 0
        } catch {
          captainPlayerKey = null
          captainBonusTotal = 0
        }
      }

      const captainCurrentBonus = getCaptainCurrentBonus(
        players,
        userTeamState.selectedPlayerKeys,
        userTeamState.currentMatchday,
        userTeamState.transferPointEvents,
        captainPlayerKey,
      )
      const basePoints = getUserPoints(
        players,
        userTeamState.selectedPlayerKeys,
        userTeamState.currentMatchday,
        userTeamState.transferPointEvents,
      )
      return {
        username,
        teamName: getTeamNameForUser(username) ?? username,
        players,
        points: userTeamState.isTeamLocked ? basePoints + captainBonusTotal + captainCurrentBonus : 0,
        teamValue: getTeamValue(players),
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

  const renderRow = (players: SelectablePlayer[]): string => {
    if (players.length === 0) {
      return ''
    }

    const playerCards = players
      .map(
        (player) => {
          const kitColors = getTeamKitColors(player.team)
          return `
          <div class="pitch-player">
            <div class="player-card" style="--kit-bg: ${kitColors.backgroundColor}; --kit-text: ${kitColors.textColor}; --kit-border: ${kitColors.borderColor};">
              <div class="player-name">${renderPitchPlayerName(player.name)}</div>
              <div class="player-details">
                <div class="player-price">£${player.price.toFixed(1)}</div>
                <div class="player-flag">${getCountryFlag(player.team)}</div>
                <div class="player-points">${getPlayerPoints(player.name, player.team) + getTotalAccumulatedPoints(player.name, player.team)}pts</div>
              </div>
            </div>
          </div>
        `
        },
      )
      .join('')

    return `
      <div class="pitch-row">
        <div class="pitch-row-players">${playerCards}</div>
      </div>
    `
  }

  const goalkeepers = selected.players.filter((player) => positionBucket(player.position) === 'Goalkeeper')
  const defenders = selected.players.filter((player) => positionBucket(player.position) === 'Defender')
  const midfielders = selected.players.filter((player) => positionBucket(player.position) === 'Midfielder')
  const forwards = selected.players.filter((player) => positionBucket(player.position) === 'Forward')

  return `
    <h3 class="selected-team-heading">${escapeHtml(selected.teamName)}</h3>
    <div class="football-pitch">
      <div class="pitch">
        ${renderRow(goalkeepers)}
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

refreshTableView()
