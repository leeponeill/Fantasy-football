import {
  getAllUsernames,
  getCurrentUsername,
  getTeamNameForUser,
  getTeamTileDisplayPreferenceForUser,
  getUserTotalPoints,
  requireAuth,
  userScopedStorageKey,
} from './auth'
import { renderPage } from './renderPage'
import { getSharedItem, sharedLeagueUpdatedEvent } from './sharedLeague'
import {
  getAllPlayers,
  getCountryFlag,
  getTeamKitColors,
  type SelectablePlayer,
} from './teamsData'
import {
  getTransferAwarePlayerCurrentPoints,
  parseTransferPointEvents,
  type TransferPointEvent,
} from './transferPoints'

requireAuth()

const currentUsername = getCurrentUsername()
if (currentUsername?.toLowerCase() !== 'lee') {
  window.location.href = '/fixtures.html'
  throw new Error('Access denied: only lee can view all user teams')
}

type TeamStateView = {
  selectedPlayerKeys: string[]
  benchPlayerKeys: string[]
  captainPlayerKey: string | null
  currentMatchday: number
  transferPointEvents: TransferPointEvent[]
  transfersUsedThisMatchday: number
}

type TeamRow = {
  username: string
  teamName: string
  points: number
  teamValue: number
  selectedPlayerKeys: string[]
  selectedPlayers: SelectablePlayer[]
  benchPlayers: SelectablePlayer[]
  captainPlayerKey: string | null
  currentMatchday: number
  transferPointEvents: TransferPointEvent[]
  transfersUsedThisMatchday: number
}

const allPlayers = getAllPlayers()
const playerByKey = new Map(allPlayers.map((player) => [`${player.team}::${player.name}`, player]))

let selectedUsername: string | null = null

function teamPlayedToken(name: string): string {
  const t = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '')
  if (t === 'iriran') return 'iran'
  if (t === 'korearepublic') return 'southkorea'
  return t
}

let teamsPlayedThisMatchday = new Set<string>()

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

function getTransfersRemainingForRow(row: TeamRow): number {
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

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function parsePlayerKeys(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((item): item is string => typeof item === 'string')
}

function parseTeamState(username: string): TeamStateView | null {
  const storageKey = userScopedStorageKey('fantasy-football-my-team-state', username)
  const raw = getSharedItem(storageKey)
  if (!raw) {
    return null
  }

  try {
    const state = JSON.parse(raw) as Record<string, unknown>
    const captainPlayerKey = typeof state.captainPlayerKey === 'string' ? state.captainPlayerKey : null
    const currentMatchday = Number.isFinite(state.currentMatchday)
      ? Math.max(0, Number(state.currentMatchday))
      : 1
    const transfersUsedThisMatchday = Number.isFinite(state.transfersUsedThisMatchday)
      ? Math.max(0, Math.floor(Number(state.transfersUsedThisMatchday)))
      : 0
    return {
      selectedPlayerKeys: parsePlayerKeys(state.selectedPlayerKeys),
      benchPlayerKeys: parsePlayerKeys(state.benchPlayerKeys),
      captainPlayerKey,
      currentMatchday,
      transferPointEvents: parseTransferPointEvents(state.transferPointEvents),
      transfersUsedThisMatchday,
    }
  } catch {
    return null
  }
}

function getCurrentPointsByPlayerKey(playerKey: string): number {
  const player = playerByKey.get(playerKey)
  if (!player) {
    return 0
  }

  const key = `${player.team}::${player.name}`
  const sharedPointsRaw = getSharedItem('fantasy-football-player-points')
  if (!sharedPointsRaw) {
    return 0
  }

  try {
    const map = JSON.parse(sharedPointsRaw) as Record<string, number>
    const value = map[key]
    return typeof value === 'number' && Number.isFinite(value) ? value : 0
  } catch {
    return 0
  }
}

function getTeamTileDisplayMode(): 'flag' | 'name' {
  if (currentUsername) {
    const perUserPreference = getTeamTileDisplayPreferenceForUser(currentUsername)
    if (perUserPreference) {
      return perUserPreference
    }
  }

  return 'flag'
}

function renderTeamIdentity(player: SelectablePlayer): string {
  if (getTeamTileDisplayMode() === 'name') {
    return `<div class="player-flag player-team-name">${escapeHtml(player.team)}</div>`
  }

  return `<div class="player-flag">${getCountryFlag(player.team)}</div>`
}

function renderPitchPlayerName(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 2) {
    return `${escapeHtml(parts[0])}<br />${escapeHtml(parts[1])}`
  }

  return escapeHtml(name)
}

function getTeamValue(players: SelectablePlayer[]): number {
  return Number(players.reduce((sum, player) => sum + player.price, 0).toFixed(1))
}

