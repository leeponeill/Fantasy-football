import { renderPage } from './renderPage'
import {
  adjustGlobalBudget,
  adjustUserPoints,
  canAdjustUserBudgets,
  clearAllUsersAndTeams,
  deleteUser,
  getAllUsernames,
  getCurrentUsername,
  getGlobalBudget,
  getPasswordResetRequests,
  getTeamNameForUser,
  getUserTotalPoints,
  renameUser,
  requireAuth,
  resetUserPassword,
  setTeamNameForUser,
  userScopedStorageKey,
} from './auth'
import { clearAllPoints, getCurrentMatchdayPlayerPoints, resetAllPlayerPoints } from './teamsData'
import {
  flushSharedLeagueStorage,
  getSharedItem,
  removeSharedItem,
  refreshSharedLeagueStorage,
  setSharedItem,
  sharedLeagueUpdatedEvent,
} from './sharedLeague'
import {
  clearAllLeagues,
  createLeague,
  deleteLeague,
  getAllLeagues,
  removeUserFromLeague,
  renameLeague,
  renameUserInLeagues,
} from './leagues'
import { getWCFixtureMatchdays } from './fixturesData'
import { getTransferAwareMatchdayPoints, getTransferAwarePlayerCurrentPoints, parseTransferPointEvents } from './transferPoints'

requireAuth()

const currentUsername = getCurrentUsername()
if (currentUsername?.toLowerCase() !== 'lee') {
  window.location.href = '/fixtures.html'
  throw new Error('Access denied: only lee can use Admin')
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

const adminMarkup = `
  <section class="admin-container">
    <section class="admin-card">
      <h2>Draft Mode</h2>
      <p id="draft-mode-status" class="admin-message" aria-live="polite">Loading draft status...</p>
      <p id="draft-mode-message" class="admin-message" aria-live="polite"></p>
      <div class="draft-mode-section">
        <button id="admin-draft-mode-btn" type="button" class="draft-mode-btn">Enable Draft Mode</button>
        <input id="admin-draft-order-input" class="draft-order-input" type="text" placeholder="Draft order e.g. lee, sam, alex" aria-label="Draft order" />
        <button id="admin-save-draft-order-btn" type="button" class="draft-order-save-btn">Save Draft Order</button>
      </div>
    </section>

    <section class="admin-card">
      <h2>Bench Mode</h2>
      <p id="bench-mode-status" class="admin-message" aria-live="polite">Loading bench status...</p>
      <p id="bench-mode-message" class="admin-message" aria-live="polite"></p>
      <div class="draft-mode-section">
        <button id="admin-bench-mode-btn" type="button" class="draft-mode-btn">Disable Bench</button>
      </div>
    </section>

    <section class="admin-card">
      <h2>Fixture Scores</h2>
      <p id="fixture-score-check-message" class="admin-message" aria-live="polite"></p>
      <div class="draft-mode-section">
        <button id="admin-check-scores-btn" type="button" class="draft-mode-btn">Check for Scores</button>
        <button id="admin-clear-api-data-btn" type="button" class="reset-all-btn">Clear Results And Points</button>
      </div>
      <p class="danger-copy">Checks only fixtures that kicked off at least 2.5 hours ago.</p>
    </section>

    <section class="admin-card">
      <h2>League Backup</h2>
      <p id="force-backup-message" class="admin-message" aria-live="polite"></p>
      <div class="draft-mode-section">
        <button id="admin-force-backup-btn" type="button" class="lock-team-btn">Force Backup Now</button>
      </div>
      <p class="danger-copy">Creates backup-manual-epoc-EPOCH.json in the league_backup folder immediately.</p>
    </section>

    <section class="admin-card">
      <h2>Gameweek Controls</h2>
      <p id="gameweek-status" class="admin-message" aria-live="polite">Current gameweek: 1</p>
      <p id="gameweek-message" class="admin-message" aria-live="polite"></p>
      <div class="draft-mode-section">
        <button id="admin-end-gameweek-btn" type="button" class="draft-mode-btn">End Gameweek</button>
        <button id="admin-prev-gameweek-btn" type="button" class="lock-team-btn">Go Back One Gameweek</button>
        <button id="admin-fix-gw1-totals-btn" type="button" class="lock-team-btn">Fix GW1 Legacy Totals</button>
      </div>
      <p class="danger-copy">Going back a gameweek only changes matchday state. It does not roll back awarded points.</p>
      <p id="gameweek-wc-status" class="admin-message" aria-live="polite"></p>
    </section>

    <details class="admin-card admin-collapsible-card" open>
      <summary>Edit User Team Names</summary>
      <div class="admin-collapsible-content">
        <p id="admin-message" class="admin-message" aria-live="polite"></p>
        <div id="team-name-editor" class="admin-list"></div>
      </div>
    </details>

    <details class="admin-card admin-collapsible-card" open>
      <summary>Adjust User Points</summary>
      <div class="admin-collapsible-content">
        <p id="adjust-message" class="admin-message" aria-live="polite"></p>
        <div id="point-adjustor" class="admin-list"></div>
      </div>
    </details>

    <section class="admin-card">
      <h2>League Budget</h2>
      <p id="budget-message" class="admin-message" aria-live="polite"></p>
      <div id="budget-adjustor" class="admin-list"></div>
    </section>

    <details class="admin-card admin-collapsible-card" open>
      <summary>League Manager</summary>
      <div class="admin-collapsible-content">
        <p class="danger-copy">Create league IDs here. Users join them from the Table page.</p>
        <p id="league-message" class="admin-message" aria-live="polite"></p>
        <form id="league-create-form" class="admin-user-row admin-league-form">
          <div class="admin-user-meta">
            <strong>Create League</strong>
            <span>Each league gets a shareable ID. Users can join multiple leagues.</span>
          </div>
          <input
            class="admin-team-name-input"
            name="leagueName"
            type="text"
            placeholder="League name"
            minlength="2"
            maxlength="60"
            required
          />
          <button type="submit" class="lock-team-btn">Create League</button>
        </form>
        <div id="league-list" class="admin-list"></div>
      </div>
    </details>

    <section class="admin-card">
      <h2>Password Reset Requests</h2>
      <p id="password-reset-message" class="admin-message" aria-live="polite"></p>
      <div id="password-reset-list" class="admin-list"></div>
    </section>

    <section class="admin-card danger-zone">
      <h2>Danger Zone</h2>
      <p class="danger-copy">Clear all users, saved teams, and all points.</p>
      <button id="reset-all-btn" type="button" class="reset-all-btn">Reset Everything</button>
    </section>
  </section>
`

renderPage('Admin', 'admin', adminMarkup)

const messageEl = document.querySelector<HTMLParagraphElement>('#admin-message')
const adjustMessageEl = document.querySelector<HTMLParagraphElement>('#adjust-message')
const budgetMessageEl = document.querySelector<HTMLParagraphElement>('#budget-message')
const leagueMessageEl = document.querySelector<HTMLParagraphElement>('#league-message')
const passwordResetMessageEl = document.querySelector<HTMLParagraphElement>('#password-reset-message')
const teamNameEditor = document.querySelector<HTMLDivElement>('#team-name-editor')
const pointAdjustor = document.querySelector<HTMLDivElement>('#point-adjustor')
const budgetAdjustor = document.querySelector<HTMLDivElement>('#budget-adjustor')
const leagueList = document.querySelector<HTMLDivElement>('#league-list')
const leagueCreateForm = document.querySelector<HTMLFormElement>('#league-create-form')
const passwordResetList = document.querySelector<HTMLDivElement>('#password-reset-list')
const resetAllBtn = document.querySelector<HTMLButtonElement>('#reset-all-btn')
const draftModeStatusEl = document.querySelector<HTMLParagraphElement>('#draft-mode-status')
const draftModeMessageEl = document.querySelector<HTMLParagraphElement>('#draft-mode-message')
const adminDraftModeBtn = document.querySelector<HTMLButtonElement>('#admin-draft-mode-btn')
const adminDraftOrderInput = document.querySelector<HTMLInputElement>('#admin-draft-order-input')
const adminSaveDraftOrderBtn = document.querySelector<HTMLButtonElement>('#admin-save-draft-order-btn')
const benchModeStatusEl = document.querySelector<HTMLParagraphElement>('#bench-mode-status')
const benchModeMessageEl = document.querySelector<HTMLParagraphElement>('#bench-mode-message')
const adminBenchModeBtn = document.querySelector<HTMLButtonElement>('#admin-bench-mode-btn')
const fixtureScoreCheckMessageEl = document.querySelector<HTMLParagraphElement>('#fixture-score-check-message')
const adminCheckScoresBtn = document.querySelector<HTMLButtonElement>('#admin-check-scores-btn')
const adminClearApiDataBtn = document.querySelector<HTMLButtonElement>('#admin-clear-api-data-btn')
const forceBackupMessageEl = document.querySelector<HTMLParagraphElement>('#force-backup-message')
const adminForceBackupBtn = document.querySelector<HTMLButtonElement>('#admin-force-backup-btn')
const gameweekStatusEl = document.querySelector<HTMLParagraphElement>('#gameweek-status')
const gameweekMessageEl = document.querySelector<HTMLParagraphElement>('#gameweek-message')
const gameweekWcStatusEl = document.querySelector<HTMLParagraphElement>('#gameweek-wc-status')
const adminEndGameweekBtn = document.querySelector<HTMLButtonElement>('#admin-end-gameweek-btn')
const adminPrevGameweekBtn = document.querySelector<HTMLButtonElement>('#admin-prev-gameweek-btn')
const adminFixGw1TotalsBtn = document.querySelector<HTMLButtonElement>('#admin-fix-gw1-totals-btn')

const autoImportedEventIdsStorageKey = 'fantasy-football-auto-imported-event-ids'
const importedMatchPlayerPointsStorageKey = 'fantasy-football-imported-match-player-points'
const autoScannedFixtureKeysStorageKey = 'fantasy-football-auto-scanned-fixture-keys'
const fixtureResultsStorageKey = 'fantasy-football-fixture-results'
const globalMatchdayStorageKey = 'fantasy-football-global-matchday'

let draftModeEnabled = false
let draftModeCanEnable = false
let draftOrder: string[] = []
let draftComplete = false
let draftCurrentTurn: string | null = null
let benchModeEnabled = true
let benchModeCanToggle = false

function getGlobalMatchday(): number {
  const raw = getSharedItem(globalMatchdayStorageKey)
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed
  }

  return 1
}

