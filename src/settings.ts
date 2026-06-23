import {
  getTeamTileDisplayPreferenceForUser,
  getCurrentUsername,
  getTeamNameForUser,
  requireAuth,
  setCurrentUserTeamTileDisplayPreference,
  setTeamNameForUser,
} from './auth'
import { renderPage } from './renderPage'
import { applyTheme, applyThemeFromStorage, saveTheme, type ThemeMode } from './theme'
import { flushSharedLeagueStorage, setSharedItem, sharedLeagueUpdatedEvent } from './sharedLeague'

requireAuth()

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function getThemeLabel(theme: ThemeMode): string {
  return theme === 'dark' ? 'Dark' : 'Light'
}

function getToggleButtonLabel(theme: ThemeMode): string {
  return theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'
}

type TeamTileDisplayMode = 'flag' | 'name'

const teamTileDisplayStorageKey = 'fantasy-football-team-tile-display-mode'

function getTeamTileDisplayMode(): TeamTileDisplayMode {
  const username = getCurrentUsername()
  if (username) {
    const perUserPreference = getTeamTileDisplayPreferenceForUser(username)
    if (perUserPreference) {
      return perUserPreference
    }
  }

  return 'flag'
}

function setTeamTileDisplayMode(mode: TeamTileDisplayMode): void {
  setCurrentUserTeamTileDisplayPreference(mode)
  // Keep legacy global key in sync for older clients/pages that still read it.
  setSharedItem(teamTileDisplayStorageKey, mode)
}

function getTeamTileDisplayLabel(mode: TeamTileDisplayMode): string {
  return mode === 'name' ? 'Team Name' : 'Flag'
}

function getTeamTileDisplayToggleLabel(mode: TeamTileDisplayMode): string {
  return mode === 'name' ? 'Show Flag' : 'Show Team Name'
}

