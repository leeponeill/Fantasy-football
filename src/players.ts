import { renderPage } from './renderPage'
import { getTeamsSorted, positionOrder, type TeamSquad } from './teamsData'
import { getPlayerPoints, getTotalAccumulatedPoints } from './teamsData'
import { requireAuth } from './auth'

requireAuth()

function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;')
}


function renderTeams(teams: TeamSquad[]): string {
	return teams
		.map((team) => {
			const statusLabel = team.status === 'final' ? 'Final' : 'Preliminary'
			const orderedPlayers = [...team.players].sort((a, b) => {
				const aRank = positionOrder[a.position] ?? 99
				const bRank = positionOrder[b.position] ?? 99
				if (aRank !== bRank) {
					return aRank - bRank
				}

				return a.name.localeCompare(b.name)
			})
			const playerRows =
				orderedPlayers.length > 0
					? orderedPlayers
							.map(
								(player) => {
									const totalPoints = getTotalAccumulatedPoints(player.name, team.name) + getPlayerPoints(player.name, team.name)
									return `<li>${escapeHtml(player.name)} <span class="player-price">(£${player.price.toFixed(1)})</span> <span class="player-points">(${totalPoints}pts)</span> <span class="player-position">(${escapeHtml(player.position)})</span></li>`
								},
							)
							.join('')
					: '<li>No players listed yet.</li>'

			return `
				<details class="team-card">
					<summary>
						<span class="team-name">${escapeHtml(team.name)}</span>
						<span class="team-status ${team.status}">${statusLabel}</span>
					</summary>
					<ul class="player-list">${playerRows}</ul>
				</details>
			`
		})
		.join('')
}

const teams = getTeamsSorted()
const playersMarkup = `
	<p class="players-help">Click a team to view its players.</p>
	<section class="teams-list">${renderTeams(teams)}</section>
`

renderPage('Players', 'players', playersMarkup)