function setGlobalMatchday(matchday: number): void {
  const safeMatchday = Math.max(0, Math.floor(matchday))
  setSharedItem(globalMatchdayStorageKey, String(safeMatchday))
}

function setMessage(text: string, type: 'ok' | 'error'): void {
  if (!messageEl) {
    return
  }

  messageEl.textContent = text
  messageEl.classList.remove('ok', 'error')
  messageEl.classList.add(type)
}

function setAdjustMessage(text: string, type: 'ok' | 'error'): void {
  if (!adjustMessageEl) {
    return
  }

  adjustMessageEl.textContent = text
  adjustMessageEl.classList.remove('ok', 'error')
  adjustMessageEl.classList.add(type)
}

function setBudgetMessage(text: string, type: 'ok' | 'error'): void {
  if (!budgetMessageEl) {
    return
  }

  budgetMessageEl.textContent = text
  budgetMessageEl.classList.remove('ok', 'error')
  budgetMessageEl.classList.add(type)
}

function setLeagueMessage(text: string, type: 'ok' | 'error'): void {
  if (!leagueMessageEl) {
    return
  }

  leagueMessageEl.textContent = text
  leagueMessageEl.classList.remove('ok', 'error')
  leagueMessageEl.classList.add(type)
}

function setPasswordResetMessage(text: string, type: 'ok' | 'error'): void {
  if (!passwordResetMessageEl) {
    return
  }

  passwordResetMessageEl.textContent = text
  passwordResetMessageEl.classList.remove('ok', 'error')
  passwordResetMessageEl.classList.add(type)
}

function setDraftModeMessage(text: string, type: 'ok' | 'error'): void {
  if (!draftModeMessageEl) {
    return
  }

  draftModeMessageEl.textContent = text
  draftModeMessageEl.classList.remove('ok', 'error')
  draftModeMessageEl.classList.add(type)
}

function setBenchModeMessage(text: string, type: 'ok' | 'error'): void {
  if (!benchModeMessageEl) {
    return
  }

  benchModeMessageEl.textContent = text
  benchModeMessageEl.classList.remove('ok', 'error')
  benchModeMessageEl.classList.add(type)
}

function setFixtureScoreCheckMessage(text: string, type: 'ok' | 'error'): void {
  if (!fixtureScoreCheckMessageEl) {
    return
  }

  fixtureScoreCheckMessageEl.textContent = text
  fixtureScoreCheckMessageEl.classList.remove('ok', 'error')
  fixtureScoreCheckMessageEl.classList.add(type)
}

function setForceBackupMessage(text: string, type: 'ok' | 'error'): void {
  if (!forceBackupMessageEl) {
    return
  }

  forceBackupMessageEl.textContent = text
  forceBackupMessageEl.classList.remove('ok', 'error')
  forceBackupMessageEl.classList.add(type)
}