function buildRows(): TeamRow[] {
  const usernames = getAllUsernames()
  return usernames
    .map((username) => {
    const teamName = getTeamNameForUser(username) ?? 'Not set'
    const state = parseTeamState(username)
    const selectedPlayers = (state?.selectedPlayerKeys ?? [])
      .map((key) => playerByKey.get(key))
      .filter((player): player is SelectablePlayer => Boolean(player))
    const benchPlayers = (state?.benchPlayerKeys ?? [])
      .map((key) => playerByKey.get(key))
      .filter((player): player is SelectablePlayer => Boolean(player))

    return {
      username,
      teamName,
      points: getUserTotalPoints(username),
      teamValue: getTeamValue(selectedPlayers),
      selectedPlayerKeys: state?.selectedPlayerKeys ?? [],
      selectedPlayers,
      benchPlayers,
      captainPlayerKey: state?.captainPlayerKey ?? null,
      currentMatchday: state?.currentMatchday ?? 1,
      transferPointEvents: state?.transferPointEvents ?? [],
      transfersUsedThisMatchday: state?.transfersUsedThisMatchday ?? 0,
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

function renderBenchMarkup(players: SelectablePlayer[]): string {
  if (players.length === 0) {
    return '<p class="players-help">No bench players.</p>'
  }

  return `
    <ul>
      ${players
        .map((player) => `<li>${escapeHtml(player.name)} (${escapeHtml(player.team)}) - £${player.price.toFixed(1)}</li>`)
        .join('')}
    </ul>
  `
}

function renderSelectedTeamMarkup(selected: TeamRow | undefined): string {
  if (!selected) {
    return '<p class="empty-state">No team found.</p>'
  }

  if (selected.selectedPlayers.length === 0) {
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
      .map((player) => {
        const kitColors = getTeamKitColors(player.team)
        const playerKey = `${player.team}::${player.name}`
        const played = teamsPlayedThisMatchday.has(teamPlayedToken(player.team))
        const basePlayerPoints = getTransferAwarePlayerCurrentPoints(
          playerKey,
          selected.selectedPlayerKeys,
          selected.currentMatchday,
          selected.transferPointEvents,
          getCurrentPointsByPlayerKey,
        )
        const displayedPlayerPoints = selected.captainPlayerKey === playerKey
          ? basePlayerPoints * 2
          : basePlayerPoints
        return `
          <div class="pitch-player">
            <div class="player-card${played ? ' team-has-played' : ''}" style="--kit-bg: ${kitColors.backgroundColor}; --kit-text: ${kitColors.textColor}; --kit-border: ${kitColors.borderColor};">
              ${selected.captainPlayerKey === playerKey ? '<div class="captain-badge">C</div>' : ''}
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
      })
      .join('')

    return `
      <div class="pitch-row">
        <div class="pitch-row-players">${playerCards}</div>
      </div>
    `
  }

  const goalkeepers = selected.selectedPlayers.filter((player) => positionBucket(player.position) === 'Goalkeeper')
  const defenders = selected.selectedPlayers.filter((player) => positionBucket(player.position) === 'Defender')
  const midfielders = selected.selectedPlayers.filter((player) => positionBucket(player.position) === 'Midfielder')
  const forwards = selected.selectedPlayers.filter((player) => positionBucket(player.position) === 'Forward')
  const transfersRemaining = getTransfersRemainingForRow(selected)
  const transfersCopy = Number.isFinite(transfersRemaining)
    ? `Transfers Left This Gameweek: ${transfersRemaining}`
    : 'Transfers Left This Gameweek: Unlimited'

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
    <p class="readonly-transfer-note">${escapeHtml(transfersCopy)}</p>
    <h3>Bench (${selected.benchPlayers.length})</h3>
    ${renderBenchMarkup(selected.benchPlayers)}
  `
}

function renderAllTeamsPage(): void {
  const rows = buildRows()

  if (!selectedUsername || !rows.some((row) => row.username === selectedUsername)) {
    selectedUsername = rows[0]?.username ?? null
  }

  const activeRow = rows.find((row) => row.username === selectedUsername)
  const leaderboardMarkup = rows.length === 0
    ? '<li class="empty-state">No registered users found.</li>'
    : rows
      .map((row, index) => {
        const isActive = row.username === selectedUsername
        return `
          <li>
            <button
              type="button"
              class="leaderboard-row ${isActive ? 'active' : ''}"
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

  const markup = `
    <section class="leaderboard-grid" id="all-teams-board">
      <div class="leaderboard-panel">
        <h3>All Users</h3>
        <p class="players-help">Users are ordered by total points, then team value. Includes users outside shared leagues.</p>
        <ol class="leaderboard-list">${leaderboardMarkup}</ol>
      </div>

      <div class="leaderboard-panel">
        <h3>Selected Team</h3>
        <p class="players-help">Read-only view with the same pitch layout as Table.</p>
        <div class="readonly-team-wrap">${renderSelectedTeamMarkup(activeRow)}</div>
      </div>
    </section>
  `

  renderPage('All User Teams', 'settings', markup)

  const board = document.querySelector<HTMLDivElement>('#all-teams-board')
  if (!board) {
    return
  }

  board.addEventListener('click', (event) => {
    const target = event.target as HTMLElement
    const button = target.closest<HTMLButtonElement>('button.leaderboard-row')
    if (!button) {
      return
    }

    const username = button.dataset.username
    if (!username) {
      return
    }

    selectedUsername = username
    renderAllTeamsPage()
  })
}

function refreshTeamsPlayedThisMatchday(): void {
  const currentMatchdayRaw = getSharedItem('fantasy-football-global-matchday')
  const currentMatchday = currentMatchdayRaw ? Number.parseInt(currentMatchdayRaw, 10) : 1
  const raw = getSharedItem('fantasy-football-fixture-results')
  const results: Array<{ match: string; homeScore?: string; awayScore?: string }> = raw
    ? (() => {
      try {
        return JSON.parse(raw) as Array<{ match: string; homeScore?: string; awayScore?: string }>
      } catch {
        return []
      }
    })()
    : []
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
}

refreshTeamsPlayedThisMatchday()
renderAllTeamsPage()
window.addEventListener(sharedLeagueUpdatedEvent, () => {
  refreshTeamsPlayedThisMatchday()
  renderAllTeamsPage()
})
