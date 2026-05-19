import { renderPage } from './renderPage'
import { getAllUsernames, getCurrentUsername, getTeamNameForUser, requireAuth, userScopedStorageKey } from './auth'
import { getAllPlayers, getPlayerPoints, getTotalAccumulatedPoints, type SelectablePlayer, getCountryFlag } from './teamsData'
import { getSharedItem, sharedLeagueUpdatedEvent } from './sharedLeague'
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

requireAuth()

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
      currentMatchday: Number.isFinite(state.currentMatchday) ? Math.max(1, Number(state.currentMatchday)) : 1,
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

function buildLeaderboard(): LeaderboardRow[] {
  const usernames = getAllUsernames()
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
  <section class="leaderboard-grid">
    <div class="leaderboard-panel">
      <h2>Users Table</h2>
      <p class="players-help">Users are ordered by total points, then team value.</p>
      <p class="rank-badge" id="my-rank-badge">Your Rank: -</p>
      <ol id="leaderboard-list" class="leaderboard-list"></ol>
    </div>

    <div class="leaderboard-panel">
      <h2 id="selected-user-title">User Team</h2>
      <p class="players-help">Read-only view. Team cannot be edited from this tab.</p>
      <div id="selected-user-team" class="readonly-team-wrap"></div>
    </div>
  </section>
`

renderPage('Table', 'table', tableMarkup)

const leaderboardList = document.querySelector<HTMLOListElement>('#leaderboard-list')
const selectedUserTitle = document.querySelector<HTMLHeadingElement>('#selected-user-title')
const selectedUserTeam = document.querySelector<HTMLDivElement>('#selected-user-team')
const myRankBadge = document.querySelector<HTMLParagraphElement>('#my-rank-badge')

const currentUsername = getCurrentUsername()

function getLeaderboard(): LeaderboardRow[] {
  return buildLeaderboard()
}

let selectedUsername = getLeaderboard()[0]?.username ?? null

function renderSelectedUserTeam(): void {
  if (!selectedUserTeam || !selectedUserTitle) {
    return
  }

  if (!selectedUsername) {
    selectedUserTitle.textContent = 'User Team'
    selectedUserTeam.innerHTML = '<p class="empty-state">No users found yet.</p>'
    return
  }

  const leaderboard = getLeaderboard()
  const selected = leaderboard.find((row) => row.username === selectedUsername)
  if (!selected) {
    selectedUserTitle.textContent = 'User Team'
    selectedUserTeam.innerHTML = '<p class="empty-state">No team found.</p>'
    return
  }

  selectedUserTitle.textContent = `${selected.teamName}`

  if (selected.players.length === 0) {
    selectedUserTeam.innerHTML = '<p class="empty-state">No players selected.</p>'
    return
  }

  // Helper function to categorize positions
  const positionBucket = (position: string): 'Goalkeeper' | 'Defender' | 'Midfielder' | 'Forward' => {
    if (position === 'Goalkeeper') return 'Goalkeeper'
    if (position === 'Defender') return 'Defender'
    if (position === 'Forward' || position === 'Midfielder/Forward') return 'Forward'
    return 'Midfielder'
  }

  const goalkeepers = selected.players.filter((p) => positionBucket(p.position) === 'Goalkeeper')
  const defenders = selected.players.filter((p) => positionBucket(p.position) === 'Defender')
  const midfielders = selected.players.filter((p) => positionBucket(p.position) === 'Midfielder')
  const forwards = selected.players.filter((p) => positionBucket(p.position) === 'Forward')

  const renderRow = (label: string, players: SelectablePlayer[]): string => {
    if (players.length === 0) return ''
    const playerCards = players
      .map(
        (player) => `
          <div class="pitch-player">
            <div class="player-card">
              <div class="player-name">${escapeHtml(player.name)}</div>
              <div class="player-details">
                <div class="player-price">£${player.price.toFixed(1)}</div>
                <div class="player-flag">${getCountryFlag(player.team)}</div>
                <div class="player-points">${getPlayerPoints(player.name, player.team) + getTotalAccumulatedPoints(player.name, player.team)}pts</div>
              </div>
            </div>
          </div>
        `,
      )
      .join('')

    return `
      <div class="pitch-row">
        <div class="pitch-label">${label}</div>
        <div class="pitch-row-players">${playerCards}</div>
      </div>
    `
  }

  selectedUserTeam.innerHTML = `
    <div class="football-pitch">
      <div class="pitch">
        ${renderRow('GK', goalkeepers)}
        ${renderRow('DEF', defenders)}
        ${renderRow('MID', midfielders)}
        ${renderRow('FWD', forwards)}
      </div>
    </div>
    <p class="readonly-team-summary">Total Points: ${selected.points} | Team Value: £${selected.teamValue.toFixed(1)}</p>
  `
}

function renderLeaderboard(): void {
  if (!leaderboardList) {
    return
  }

  const leaderboard = getLeaderboard()

  if (leaderboard.length === 0) {
    leaderboardList.innerHTML = '<li class="empty-state">No users registered yet.</li>'
    return
  }

  if (myRankBadge && currentUsername) {
    const rank = getUserRank(currentUsername, leaderboard)
    if (rank === null) {
      myRankBadge.textContent = 'Your Rank: -'
    } else {
      const currentRow = leaderboard[rank - 1]
      myRankBadge.textContent = `Your Rank: #${rank} (${currentRow.teamName})`
    }
  }

  leaderboardList.innerHTML = leaderboard
    .map((row, index) => {
      const isActive = selectedUsername === row.username
      return `
        <li>
          <button type="button" class="leaderboard-row ${isActive ? 'active' : ''}" data-username="${escapeHtml(row.username)}">
            <span class="leaderboard-rank">#${index + 1}</span>
            <span class="leaderboard-name">${escapeHtml(row.teamName)}</span>
            <span class="leaderboard-value">£${row.teamValue.toFixed(1)}</span>
            <span class="leaderboard-points">${row.points} pts</span>
          </button>
        </li>
      `
    })
    .join('')
}

function refreshTableView(): void {
  const leaderboard = getLeaderboard()
  if (!selectedUsername && leaderboard.length > 0) {
    selectedUsername = leaderboard[0].username
  }
  if (selectedUsername && !leaderboard.some((row) => row.username === selectedUsername)) {
    selectedUsername = leaderboard[0]?.username ?? null
  }
  renderLeaderboard()
  renderSelectedUserTeam()
}

if (leaderboardList) {
  leaderboardList.addEventListener('click', (event) => {
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
    refreshTableView()
  })
}

window.addEventListener('focus', refreshTableView)
window.addEventListener('storage', (event) => {
  if (event.key === 'fantasy-football-player-points' || event.key === 'fantasy-football-total-points') {
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