function setGameweekMessage(text: string, type: 'ok' | 'error'): void {
  if (!gameweekMessageEl) {
    return
  }

  gameweekMessageEl.textContent = text
  gameweekMessageEl.classList.remove('ok', 'error')
  gameweekMessageEl.classList.add(type)
}

function renderGameweekControls(): void {
  const currentMatchday = getGlobalMatchday()

  if (gameweekStatusEl) {
    gameweekStatusEl.textContent = `Current gameweek: ${currentMatchday}`
  }

  if (adminPrevGameweekBtn) {
    adminPrevGameweekBtn.disabled = currentMatchday <= 0
    adminPrevGameweekBtn.title = currentMatchday <= 0 ? 'Gameweek cannot go below 0.' : ''
  }

  void refreshWCGameweekStatus(currentMatchday)
}

async function refreshWCGameweekStatus(matchday: number): Promise<void> {
  if (!adminEndGameweekBtn || !gameweekWcStatusEl) return
  try {
    const wcMatchdays = await getWCFixtureMatchdays()

    // Collect all real team names from group stage fixtures.
    // Placeholder names (knockout seeds like "W73", "1A", "3ABCDF", "RU101") start with a digit, W, or R.
    const groupStageTeams = new Set<string>()
    for (const md of wcMatchdays) {
      if (!md.round.startsWith('Group Stage')) continue
      for (const game of md.games) {
        const [home, away] = game.match.split(' vs ')
        if (home && !/^[WR\d]/.test(home.trim())) groupStageTeams.add(home.trim())
        if (away && !/^[WR\d]/.test(away.trim())) groupStageTeams.add(away.trim())
      }
    }

    const resultsRaw = getSharedItem('fantasy-football-fixture-results')
    const results: Array<{ match: string; homeScore?: string; awayScore?: string }> =
      resultsRaw ? (JSON.parse(resultsRaw) as Array<{ match: string; homeScore?: string; awayScore?: string }>) : []

    // Count completed games per team (team names match WCfixtures because the server
    // stores the exact match string from WCfixtures.json)
    const teamResultCount: Record<string, number> = {}
    for (const result of results) {
      if (result.homeScore !== undefined && result.awayScore !== undefined) {
        const [home, away] = result.match.split(' vs ')
        if (home) teamResultCount[home.trim()] = (teamResultCount[home.trim()] ?? 0) + 1
        if (away) teamResultCount[away.trim()] = (teamResultCount[away.trim()] ?? 0) + 1
      }
    }

    if (matchday <= 3) {
      // Group stage: every team must have played at least `matchday` times
      const pending = [...groupStageTeams].filter((t) => (teamResultCount[t] ?? 0) < matchday).sort()
      if (pending.length > 0) {
        adminEndGameweekBtn.disabled = true
        adminEndGameweekBtn.title = `${pending.length} team${pending.length === 1 ? '' : 's'} yet to play`
        gameweekWcStatusEl.textContent = `⏳ ${pending.length} team${pending.length === 1 ? '' : 's'} yet to play in gameweek ${matchday}: ${pending.join(', ')}`
        gameweekWcStatusEl.className = 'admin-message error'
      } else {
        adminEndGameweekBtn.disabled = false
        adminEndGameweekBtn.title = ''
        gameweekWcStatusEl.textContent = `✓ All ${groupStageTeams.size} teams have played their gameweek ${matchday} game.`
        gameweekWcStatusEl.className = 'admin-message ok'
      }
    } else {
      // Knockout rounds: find the first WC fixture matchday that has incomplete games
      // (any matchday that has at least one completed AND one missing result, or is fully unplayed
      // and comes after the last completed matchday)
      const completedMatchSet = new Set(results.filter((r) => r.homeScore !== undefined).map((r) => r.match))
      let pendingGames: string[] = []
      let checkedMatchday: number | null = null
      for (const md of wcMatchdays) {
        if (md.round.startsWith('Group Stage')) continue
        const mdPending = md.games.filter((g) => !completedMatchSet.has(g.match)).map((g) => g.match)
        if (mdPending.length > 0) {
          pendingGames = mdPending
          checkedMatchday = md.matchday
          break
        }
      }
      if (pendingGames.length > 0) {
        adminEndGameweekBtn.disabled = true
        adminEndGameweekBtn.title = `${pendingGames.length} game${pendingGames.length === 1 ? '' : 's'} still pending`
        gameweekWcStatusEl.textContent = `⏳ ${pendingGames.length} game${pendingGames.length === 1 ? '' : 's'} still to play (round ${checkedMatchday ?? '?'}): ${pendingGames.join(', ')}`
        gameweekWcStatusEl.className = 'admin-message error'
      } else {
        adminEndGameweekBtn.disabled = false
        adminEndGameweekBtn.title = ''
        gameweekWcStatusEl.textContent = `✓ All knockout games have results.`
        gameweekWcStatusEl.className = 'admin-message ok'
      }
    }
  } catch {
    adminEndGameweekBtn.disabled = false
    adminEndGameweekBtn.title = ''
    gameweekWcStatusEl.textContent = ''
  }
}

type SavedTeamState = {
  selectedPlayerKeys?: string[]
  isTeamLocked?: boolean
  transfersUsedThisMatchday?: number
  transferUsageByMatchday?: unknown
  currentMatchday?: number
  captainPlayerKey?: string | null
  captainChangesThisMatchday?: number
  captainBonusTotal?: number
  ownedPointsTotal?: number
  transferPointEvents?: unknown
}

function parseTransferUsageByMatchday(value: unknown): Record<number, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  const next: Record<number, number> = {}
  for (const [rawMatchday, rawUsed] of Object.entries(value as Record<string, unknown>)) {
    const matchday = Number.parseInt(rawMatchday, 10)
    if (!Number.isFinite(matchday) || matchday < 0) {
      continue
    }

    const used = typeof rawUsed === 'number' && Number.isFinite(rawUsed)
      ? Math.max(0, Math.floor(rawUsed))
      : 0
    next[matchday] = used
  }

  return next
}

