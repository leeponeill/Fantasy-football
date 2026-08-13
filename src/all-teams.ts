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
  getCurrentGameweekPlayerPoints,
  getTeamBadgeOrFlagHtml,
  hasTeamPlayedThisGameweek,
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
  currentGameweek: number
  transferPointEvents: TransferPointEvent[]
  transfersUsedThisGameweek: number
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
  currentGameweek: number
  transferPointEvents: TransferPointEvent[]
  transfersUsedThisGameweek: number
}

const allPlayers = getAllPlayers()
const playerByKey = new Map(allPlayers.map((player) => [`${player.team}::${player.name}`, player]))

let selectedUsername: string | null = null

const maxTransfersPerGameweek = 3
const unlimitedTransferGameweek = 0

function getGlobalGameweek(): number {
  const raw = getSharedItem('fantasy-football-global-Gameweek')
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed
  }

  return 1
}

function getTransfersRemainingForRow(row: TeamRow): number {
  const globalGameweek = getGlobalGameweek()
  const effectiveGameweek = row.currentGameweek === globalGameweek ? row.currentGameweek : globalGameweek

  if (effectiveGameweek === unlimitedTransferGameweek) {
    return Number.POSITIVE_INFINITY
  }

  if (row.currentGameweek !== globalGameweek) {
    return maxTransfersPerGameweek
  }

  return Math.max(0, maxTransfersPerGameweek - row.transfersUsedThisGameweek)
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
    const currentGameweek = Number.isFinite(state.currentGameweek)
      ? Math.max(0, Number(state.currentGameweek))
      : 1
    const transfersUsedThisGameweek = Number.isFinite(state.transfersUsedThisGameweek)
      ? Math.max(0, Math.floor(Number(state.transfersUsedThisGameweek)))
      : 0
    return {
      selectedPlayerKeys: parsePlayerKeys(state.selectedPlayerKeys),
      benchPlayerKeys: parsePlayerKeys(state.benchPlayerKeys),
      captainPlayerKey,
      currentGameweek,
      transferPointEvents: parseTransferPointEvents(state.transferPointEvents),
      transfersUsedThisGameweek,
    }
  } catch {
    return null
  }
}

function getCurrentPointsByPlayerKey(playerKey: string): number {
  const parts = playerKey.split('::')
  if (parts.length < 2) {
    return 0
  }

  const teamName = parts[0]
  const playerName = parts.slice(1).join('::')
  return getCurrentGameweekPlayerPoints(playerName, teamName)
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

  return `<div class="player-flag">${getTeamBadgeOrFlagHtml(player.team, 'team-icon')}</div>`
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
      currentGameweek: state?.currentGameweek ?? 1,
      transferPointEvents: state?.transferPointEvents ?? [],
      transfersUsedThisGameweek: state?.transfersUsedThisGameweek ?? 0,
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
        const played = hasTeamPlayedThisGameweek(player.team)
        const basePlayerPoints = getTransferAwarePlayerCurrentPoints(
          playerKey,
          selected.selectedPlayerKeys,
          selected.currentGameweek,
          selected.transferPointEvents,
          getCurrentPointsByPlayerKey,
        )
        const displayedPlayerPoints = selected.captainPlayerKey === playerKey
          ? basePlayerPoints * 2
          : basePlayerPoints
        return `
          <div class="pitch-player">
            <div class="player-card${played ? ' team-has-played' : ''}" style="--kit-bg: ${kitColors.backgroundColor}; --kit-pattern: ${kitColors.backgroundPattern}; --kit-text: ${kitColors.textColor}; --kit-border: ${kitColors.borderColor};">
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

renderAllTeamsPage()
window.addEventListener(sharedLeagueUpdatedEvent, () => {
  renderAllTeamsPage()
})
