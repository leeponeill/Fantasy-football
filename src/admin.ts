import { renderPage } from './renderPage'
import {
  adjustGlobalBudget,
  adjustUserPoints,
  canAdjustUserBudgets,
  clearAllUsersAndTeams,
  getAllUsernames,
  getCurrentUsername,
  getGlobalBudget,
  getPasswordResetRequests,
  getTeamNameForUser,
  getUserTotalPoints,
  requireAuth,
  resetUserPassword,
  setTeamNameForUser,
} from './auth'
import { clearAllPoints } from './teamsData'
import { flushSharedLeagueStorage, sharedLeagueUpdatedEvent } from './sharedLeague'

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
      </div>
      <p class="danger-copy">Checks only fixtures that kicked off at least 2.5 hours ago.</p>
    </section>

    <section class="admin-card">
      <h2>Edit User Team Names</h2>
      <p id="admin-message" class="admin-message" aria-live="polite"></p>
      <div id="team-name-editor" class="admin-list"></div>
    </section>

    <section class="admin-card">
      <h2>Adjust User Points</h2>
      <p id="adjust-message" class="admin-message" aria-live="polite"></p>
      <div id="point-adjustor" class="admin-list"></div>
    </section>

    <section class="admin-card">
      <h2>League Budget</h2>
      <p id="budget-message" class="admin-message" aria-live="polite"></p>
      <div id="budget-adjustor" class="admin-list"></div>
    </section>

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
const passwordResetMessageEl = document.querySelector<HTMLParagraphElement>('#password-reset-message')
const teamNameEditor = document.querySelector<HTMLDivElement>('#team-name-editor')
const pointAdjustor = document.querySelector<HTMLDivElement>('#point-adjustor')
const budgetAdjustor = document.querySelector<HTMLDivElement>('#budget-adjustor')
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

let draftModeEnabled = false
let draftModeCanEnable = false
let draftOrder: string[] = []
let draftComplete = false
let draftCurrentTurn: string | null = null
let benchModeEnabled = true
let benchModeCanToggle = false

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
      return `
        <form class="admin-user-row" data-username="${escapeHtml(username)}">
          <div class="admin-user-meta">
            <strong>${escapeHtml(username)}</strong>
            <span>Current: ${escapeHtml(currentTeamName || 'No team name set')}</span>
          </div>
          <input
            class="admin-team-name-input"
            name="teamName"
            type="text"
            value="${escapeHtml(currentTeamName)}"
            placeholder="Enter team name"
            minlength="2"
            required
          />
          <button type="submit" class="lock-team-btn">Save</button>
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

if (teamNameEditor) {
  teamNameEditor.addEventListener('submit', async (event) => {
    event.preventDefault()

    const form = event.target as HTMLFormElement
    if (!form.classList.contains('admin-user-row')) {
      return
    }

    const username = form.dataset.username
    const teamNameInput = form.querySelector<HTMLInputElement>('input[name="teamName"]')
    if (!username || !teamNameInput) {
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

window.addEventListener(sharedLeagueUpdatedEvent, () => {
  renderTeamNameEditor()
  renderPointAdjustor()
  renderBudgetAdjustor()
  renderPasswordResetList()
  void refreshDraftMode()
  void refreshBenchMode()
})

renderTeamNameEditor()
renderPointAdjustor()
renderBudgetAdjustor()
renderPasswordResetList()
void refreshDraftMode()
void refreshBenchMode()