function updateAllUserMatchdayStates(nextMatchday: number, carryForwardCurrentMatchdayPoints: boolean): void {
  const usernames = getAllUsernames()

  for (const username of usernames) {
    const storageKey = userScopedStorageKey('fantasy-football-my-team-state', username)
    const raw = getSharedItem(storageKey)
    if (!raw) {
      continue
    }

    try {
      const state = JSON.parse(raw) as SavedTeamState
      const selectedKeys = Array.isArray(state.selectedPlayerKeys) ? state.selectedPlayerKeys : []
      const savedCaptainKey = typeof state.captainPlayerKey === 'string' ? state.captainPlayerKey : null
      const currentMatchday = Number.isFinite(state.currentMatchday)
        ? Math.max(0, Math.floor(state.currentMatchday ?? 0))
        : getGlobalMatchday()
      const currentTransfersUsed = Number.isFinite(state.transfersUsedThisMatchday)
        ? Math.max(0, Math.floor(state.transfersUsedThisMatchday ?? 0))
        : 0
      const transferUsageByMatchday = parseTransferUsageByMatchday(state.transferUsageByMatchday)
      transferUsageByMatchday[currentMatchday] = currentTransfersUsed

      const existingCaptainBonus = Number.isFinite(state.captainBonusTotal)
        ? Math.max(0, state.captainBonusTotal ?? 0)
        : 0
      const existingOwnedPointsTotal = Number.isFinite(state.ownedPointsTotal)
        ? Math.max(0, state.ownedPointsTotal ?? 0)
        : 0

      const getCurrentPointsByPlayerKey = (playerKey: string): number => {
        const parts = playerKey.split('::')
        if (parts.length < 2) {
          return 0
        }

        const teamName = parts[0]
        const playerName = parts.slice(1).join('::')
        return getCurrentMatchdayPlayerPoints(playerName, teamName)
      }

      const transferPointEvents = parseTransferPointEvents(state.transferPointEvents)
      const playerPointsThisMatchday = carryForwardCurrentMatchdayPoints
        ? Math.max(
            0,
            getTransferAwareMatchdayPoints(
              selectedKeys,
              currentMatchday,
              transferPointEvents,
              getCurrentPointsByPlayerKey,
            ),
          )
        : 0

      let captainBonusThisMatchday = 0
      if (carryForwardCurrentMatchdayPoints && savedCaptainKey && selectedKeys.includes(savedCaptainKey)) {
        captainBonusThisMatchday = getTransferAwarePlayerCurrentPoints(
          savedCaptainKey,
          selectedKeys,
          currentMatchday,
          transferPointEvents,
          getCurrentPointsByPlayerKey,
        )
      }

      const restoredTransfersUsed = nextMatchday === 0
        ? 0
        : Math.max(0, Math.floor(transferUsageByMatchday[nextMatchday] ?? 0))

      const nextState: SavedTeamState = {
        ...state,
        currentMatchday: nextMatchday,
        transfersUsedThisMatchday: restoredTransfersUsed,
        transferUsageByMatchday,
        captainChangesThisMatchday: 0,
        captainBonusTotal: existingCaptainBonus + captainBonusThisMatchday,
        ownedPointsTotal: existingOwnedPointsTotal + playerPointsThisMatchday,
        transferPointEvents: [],
      }

      setSharedItem(storageKey, JSON.stringify(nextState))
    } catch {
      continue
    }
  }
}

function normalizeLegacyTotalsForGameweekOne(): number {
  const usernames = getAllUsernames()
  let fixedUsers = 0

  for (const username of usernames) {
    const storageKey = userScopedStorageKey('fantasy-football-my-team-state', username)
    const raw = getSharedItem(storageKey)
    if (!raw) {
      continue
    }

    try {
      const state = JSON.parse(raw) as SavedTeamState
      const currentMatchday = Number.isFinite(state.currentMatchday)
        ? Math.max(0, Math.floor(state.currentMatchday ?? 0))
        : 1
      if (currentMatchday > 1) {
        continue
      }

      const captainBonusTotal = Number.isFinite(state.captainBonusTotal)
        ? Math.max(0, state.captainBonusTotal ?? 0)
        : 0
      const ownedPointsTotal = Number.isFinite(state.ownedPointsTotal)
        ? Math.max(0, state.ownedPointsTotal ?? 0)
        : 0

      if (captainBonusTotal === 0 && ownedPointsTotal === 0) {
        continue
      }

      const nextState: SavedTeamState = {
        ...state,
        captainBonusTotal: 0,
        ownedPointsTotal: 0,
      }

      setSharedItem(storageKey, JSON.stringify(nextState))
      fixedUsers += 1
    } catch {
      continue
    }
  }

  return fixedUsers
}

function clearAllUserCarriedPointState(): number {
  const usernames = getAllUsernames()
  let clearedUsers = 0

  for (const username of usernames) {
    const storageKey = userScopedStorageKey('fantasy-football-my-team-state', username)
    const raw = getSharedItem(storageKey)
    if (!raw) {
      continue
    }

    try {
      const state = JSON.parse(raw) as SavedTeamState
      const captainBonusTotal = Number.isFinite(state.captainBonusTotal)
        ? Math.max(0, state.captainBonusTotal ?? 0)
        : 0
      const ownedPointsTotal = Number.isFinite(state.ownedPointsTotal)
        ? Math.max(0, state.ownedPointsTotal ?? 0)
        : 0
      const hadEvents = Array.isArray(state.transferPointEvents) && state.transferPointEvents.length > 0

      if (captainBonusTotal === 0 && ownedPointsTotal === 0 && !hadEvents) {
        continue
      }

      const nextState: SavedTeamState = {
        ...state,
        captainBonusTotal: 0,
        ownedPointsTotal: 0,
        transferPointEvents: [],
      }

      setSharedItem(storageKey, JSON.stringify(nextState))
      clearedUsers += 1
    } catch {
      continue
    }
  }

  return clearedUsers
}

function renderDraftModeControls(): void {
  if (draftModeStatusEl) {
    if (!draftModeEnabled) {
      draftModeStatusEl.textContent = 'Draft Mode: Off'
    } else if (draftOrder.length === 0) {
      draftModeStatusEl.textContent = 'Draft Mode: On (waiting for order)'
    } else if (draftComplete) {
      draftModeStatusEl.textContent = `Draft Mode: Complete (${draftOrder.join(' -> ')})`
    } else {
      draftModeStatusEl.textContent = `Draft Mode: ${draftCurrentTurn ?? 'Unknown'}'s turn (${draftOrder.join(' -> ')})`
    }
  }

  if (adminDraftModeBtn) {
    adminDraftModeBtn.textContent = draftModeEnabled ? 'Disable Draft Mode' : 'Enable Draft Mode'
    adminDraftModeBtn.disabled = !draftModeEnabled && !draftModeCanEnable
    adminDraftModeBtn.classList.toggle('draft-mode-btn--active', draftModeEnabled)
    adminDraftModeBtn.title = !draftModeEnabled && !draftModeCanEnable
      ? 'All users must have empty teams to enable draft mode'
      : ''
  }

  if (adminSaveDraftOrderBtn) {
    adminSaveDraftOrderBtn.disabled = !draftModeEnabled || draftComplete
  }
}

