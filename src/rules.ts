import { requireAuth } from './auth'
import { renderPage } from './renderPage'

requireAuth()

const scoringRows = [
  { event: 'Plays 1-59 minutes (any player appearance under 60 minutes)', points: '+1' },
  { event: 'Plays 60+ minutes (replaces the +1 appearance score)', points: '+2' },
  { event: 'Goal scored (Goalkeeper)', points: '+10 each' },
  { event: 'Goal scored (Defender)', points: '+6 each' },
  { event: 'Goal scored (Midfielder)', points: '+5 each' },
  { event: 'Goal scored (Forward)', points: '+4 each' },
  { event: 'Assist', points: '+3 each' },
  { event: 'Clean sheet (Goalkeeper or Defender, only if 60+ minutes)', points: '+4' },
  { event: 'Clean sheet (Midfielder, only if 60+ minutes)', points: '+1' },
  { event: 'Shot saves (Goalkeeper, rounded down in groups of 3)', points: '+1 per 3 saves' },
  { event: 'Defensive contributions (Defender, when contributions reach 10+)', points: '+2' },
  { event: 'Defensive contributions (Midfielder or Forward, when contributions reach 12+)', points: '+2' },
  { event: 'Penalty save', points: '+5 each' },
  { event: 'Penalty miss', points: '-2 each' },
  { event: 'Goals conceded (Goalkeeper or Defender, rounded down in groups of 2 conceded)', points: '-1 per 2 goals' },
  { event: 'Yellow card', points: '-1 each' },
  { event: 'Red card (in addition to any yellow-card deduction already applied)', points: '-3 each' },
  { event: 'Own goal', points: '-2 each' },
  { event: 'Captain gets double points (captain score is added again)', points: 'x2 total' },
]

const scoringTable = scoringRows
  .map(
    (row) => `
      <tr>
        <td>${row.event}</td>
        <td>${row.points}</td>
      </tr>
    `,
  )
  .join('')

const rulesMarkup = `
  <section class="rules-grid">
    <article class="rules-card">
      <h2>How Players Score Points</h2>
      <p class="players-help">Scoring is applied per player performance each matchday.</p>
      <div class="history-table-wrap">
        <table class="history-table rules-table">
          <thead>
            <tr>
              <th>Event</th>
              <th>Points</th>
            </tr>
          </thead>
          <tbody>${scoringTable}</tbody>
        </table>
      </div>
    </article>

    <article class="rules-card">
      <h2>Transfer Limits</h2>
      <ul class="rules-list">
        <li>You get up to 3 transfers per matchday while teams are locked.</li>
        <li>Transfers can be made mid gameweek, including for players who have already played, except from kickoff until 3.5 hours after kickoff of any game involving that player's team.</li>
        <li>On Matchday 0, transfers are unlimited and do not consume transfer count.</li>
        <li>Each player removed counts toward transfer usage for that matchday.</li>
        <li>Transfers reset to 0 used when the global matchday advances.</li>
      </ul>
    </article>
  </section>
`

renderPage('Rules', 'rules', rulesMarkup)
