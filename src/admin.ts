import { renderPage } from './renderPage'
import {
  adjustUserPoints,
  clearAllUsersAndTeams,
  getAllUsernames,
  getCurrentUsername,
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
const passwordResetMessageEl = document.querySelector<HTMLParagraphElement>('#password-reset-message')
const teamNameEditor = document.querySelector<HTMLDivElement>('#team-name-editor')
const pointAdjustor = document.querySelector<HTMLDivElement>('#point-adjustor')
const passwordResetList = document.querySelector<HTMLDivElement>('#password-reset-list')
const resetAllBtn = document.querySelector<HTMLButtonElement>('#reset-all-btn')
const draftModeStatusEl = document.querySelector<HTMLParagraphElement>('#draft-mode-status')
const draftModeMessageEl = document.querySelector<HTMLParagraphElement>('#draft-mode-message')
const adminDraftModeBtn = document.querySelector<HTMLButtonElement>('#admin-draft-mode-btn')
const adminDraftOrderInput = document.querySelector<HTMLInputElement>('#admin-draft-order-input')
const adminSaveDraftOrderBtn = document.querySelector<HTMLButtonElement>('#admin-save-draft-order-btn')

let draftModeEnabled = false
let draftModeCanEnable = false
let draftOrder: string[] = []
let draftComplete = false
let draftCurrentTurn: string | null = null

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
      'Are you sure you want to reset everything? This will remove all users, all saved teams, and all points.',
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

window.addEventListener(sharedLeagueUpdatedEvent, () => {
  renderTeamNameEditor()
  renderPointAdjustor()
  renderPasswordResetList()
  void refreshDraftMode()
})

renderTeamNameEditor()
renderPointAdjustor()
renderPasswordResetList()
void refreshDraftMode()