function renderBenchModeControls(): void {
  if (benchModeStatusEl) {
    benchModeStatusEl.textContent = benchModeEnabled ? 'Bench Mode: On' : 'Bench Mode: Off'
  }

  if (adminBenchModeBtn) {
    adminBenchModeBtn.textContent = benchModeEnabled ? 'Disable Bench' : 'Enable Bench'
    adminBenchModeBtn.disabled = !benchModeCanToggle
    adminBenchModeBtn.classList.toggle('draft-mode-btn--active', benchModeEnabled)
    adminBenchModeBtn.title = !benchModeCanToggle
      ? 'All users must have empty teams to change bench mode'
      : ''
  }
}

async function refreshDraftMode(): Promise<void> {
  try {
    const response = await fetch('/api/draft-mode', { cache: 'no-store' })
    if (!response.ok) {
      return
    }

    const data = (await response.json()) as {
      enabled?: boolean
      canEnable?: boolean
      order?: string[]
      currentTurn?: string | null
      complete?: boolean
    }
    draftModeEnabled = data.enabled === true
    draftModeCanEnable = data.canEnable === true
    draftOrder = Array.isArray(data.order) ? data.order.filter((value) => typeof value === 'string') : []
    draftCurrentTurn = typeof data.currentTurn === 'string' ? data.currentTurn : null
    draftComplete = data.complete === true
  } catch {
    // Keep current values on fetch failure.
  }

  renderDraftModeControls()
}

async function refreshBenchMode(): Promise<void> {
  try {
    const response = await fetch('/api/bench-mode', { cache: 'no-store' })
    if (!response.ok) {
      return
    }

    const data = (await response.json()) as {
      enabled?: boolean
      canToggle?: boolean
    }

    benchModeEnabled = data.enabled !== false
    benchModeCanToggle = data.canToggle === true
  } catch {
    // Keep current values on fetch failure.
  }

  renderBenchModeControls()
}

function renderTeamNameEditor(): void {
  if (!teamNameEditor) {
    return
  }

  const editableUsers = getAllUsernames()

  if (editableUsers.length === 0) {
    teamNameEditor.innerHTML = '<p class="empty-state">No users available to edit yet.</p>'
    return
  }

  teamNameEditor.innerHTML = editableUsers
    .map((username) => {
      const currentTeamName = getTeamNameForUser(username) ?? ''
      const isCurrentAdmin = currentUsername?.toLowerCase() === username.toLowerCase()
      return `
        <form class="admin-user-row" data-username="${escapeHtml(username)}">
          <div class="admin-user-meta">
            <strong>${escapeHtml(username)}</strong>
            <span>Current: ${escapeHtml(currentTeamName || 'No team name set')}</span>
          </div>
          <div class="admin-point-inputs">
            <input
              class="admin-team-name-input"
              name="username"
              type="text"
              value="${escapeHtml(username)}"
              placeholder="Edit username"
              minlength="3"
              required
            />
            <input
              class="admin-team-name-input"
              name="teamName"
              type="text"
              value="${escapeHtml(currentTeamName)}"
              placeholder="Enter team name"
              minlength="2"
              required
            />
          </div>
          <div class="admin-user-actions">
            <button type="submit" class="lock-team-btn" data-submit-action="team-name">Save Team Name</button>
            <button
              type="submit"
              class="lock-team-btn"
              data-submit-action="username"
              ${isCurrentAdmin ? 'disabled title="You cannot rename your own admin account."' : ''}
            >
              Save Username
            </button>
            <button
              type="button"
              class="reset-all-btn admin-user-delete-btn"
              data-action="delete-user"
              data-username="${escapeHtml(username)}"
              ${isCurrentAdmin ? 'disabled title="You cannot delete your own admin account."' : ''}
            >
              Delete User
            </button>
          </div>
        </form>
      `
    })
    .join('')
}

function renderPointAdjustor(): void {
  if (!pointAdjustor) {
    return
  }

  const users = getAllUsernames()

  if (users.length === 0) {
    pointAdjustor.innerHTML = '<p class="empty-state">No users available to adjust.</p>'
    return
  }

  pointAdjustor.innerHTML = users
    .map((username) => {
      const totalPoints = getUserTotalPoints(username)
      return `
        <form class="admin-user-row" data-username="${escapeHtml(username)}">
          <div class="admin-user-meta">
            <strong>${escapeHtml(username)}</strong>
            <span>Current Points: ${totalPoints}</span>
          </div>
          <div class="admin-point-inputs">
            <input
              class="admin-point-input"
              name="pointAdjustment"
              type="number"
              placeholder="Add/subtract points"
              value="0"
            />
          </div>
          <button type="submit" class="lock-team-btn">Adjust</button>
        </form>
      `
    })
    .join('')
}

function renderBudgetAdjustor(): void {
  if (!budgetAdjustor) {
    return
  }

  const currentBudget = getGlobalBudget()
  const canAdjust = canAdjustUserBudgets()

  budgetAdjustor.innerHTML = `
    <form class="admin-user-row" id="budget-adjust-form">
      <div class="admin-user-meta">
        <strong>Universal Budget</strong>
        <span>Current Budget: £${currentBudget.toFixed(1)}</span>
      </div>
      <div class="admin-point-inputs">
        <input
          class="admin-point-input"
          name="budgetAdjustment"
          type="number"
          step="0.5"
          placeholder="Add/subtract budget"
          value="0"
          ${canAdjust ? '' : 'disabled'}
        />
      </div>
      <button type="submit" class="lock-team-btn" ${canAdjust ? '' : 'disabled'}>Adjust</button>
    </form>
  `

  if (canAdjust) {
    setBudgetMessage('Budget can be changed now (all teams are empty).', 'ok')
  } else {
    setBudgetMessage('Budget can only be changed when all users have empty teams.', 'error')
  }
}

function renderPasswordResetList(): void {
  if (!passwordResetList) {
    return
  }

  const requests = getPasswordResetRequests()

  if (requests.length === 0) {
    passwordResetList.innerHTML = '<p class="empty-state">No pending password reset requests.</p>'
    return
  }

  passwordResetList.innerHTML = requests
    .map(
      (username) => `
        <form class="admin-user-row password-reset-row" data-username="${escapeHtml(username)}">
          <div class="admin-user-meta">
            <strong>${escapeHtml(username)}</strong>
            <span>Requested password reset</span>
          </div>
          <input
            class="admin-team-name-input"
            name="newPassword"
            type="password"
            minlength="4"
            required
            placeholder="New password (min 4 chars)"
          />
          <button type="submit" class="lock-team-btn">Set New Password</button>
        </form>
      `,
    )
    .join('')
}

