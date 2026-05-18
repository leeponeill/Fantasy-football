import './style.css'
import { getCurrentUsername, requireCurrentUserTeamName, signOut } from './auth'

export type Tab = 'fixtures' | 'players' | 'my-team' | 'stats' | 'table' | 'admin'

export function renderPage(title: string, activeTab: Tab, content = ''): void {
  const app = document.querySelector<HTMLDivElement>('#app')
  const username = getCurrentUsername()
  requireCurrentUserTeamName()
  const canAwardPoints = username?.toLowerCase() === 'lee'

  if (!app) {
    return
  }

  const escapedUsername = username
    ? username
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;')
    : ''

  app.innerHTML = `
    <nav class="tabs" aria-label="Primary">
      <div class="tabs-left">
        <a class="nav-logo-link" href="/fixtures.html" aria-label="Go to fixtures">
          <img src="/crest-logo.png" alt="League crest" class="site-logo" />
        </a>
        <a class="tab ${activeTab === 'fixtures' ? 'active' : ''}" href="/fixtures.html">Fixtures</a>
        <a class="tab ${activeTab === 'players' ? 'active' : ''}" href="/players.html">Players</a>
        <a class="tab ${activeTab === 'my-team' ? 'active' : ''}" href="/my-team.html">My Team</a>
        ${canAwardPoints ? `<a class="tab ${activeTab === 'stats' ? 'active' : ''}" href="/stats.html">Award Points</a>` : ''}
        ${canAwardPoints ? `<a class="tab ${activeTab === 'admin' ? 'active' : ''}" href="/admin.html">Admin</a>` : ''}
        <a class="tab ${activeTab === 'table' ? 'active' : ''}" href="/table.html">Table</a>
      </div>
      <div class="tabs-right">
        <span class="nav-user">Signed in: ${escapedUsername}</span>
        <button type="button" class="logout-btn" id="logout-btn">Sign out</button>
      </div>
    </nav>
    <main class="page-content">
      <h1>${title}</h1>
      ${content}
    </main>
  `

  const logoutBtn = document.querySelector<HTMLButtonElement>('#logout-btn')
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      signOut()
      window.location.href = '/index.html'
    })
  }
}
