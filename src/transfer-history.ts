import { requireAuth } from './auth'
import { renderPage } from './renderPage'
import { sharedLeagueUpdatedEvent } from './sharedLeague'
import { getCurrentUsername } from './auth'
import { getLeaguesForUser } from './leagues'

requireAuth()

let showAllTransfers = false
let currentUsername = ''
let userLeagueMembers = new Set<string>()

type TransferSale = {
  id: string
  playerKey: string
  playerName: string
  buyerUser: string
  sellerUser: string
  marketPrice: number
  salePrice: number
  type: string
  Gameweek?: number | null
  createdAt: string
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function updateShowAllTransfers(show: boolean): void {
  showAllTransfers = show
  localStorage.setItem('fantasy-football-transfer-history-show-all', show ? 'true' : 'false')
  void refreshTransferHistory()
}

function isUserInSharedLeague(userName: string): boolean {
  if (showAllTransfers && currentUsername.toLowerCase() === 'lee') {
    return true
  }

  return userLeagueMembers.has(userName.toLowerCase())
}

function filterTransfersForUser(sales: TransferSale[]): TransferSale[] {
  if (showAllTransfers && currentUsername.toLowerCase() === 'lee') {
    return sales
  }

  return sales.filter((sale) => {
    const buyerInLeague = isUserInSharedLeague(sale.buyerUser)
    const sellerInLeague = isUserInSharedLeague(sale.sellerUser)
    return buyerInLeague || sellerInLeague
  })
}

function renderHistory(sales: TransferSale[], draftEnabled: boolean): void {
  const container = document.querySelector<HTMLDivElement>('#transfer-history-list')
  if (!container) {
    return
  }

  const filteredSales = filterTransfersForUser(sales)

  if (filteredSales.length === 0) {
    container.innerHTML = '<p class="players-help">No transfer sales recorded yet.</p>'
    return
  }

  const rows = filteredSales
    .map((sale) => {
      const when = new Date(sale.createdAt)
      const whenLabel = Number.isNaN(when.getTime()) ? sale.createdAt : when.toLocaleString()
      const GameweekLabel = Number.isFinite(sale.Gameweek) ? String(sale.Gameweek) : '-'
      return `
        <tr>
          <td>${escapeHtml(whenLabel)}</td>
          <td>${escapeHtml(GameweekLabel)}</td>
          <td>${escapeHtml(sale.playerName || sale.playerKey)}</td>
          <td>${escapeHtml(sale.buyerUser)}</td>
          <td>${escapeHtml(sale.sellerUser)}</td>
          ${draftEnabled ? `<td>£${Number(sale.marketPrice ?? 0).toFixed(1)}</td>` : ''}
          ${draftEnabled ? `<td>£${Number(sale.salePrice ?? 0).toFixed(1)}</td>` : ''}
        </tr>
      `
    })
    .join('')

  container.innerHTML = `
    <div class="history-table-wrap">
      <table class="history-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Game Week</th>
            <th>Player</th>
            <th>User Bought</th>
            <th>User Sold</th>
            ${draftEnabled ? '<th>Market Price</th>' : ''}
            ${draftEnabled ? '<th>Price of Sale</th>' : ''}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `
}

async function refreshTransferHistory(): Promise<void> {
  const status = document.querySelector<HTMLParagraphElement>('#transfer-history-status')
  const toggleContainer = document.querySelector<HTMLDivElement>('#transfer-history-toggle-container')

  try {
    if (status) {
      status.textContent = 'Showing all player sales with the most recent first.'
    }

    const response = await fetch('/api/transfer-history', { cache: 'no-store' })
    if (!response.ok) {
      throw new Error('Failed to load transfer history')
    }

    const data = (await response.json()) as { sales?: TransferSale[]; draftEnabled?: boolean }
    renderHistory(Array.isArray(data.sales) ? data.sales : [], data.draftEnabled === true)
  } catch {
    if (status) {
      status.textContent = 'Unable to load transfer history right now.'
    }
    renderHistory([], false)
  }

  if (toggleContainer && currentUsername.toLowerCase() === 'lee') {
    toggleContainer.innerHTML = `
      <label style="display: flex; align-items: center; gap: 0.5em; font-size: 0.9em; margin-bottom: 1em;">
        <input type="checkbox" id="show-all-transfers-toggle" ${showAllTransfers ? 'checked' : ''} />
        Show transfers from all users
      </label>
    `

    const toggleInput = document.querySelector<HTMLInputElement>('#show-all-transfers-toggle')
    if (toggleInput) {
      toggleInput.addEventListener('change', (e) => {
        updateShowAllTransfers((e.target as HTMLInputElement).checked)
      })
    }
  }
}

const markup = `
  <p class="players-help" id="transfer-history-status">Loading transfer history...</p>
  <div id="transfer-history-toggle-container"></div>
  <section id="transfer-history-list"></section>
`

renderPage('Transfer History', 'transfer-history', markup)

void (async () => {
  currentUsername = getCurrentUsername() ?? ''

  if (currentUsername) {
    const userLeagues = getLeaguesForUser(currentUsername)
    const memberSet = new Set<string>()

    for (const league of userLeagues) {
      for (const member of league.members) {
        memberSet.add(member.toLowerCase())
      }
    }

    userLeagueMembers = memberSet

    const savedShowAll = localStorage.getItem('fantasy-football-transfer-history-show-all')
    if (currentUsername.toLowerCase() === 'lee' && savedShowAll === 'true') {
      showAllTransfers = true
    }
  }

  await refreshTransferHistory()
})()

void refreshTransferHistory()
window.addEventListener(sharedLeagueUpdatedEvent, () => {
  void refreshTransferHistory()
})