function renderLeagueList(): void {
  if (!leagueList) {
    return
  }

  const leagues = getAllLeagues()
  if (leagues.length === 0) {
    leagueList.innerHTML = '<p class="empty-state">No leagues created yet.</p>'
    return
  }

  leagueList.innerHTML = leagues
    .map((league) => {
      const memberMarkup = league.members.length > 0
        ? league.members
            .map(
              (member) => `
                <button
                  type="button"
                  class="league-member-chip"
                  data-action="remove-member"
                  data-league-id="${escapeHtml(league.id)}"
                  data-username="${escapeHtml(member)}"
                  title="Remove ${escapeHtml(member)} from ${escapeHtml(league.name)}"
                >
                  ${escapeHtml(member)}
                  <span aria-hidden="true">x</span>
                </button>
              `,
            )
            .join('')
        : '<span class="league-members-empty">No members yet</span>'

      return `
        <article class="admin-league-row">
          <div class="admin-user-meta">
            <form class="admin-league-rename-form" data-action="rename-league" data-league-id="${escapeHtml(league.id)}">
              <input
                class="admin-team-name-input admin-league-name-input"
                name="leagueName"
                type="text"
                value="${escapeHtml(league.name)}"
                minlength="2"
                maxlength="60"
                aria-label="Rename ${escapeHtml(league.name)}"
                required
              />
              <button type="submit" class="lock-team-btn">Rename</button>
            </form>
            <span>Created by ${escapeHtml(league.createdBy || 'Unknown')}</span>
            <div class="league-members">${memberMarkup}</div>
          </div>
          <div class="admin-league-actions">
            <span class="league-id-chip">${escapeHtml(league.id)}</span>
            <button
              type="button"
              class="reset-all-btn admin-league-delete-btn"
              data-action="delete-league"
              data-league-id="${escapeHtml(league.id)}"
            >
              Delete League
            </button>
          </div>
        </article>
      `
    })
    .join('')
}

if (teamNameEditor) {
  teamNameEditor.addEventListener('submit', async (event) => {
    event.preventDefault()

    const form = event.target as HTMLFormElement
    if (!form.classList.contains('admin-user-row')) {
      return
    }

    const username = form.dataset.username
    const usernameInput = form.querySelector<HTMLInputElement>('input[name="username"]')
    const teamNameInput = form.querySelector<HTMLInputElement>('input[name="teamName"]')
    if (!username || !teamNameInput || !usernameInput) {
      return
    }

    const submitEvent = event as SubmitEvent
    const submitter = submitEvent.submitter as HTMLButtonElement | null
    const submitAction = submitter?.dataset.submitAction ?? 'team-name'

    if (submitAction === 'username') {
      if (currentUsername && currentUsername.toLowerCase() === username.toLowerCase()) {
        setMessage('You cannot rename your own admin account.', 'error')
        return
      }

      const renamedUser = renameUser(username, usernameInput.value)
      if (!renamedUser.ok || !renamedUser.username) {
        setMessage(renamedUser.error ?? 'Unable to update username.', 'error')
        return
      }

      const leagueRenameResult = renameUserInLeagues(username, renamedUser.username)
      if (!leagueRenameResult.ok) {
        setMessage(leagueRenameResult.error ?? 'Unable to update username in leagues.', 'error')
        return
      }

      await flushSharedLeagueStorage()

      setMessage(`Updated username ${username} to ${renamedUser.username}.`, 'ok')
      renderTeamNameEditor()
      renderPointAdjustor()
      renderBudgetAdjustor()
      renderLeagueList()
      renderPasswordResetList()
      void refreshDraftMode()
      void refreshBenchMode()
      return
    }

    const result = setTeamNameForUser(username, teamNameInput.value)
    if (!result.ok) {
      setMessage(result.error ?? 'Unable to update team name.', 'error')
      return
    }

    await flushSharedLeagueStorage()

    setMessage(`Updated team name for ${username}.`, 'ok')
    renderTeamNameEditor()
  })

  teamNameEditor.addEventListener('click', async (event) => {
    const target = event.target as HTMLElement
    const deleteButton = target.closest<HTMLButtonElement>('button.admin-user-delete-btn')
    if (!deleteButton) {
      return
    }

    const username = deleteButton.dataset.username
    if (!username) {
      return
    }

    if (currentUsername && currentUsername.toLowerCase() === username.toLowerCase()) {
      setMessage('You cannot delete your own admin account.', 'error')
      return
    }

    const confirmed = window.confirm(
      `Delete user ${username}? This removes their login, team name, saved squad, and pending password reset requests.`,
    )
    if (!confirmed) {
      return
    }

    const deletion = deleteUser(username)
    if (!deletion.ok) {
      setMessage(deletion.error ?? 'Unable to delete user.', 'error')
      return
    }

    for (const league of getAllLeagues()) {
      if (league.members.some((member) => member.toLowerCase() === username.toLowerCase())) {
        removeUserFromLeague(league.id, username)
      }
    }

    await flushSharedLeagueStorage()

    const deletedLabel = deletion.deletedUsername ?? username
    setMessage(`Deleted user ${deletedLabel}.`, 'ok')
    renderTeamNameEditor()
    renderPointAdjustor()
    renderBudgetAdjustor()
    renderLeagueList()
    renderPasswordResetList()
    void refreshDraftMode()
    void refreshBenchMode()
  })
}

if (pointAdjustor) {
  pointAdjustor.addEventListener('submit', async (event) => {
    event.preventDefault()

    const form = event.target as HTMLFormElement
    if (!form.classList.contains('admin-user-row')) {
      return
    }

    const username = form.dataset.username
    const pointInput = form.querySelector<HTMLInputElement>('input[name="pointAdjustment"]')
    if (!username || !pointInput) {
      return
    }

    const adjustment = parseInt(pointInput.value, 10)
    if (!Number.isFinite(adjustment)) {
      setAdjustMessage('Please enter a valid number.', 'error')
      return
    }

    const result = adjustUserPoints(username, adjustment)
    if (!result.ok) {
      setAdjustMessage(result.error ?? 'Unable to adjust points.', 'error')
      return
    }

    await flushSharedLeagueStorage()

    setAdjustMessage(`${adjustment > 0 ? '+' : ''}${adjustment} points awarded to ${username}.`, 'ok')
    renderPointAdjustor()
  })
}