function renderSettings(theme: ThemeMode): void {
  const username = getCurrentUsername()
  const currentTeamName = username ? getTeamNameForUser(username) ?? '' : ''
  const canAwardPoints = username?.toLowerCase() === 'lee'
  const teamTileDisplayMode = getTeamTileDisplayMode()

  const markup = `
    <section class="admin-card settings-card">
      <h2>Appearance</h2>
      <p class="players-help">Current theme: <strong id="theme-current-label">${getThemeLabel(theme)}</strong></p>
      <button id="theme-toggle-btn" type="button" class="lock-team-btn">${getToggleButtonLabel(theme)}</button>
      <p class="players-help">Player tiles: <strong id="team-tile-display-current-label">${getTeamTileDisplayLabel(teamTileDisplayMode)}</strong></p>
      <button id="team-tile-display-toggle-btn" type="button" class="lock-team-btn">${getTeamTileDisplayToggleLabel(teamTileDisplayMode)}</button>
    </section>

    ${canAwardPoints ? `
    <section class="admin-card settings-card">
      <h2>Lee Tools</h2>
      <p class="players-help">Quick access to admin-only pages.</p>
      <div class="settings-links">
        <a class="lock-team-btn settings-link-btn" href="/stats.html">Stats</a>
        <a class="lock-team-btn settings-link-btn" href="/admin.html">Admin</a>
        <a class="lock-team-btn settings-link-btn" href="/all-teams.html">All User Teams</a>
      </div>
    </section>
    ` : ''}

    <section class="admin-card settings-card">
      <h2>My Team Name</h2>
      <p class="players-help">Current team name: <strong id="team-name-current-label">${escapeHtml(currentTeamName || 'Not set')}</strong></p>
      <form id="team-name-form" class="admin-user-row">
        <input
          id="team-name-input"
          class="admin-team-name-input"
          name="teamName"
          type="text"
          value="${escapeHtml(currentTeamName)}"
          minlength="2"
          placeholder="Enter team name"
          required
        />
        <button type="submit" class="lock-team-btn">Save Team Name</button>
      </form>
      <p id="team-name-message" class="admin-message" aria-live="polite"></p>
    </section>
  `

  renderPage('Settings', 'settings', markup)

  const themeLabel = document.querySelector<HTMLSpanElement>('#theme-current-label')
  const themeToggleBtn = document.querySelector<HTMLButtonElement>('#theme-toggle-btn')
  const teamTileDisplayLabel = document.querySelector<HTMLSpanElement>('#team-tile-display-current-label')
  const teamTileDisplayToggleBtn = document.querySelector<HTMLButtonElement>('#team-tile-display-toggle-btn')
  const teamNameForm = document.querySelector<HTMLFormElement>('#team-name-form')
  const teamNameInput = document.querySelector<HTMLInputElement>('#team-name-input')
  const teamNameCurrentLabel = document.querySelector<HTMLSpanElement>('#team-name-current-label')
  const teamNameMessage = document.querySelector<HTMLParagraphElement>('#team-name-message')

  if (!themeToggleBtn || !themeLabel) {
    return
  }

  let currentTheme = theme
  themeToggleBtn.addEventListener('click', () => {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark'
    applyTheme(currentTheme)
    saveTheme(currentTheme)
    themeLabel.textContent = getThemeLabel(currentTheme)
    themeToggleBtn.textContent = getToggleButtonLabel(currentTheme)
  })

  if (teamTileDisplayLabel && teamTileDisplayToggleBtn) {
    let currentTeamTileDisplayMode = teamTileDisplayMode
    teamTileDisplayToggleBtn.addEventListener('click', async () => {
      currentTeamTileDisplayMode = currentTeamTileDisplayMode === 'flag' ? 'name' : 'flag'
      setTeamTileDisplayMode(currentTeamTileDisplayMode)
      await flushSharedLeagueStorage()
      teamTileDisplayLabel.textContent = getTeamTileDisplayLabel(currentTeamTileDisplayMode)
      teamTileDisplayToggleBtn.textContent = getTeamTileDisplayToggleLabel(currentTeamTileDisplayMode)
    })
  }

  if (teamNameForm && teamNameInput && teamNameCurrentLabel && teamNameMessage) {
    const setTeamNameMessage = (text: string, type: 'ok' | 'error'): void => {
      teamNameMessage.textContent = text
      teamNameMessage.classList.remove('ok', 'error')
      teamNameMessage.classList.add(type)
    }

    teamNameForm.addEventListener('submit', async (event) => {
      event.preventDefault()
      const currentUsername = getCurrentUsername()
      if (!currentUsername) {
        setTeamNameMessage('No signed in user found.', 'error')
        return
      }

      const nextTeamName = teamNameInput.value.trim()
      const result = setTeamNameForUser(currentUsername, nextTeamName)
      if (!result.ok) {
        setTeamNameMessage(result.error ?? 'Unable to save team name.', 'error')
        return
      }

      await flushSharedLeagueStorage()
      const refreshedTeamName = getTeamNameForUser(currentUsername) ?? nextTeamName
      teamNameCurrentLabel.textContent = refreshedTeamName
      teamNameInput.value = refreshedTeamName
      setTeamNameMessage('Team name updated.', 'ok')
    })

    window.addEventListener(sharedLeagueUpdatedEvent, () => {
      const currentUsername = getCurrentUsername()
      if (!currentUsername) {
        return
      }

      const refreshedTeamName = getTeamNameForUser(currentUsername) ?? ''
      teamNameCurrentLabel.textContent = refreshedTeamName || 'Not set'
      if (document.activeElement !== teamNameInput) {
        teamNameInput.value = refreshedTeamName
      }

      if (teamTileDisplayLabel && teamTileDisplayToggleBtn) {
        const refreshedMode = getTeamTileDisplayMode()
        teamTileDisplayLabel.textContent = getTeamTileDisplayLabel(refreshedMode)
        teamTileDisplayToggleBtn.textContent = getTeamTileDisplayToggleLabel(refreshedMode)
      }
    })
  }
}

const initialTheme = applyThemeFromStorage()
renderSettings(initialTheme)
