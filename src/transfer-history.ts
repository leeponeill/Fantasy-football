import { requireAuth } from './auth'
import { renderPage } from './renderPage'
import { sharedLeagueUpdatedEvent } from './sharedLeague'

requireAuth()

type TransferSale = {
  id: string
  playerKey: string
  playerName: string
  buyerUser: string
  sellerUser: string
  marketPrice: number
  salePrice: number
  type: string
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

function renderHistory(sales: TransferSale[]): void {
  const container = document.querySelector<HTMLDivElement>('#transfer-history-list')
  if (!container) {
    return
  }

  if (sales.length === 0) {
    container.innerHTML = '<p class="players-help">No transfer sales recorded yet.</p>'
    return
  }

  const rows = sales
    .map((sale) => {
      const when = new Date(sale.createdAt)
      const whenLabel = Number.isNaN(when.getTime()) ? sale.createdAt : when.toLocaleString()
      return `
        <tr>
          <td>${escapeHtml(whenLabel)}</td>
          <td>${escapeHtml(sale.playerName || sale.playerKey)}</td>
          <td>${escapeHtml(sale.buyerUser)}</td>
          <td>${escapeHtml(sale.sellerUser)}</td>
          <td>£${Number(sale.marketPrice ?? 0).toFixed(1)}</td>
          <td>£${Number(sale.salePrice ?? 0).toFixed(1)}</td>
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
            <th>Player</th>
            <th>User Bought</th>
            <th>User Sold</th>
            <th>Market Price</th>
            <th>Price of Sale</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `
}

async function refreshTransferHistory(): Promise<void> {
  const status = document.querySelector<HTMLParagraphElement>('#transfer-history-status')

  try {
    const draftResponse = await fetch('/api/draft-mode', { cache: 'no-store' })
    const draftData = (await draftResponse.json()) as { enabled?: boolean }
    if (draftData.enabled !== true) {
      if (status) {
        status.textContent = 'Transfer history is only available while draft mode is enabled.'
      }
      renderHistory([])
      return
    }

    if (status) {
      status.textContent = 'Showing all player sales in chronological order.'
    }

    const response = await fetch('/api/transfer-history', { cache: 'no-store' })
    if (!response.ok) {
      throw new Error('Failed to load transfer history')
    }

    const data = (await response.json()) as { sales?: TransferSale[] }
    renderHistory(Array.isArray(data.sales) ? data.sales : [])
  } catch {
    if (status) {
      status.textContent = 'Unable to load transfer history right now.'
    }
    renderHistory([])
  }
}

const markup = `
  <p class="players-help" id="transfer-history-status">Loading transfer history...</p>
  <section id="transfer-history-list"></section>
`

renderPage('Transfer History', 'transfer-history', markup)
void refreshTransferHistory()
window.addEventListener(sharedLeagueUpdatedEvent, () => {
  void refreshTransferHistory()
})