if (budgetAdjustor) {
  budgetAdjustor.addEventListener('submit', async (event) => {
    event.preventDefault()

    const form = event.target as HTMLFormElement
    if (form.id !== 'budget-adjust-form') {
      return
    }

    const budgetInput = form.querySelector<HTMLInputElement>('input[name="budgetAdjustment"]')
    if (!budgetInput) {
      return
    }

    const adjustment = Number.parseFloat(budgetInput.value)
    if (!Number.isFinite(adjustment)) {
      setBudgetMessage('Please enter a valid number.', 'error')
      return
    }

    const result = adjustGlobalBudget(adjustment)
    if (!result.ok) {
      setBudgetMessage(result.error ?? 'Unable to adjust budget.', 'error')
      renderBudgetAdjustor()
      return
    }

    await flushSharedLeagueStorage()

    setBudgetMessage(
      `${adjustment > 0 ? '+' : ''}${adjustment.toFixed(1)} budget applied. New budget: £${getGlobalBudget().toFixed(1)}.`,
      'ok',
    )
    renderBudgetAdjustor()
  })
}

if (passwordResetList) {
  passwordResetList.addEventListener('submit', async (event) => {
    event.preventDefault()

    const form = event.target as HTMLFormElement
    if (!form.classList.contains('password-reset-row')) {
      return
    }

    const username = form.dataset.username
    const newPasswordInput = form.querySelector<HTMLInputElement>('input[name="newPassword"]')
    if (!username || !newPasswordInput) {
      return
    }

    const result = resetUserPassword(username, newPasswordInput.value)
    if (!result.ok) {
      setPasswordResetMessage(result.error ?? 'Unable to reset password.', 'error')
      return
    }

    await flushSharedLeagueStorage()

    setPasswordResetMessage(`Password reset for ${username}.`, 'ok')
    renderPasswordResetList()
  })
}

if (leagueCreateForm) {
  leagueCreateForm.addEventListener('submit', async (event) => {
    event.preventDefault()

    const formData = new FormData(leagueCreateForm)
    const leagueName = String(formData.get('leagueName') ?? '')
    const result = createLeague(leagueName, currentUsername ?? '')
    if (!result.ok || !result.league) {
      setLeagueMessage(result.error ?? 'Unable to create league.', 'error')
      return
    }

    await flushSharedLeagueStorage()

    leagueCreateForm.reset()
    setLeagueMessage(`League created. Share ID ${result.league.id} for ${result.league.name}.`, 'ok')
    renderLeagueList()
  })
}

if (leagueList) {
  leagueList.addEventListener('submit', async (event) => {
    event.preventDefault()

    const form = event.target as HTMLFormElement
    if (!form.classList.contains('admin-league-rename-form')) {
      return
    }

    const leagueId = form.dataset.leagueId
    const leagueNameInput = form.querySelector<HTMLInputElement>('input[name="leagueName"]')
    if (!leagueId || !leagueNameInput) {
      return
    }

    const result = renameLeague(leagueId, leagueNameInput.value)
    if (!result.ok || !result.league) {
      setLeagueMessage(result.error ?? 'Unable to rename league.', 'error')
      return
    }

    await flushSharedLeagueStorage()
    setLeagueMessage(`League ${leagueId} renamed to ${result.league.name}.`, 'ok')
    renderLeagueList()
  })

  leagueList.addEventListener('click', async (event) => {
    const target = event.target as HTMLElement
    const actionButton = target.closest<HTMLElement>('[data-action]')
    if (!actionButton) {
      return
    }

    const action = actionButton.dataset.action
    const leagueId = actionButton.dataset.leagueId
    if (!action || !leagueId) {
      return
    }

    if (action === 'delete-league') {
      const confirmed = window.confirm('Delete this league? Users will stop seeing its table immediately.')
      if (!confirmed) {
        return
      }

      const result = deleteLeague(leagueId)
      if (!result.ok) {
        setLeagueMessage(result.error ?? 'Unable to delete league.', 'error')
        return
      }

      await flushSharedLeagueStorage()
      setLeagueMessage(`League ${leagueId} deleted.`, 'ok')
      renderLeagueList()
      return
    }

    if (action === 'remove-member') {
      const username = actionButton.dataset.username
      if (!username) {
        return
      }

      const result = removeUserFromLeague(leagueId, username)
      if (!result.ok) {
        setLeagueMessage(result.error ?? 'Unable to remove member.', 'error')
        return
      }

      await flushSharedLeagueStorage()
      setLeagueMessage(`${username} removed from league ${leagueId}.`, 'ok')
      renderLeagueList()
    }
  })
}

if (resetAllBtn) {
  resetAllBtn.addEventListener('click', async () => {
    const confirmed = window.confirm(
      'Are you sure you want to reset everything? This will remove all users, all saved teams, all points, and transfer history.',
    )

    if (!confirmed) {
      return
    }

    clearAllPoints()
    clearAllUsersAndTeams()
    clearAllLeagues()
    await flushSharedLeagueStorage()
    window.location.href = '/index.html'
  })
}

if (adminDraftModeBtn) {
  adminDraftModeBtn.addEventListener('click', async () => {
    const enabling = !draftModeEnabled
    try {
      const response = await fetch('/api/draft-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: enabling, user: currentUsername }),
      })
      const payload = (await response.json()) as { error?: string }
      if (!response.ok) {
        setDraftModeMessage(payload.error ?? 'Unable to update draft mode.', 'error')
        return
      }

      setDraftModeMessage(`Draft mode ${enabling ? 'enabled' : 'disabled'}.`, 'ok')
      await refreshDraftMode()
    } catch {
      setDraftModeMessage('Unable to update draft mode.', 'error')
    }
  })
}

if (adminSaveDraftOrderBtn && adminDraftOrderInput) {
  adminSaveDraftOrderBtn.addEventListener('click', async () => {
    const rawOrder = adminDraftOrderInput.value.trim()
    if (!rawOrder) {
      setDraftModeMessage('Enter a draft order first.', 'error')
      return
    }

    try {
      const response = await fetch('/api/draft-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: currentUsername, order: rawOrder }),
      })
      const payload = (await response.json()) as { error?: string }
      if (!response.ok) {
        setDraftModeMessage(payload.error ?? 'Unable to save draft order.', 'error')
        return
      }

      setDraftModeMessage('Draft order saved.', 'ok')
      await refreshDraftMode()
    } catch {
      setDraftModeMessage('Unable to save draft order.', 'error')
    }
  })
}

