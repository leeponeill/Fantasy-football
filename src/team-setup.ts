import './style.css'
import { getTeamNameForUser, requireAuth, setCurrentUserTeamName, signOut } from './auth'
import { flushSharedLeagueStorage } from './sharedLeague'

const username = requireAuth()
const existingTeamName = getTeamNameForUser(username)
if (existingTeamName) {
  window.location.href = '/fixtures.html'
}

const app = document.querySelector<HTMLDivElement>('#app')

if (app) {
  app.innerHTML = `
    <main class="auth-page">
      <section class="auth-card">
        <div class="auth-logo-wrap">
          <img src="/crest-logo.png" alt="League crest" class="auth-logo" />
        </div>
        <h1>Choose Your Team Name</h1>
        <p class="auth-help">Welcome ${username}. Pick your team name now. It cannot be changed later.</p>
        <form id="team-name-form" class="auth-form" autocomplete="off">
          <label for="team-name">Team Name</label>
          <input id="team-name" name="teamName" type="text" required minlength="2" maxlength="40" />
          <button type="submit">Save Team Name</button>
        </form>
        <div class="setup-actions">
          <button id="signout-btn" type="button" class="logout-btn">Sign out</button>
        </div>
        <p id="team-name-message" class="auth-message" aria-live="polite"></p>
      </section>
    </main>
  `

  const form = document.querySelector<HTMLFormElement>('#team-name-form')
  const message = document.querySelector<HTMLParagraphElement>('#team-name-message')
  const signoutBtn = document.querySelector<HTMLButtonElement>('#signout-btn')

  const setMessage = (text: string, type: 'ok' | 'error'): void => {
    if (!message) {
      return
    }

    message.textContent = text
    message.classList.remove('ok', 'error')
    message.classList.add(type)
  }

  if (form) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault()
      const formData = new FormData(form)
      const teamName = String(formData.get('teamName') ?? '')
      const result = setCurrentUserTeamName(teamName)

      if (!result.ok) {
        setMessage(result.error ?? 'Unable to save team name.', 'error')
        return
      }

      await flushSharedLeagueStorage()

      window.location.href = '/fixtures.html'
    })
  }

  if (signoutBtn) {
    signoutBtn.addEventListener('click', () => {
      signOut()
      window.location.href = '/index.html'
    })
  }
}