if (adminBenchModeBtn) {
  adminBenchModeBtn.addEventListener('click', async () => {
    const nextEnabled = !benchModeEnabled

    try {
      const response = await fetch('/api/bench-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user: currentUsername,
          enabled: nextEnabled,
        }),
      })
      const data = (await response.json()) as { error?: string; enabled?: boolean }
      if (!response.ok) {
        setBenchModeMessage(data.error ?? 'Unable to update bench mode.', 'error')
        await refreshBenchMode()
        return
      }

      benchModeEnabled = data.enabled !== false
      setBenchModeMessage(
        benchModeEnabled ? 'Bench mode enabled.' : 'Bench mode disabled.',
        'ok',
      )

      await flushSharedLeagueStorage()
      await refreshBenchMode()
    } catch {
      setBenchModeMessage('Unable to update bench mode.', 'error')
    }
  })
}

if (adminCheckScoresBtn) {
  adminCheckScoresBtn.addEventListener('click', async () => {
    adminCheckScoresBtn.disabled = true
    setFixtureScoreCheckMessage('Checking due fixtures for finished scores...', 'ok')

    try {
      const response = await fetch('/api/admin/fixtures/check-scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: currentUsername }),
      })

      const payload = (await response.json()) as {
        error?: string
        added?: number
        scanned?: number
        total?: number
      }

      if (!response.ok) {
        setFixtureScoreCheckMessage(payload.error ?? 'Unable to check fixture scores.', 'error')
        return
      }

      setFixtureScoreCheckMessage(
        `Score check complete. Added ${payload.added ?? 0} result(s) from ${payload.scanned ?? 0} due fixture(s). Stored results: ${payload.total ?? 0}.`,
        'ok',
      )
    } catch {
      setFixtureScoreCheckMessage('Unable to check fixture scores right now.', 'error')
    } finally {
      adminCheckScoresBtn.disabled = false
    }
  })
}

if (adminClearApiDataBtn) {
  adminClearApiDataBtn.addEventListener('click', async () => {
    const confirmed = window.confirm(
      'Clear all Football API imported fixture results and player points? This cannot be undone.',
    )

    if (!confirmed) {
      return
    }

    adminClearApiDataBtn.disabled = true

    try {
      clearAllPoints()
      const clearedUsers = clearAllUserCarriedPointState()
      removeSharedItem(fixtureResultsStorageKey)
      removeSharedItem(autoImportedEventIdsStorageKey)
      removeSharedItem(importedMatchPlayerPointsStorageKey)
      removeSharedItem(autoScannedFixtureKeysStorageKey)
      await flushSharedLeagueStorage()

      setFixtureScoreCheckMessage(
        `Cleared imported fixture results, all player points, and stale carried team totals for ${clearedUsers} user(s).`,
        'ok',
      )
      renderPointAdjustor()
    } catch {
      setFixtureScoreCheckMessage('Unable to clear imported results and points right now.', 'error')
    } finally {
      adminClearApiDataBtn.disabled = false
    }
  })
}

if (adminForceBackupBtn) {
  adminForceBackupBtn.addEventListener('click', async () => {
    adminForceBackupBtn.disabled = true
    setForceBackupMessage('Creating backup...', 'ok')

    try {
      const response = await fetch('/api/admin/backup-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: currentUsername }),
      })

      const payload = (await response.json()) as { error?: string; file?: string }
      if (!response.ok) {
        setForceBackupMessage(payload.error ?? 'Unable to create backup right now.', 'error')
        return
      }

      const fileLabel = payload.file ? ` (${payload.file})` : ''
      setForceBackupMessage(`Backup created${fileLabel}.`, 'ok')
    } catch {
      setForceBackupMessage('Unable to create backup right now.', 'error')
    } finally {
      adminForceBackupBtn.disabled = false
    }
  })
}

if (adminEndGameweekBtn) {
  adminEndGameweekBtn.addEventListener('click', async () => {
    adminEndGameweekBtn.disabled = true

    try {
      const nextMatchday = getGlobalMatchday() + 1
      updateAllUserMatchdayStates(nextMatchday, true)
      setGlobalMatchday(nextMatchday)
      resetAllPlayerPoints()
      await flushSharedLeagueStorage()
      await refreshSharedLeagueStorage()
      renderGameweekControls()
      setGameweekMessage(`Gameweek ended. Moved to gameweek ${nextMatchday}.`, 'ok')
    } catch {
      setGameweekMessage('Unable to end gameweek right now.', 'error')
    } finally {
      adminEndGameweekBtn.disabled = false
    }
  })
}

if (adminPrevGameweekBtn) {
  adminPrevGameweekBtn.addEventListener('click', async () => {
    const currentMatchday = getGlobalMatchday()
    if (currentMatchday <= 0) {
      setGameweekMessage('Already at gameweek 0.', 'error')
      renderGameweekControls()
      return
    }

    adminPrevGameweekBtn.disabled = true

    try {
      const previousMatchday = currentMatchday - 1
      updateAllUserMatchdayStates(previousMatchday, false)
      setGlobalMatchday(previousMatchday)
      await flushSharedLeagueStorage()
      await refreshSharedLeagueStorage()
      renderGameweekControls()
      setGameweekMessage(
        `Moved back to gameweek ${previousMatchday}. Points were not rolled back.`,
        'ok',
      )
    } catch {
      setGameweekMessage('Unable to move back a gameweek right now.', 'error')
    } finally {
      adminPrevGameweekBtn.disabled = false
    }
  })
}

if (adminFixGw1TotalsBtn) {
  adminFixGw1TotalsBtn.addEventListener('click', async () => {
    const confirmed = window.confirm(
      'Clear stale carried totals for users still on gameweek 1? This keeps only current gameweek points.',
    )

    if (!confirmed) {
      return
    }

    adminFixGw1TotalsBtn.disabled = true

    try {
      const fixedUsers = normalizeLegacyTotalsForGameweekOne()
      await flushSharedLeagueStorage()
      setGameweekMessage(`GW1 legacy totals fixed for ${fixedUsers} user(s).`, 'ok')
      renderPointAdjustor()
    } catch {
      setGameweekMessage('Unable to fix GW1 legacy totals right now.', 'error')
    } finally {
      adminFixGw1TotalsBtn.disabled = false
    }
  })
}

window.addEventListener(sharedLeagueUpdatedEvent, () => {
  renderTeamNameEditor()
  renderPointAdjustor()
  renderBudgetAdjustor()
  renderLeagueList()
  renderPasswordResetList()
  renderGameweekControls()
  void refreshDraftMode()
  void refreshBenchMode()
})

renderTeamNameEditor()
renderPointAdjustor()
renderBudgetAdjustor()
renderLeagueList()
renderPasswordResetList()
renderGameweekControls()
void refreshDraftMode()
void refreshBenchMode()
