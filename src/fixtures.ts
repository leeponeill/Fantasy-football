import { renderPage } from './renderPage'
import {
	type FixtureGame,
} from './fixturesData'
import {
	getWCFixtureMatchdays,
	type WCFixtureGame,
	type WCFixtureMatchday,
} from './fixturesData'
import { requireAuth } from './auth'
import { getCountryFlag } from './teamsData'

requireAuth()

const stadiumCountry: Record<string, 'Mexico' | 'USA' | 'Canada'> = {
	'Guadalajara Stadium': 'Mexico',
	'Mexico City Stadium': 'Mexico',
	'Monterrey Stadium': 'Mexico',
	'BC Place Vancouver': 'Canada',
	'Toronto Stadium': 'Canada',
	'Atlanta Stadium': 'USA',
	'Boston Stadium': 'USA',
	'Dallas Stadium': 'USA',
	'Houston Stadium': 'USA',
	'Kansas City Stadium': 'USA',
	'Los Angeles Stadium': 'USA',
	'Miami Stadium': 'USA',
	'New York/New Jersey Stadium': 'USA',
	'Philadelphia Stadium': 'USA',
	'San Francisco Bay Area Stadium': 'USA',
	'Seattle Stadium': 'USA',
}

function getHostCountryForStadium(stadium: string): 'Mexico' | 'USA' | 'Canada' | '' {
	return stadiumCountry[stadium] ?? ''
}

function withTeamFlag(name: string): string {
	return `${getCountryFlag(name)} ${name}`
}

function formatMatch(match: string): string {
	if (!match.includes(' vs ')) {
		return match
	}

	const [left, right] = match.split(' vs ')
	return `${withTeamFlag(left)} vs ${withTeamFlag(right)}`
}

function parseFixtureKickoff(game: FixtureGame, now: Date): Date | null {
	const dateWithoutWeekday = game.date.includes(',') ? game.date.split(',').slice(1).join(',').trim() : game.date.trim()
	const dateMatch = dateWithoutWeekday.match(/^([A-Za-z]+)\s+(\d{1,2})$/)
	if (!dateMatch) {
		return null
	}

	const timeMatch = game.time.trim().toLowerCase().match(/^(\d{1,2})(?:\.(\d{1,2}))?(am|pm)$/)
	if (!timeMatch) {
		return null
	}

	const monthName = dateMatch[1]
	const day = Number.parseInt(dateMatch[2], 10)
	const monthIndex = [
		'january',
		'february',
		'march',
		'april',
		'may',
		'june',
		'july',
		'august',
		'september',
		'october',
		'november',
		'december',
	].indexOf(monthName.toLowerCase())

	if (monthIndex < 0 || !Number.isFinite(day)) {
		return null
	}

	const hour12 = Number.parseInt(timeMatch[1], 10)
	const minute = Number.parseInt(timeMatch[2] ?? '0', 10)
	const meridian = timeMatch[3]
	if (!Number.isFinite(hour12) || !Number.isFinite(minute)) {
		return null
	}

	let hour24 = hour12 % 12
	if (meridian === 'pm') {
		hour24 += 12
	}

	const currentYear = now.getFullYear()
	const kickoff = new Date(currentYear, monthIndex, day, hour24, minute, 0, 0)
	const halfYearMs = 180 * 24 * 60 * 60 * 1000
	if (kickoff.getTime() - now.getTime() > halfYearMs) {
		kickoff.setFullYear(currentYear - 1)
	} else if (now.getTime() - kickoff.getTime() > halfYearMs) {
		kickoff.setFullYear(currentYear + 1)
	}

	return kickoff
}

function renderWCSectionMarkup(matchdays: WCFixtureMatchday[], section: 'fixtures' | 'results'): string {
	if (matchdays.length === 0) {
		return section === 'fixtures'
			? '<p class="empty-state">No upcoming fixtures match your filter.</p>'
			: '<p class="empty-state">No finished fixtures match your filter.</p>'
	}

	if (section === 'fixtures') {
		return matchdays
			.map(
				(matchday) => `
					<section class="fixture-matchday">
						<h2>${matchday.round || `Matchday ${matchday.matchday}`}</h2>
						<ul class="fixture-list">
							${matchday.games
								.map(
									(game) => `
										<li class="fixture-item">
											<span class="fixture-date">${game.date}</span>
											<span class="fixture-time">${game.time}</span>
											<span class="fixture-match">${formatMatch(game.match)}</span>
											<span class="fixture-country">${game.stadium}</span>
											${(game as WCFixtureGame).group ? `<span class="fixture-group">${(game as WCFixtureGame).group}</span>` : ''}
										</li>
									`,
								)
								.join('')}
						</ul>
					</section>
				`,
			)
			.join('')
	}

	return matchdays
		.map(
			(matchday) => `
				<section class="fixture-matchday fixture-matchday--results"> 
					<h2>${matchday.round || `Matchday ${matchday.matchday}`}</h2>
					<ul class="fixture-list">
						${matchday.games
							.map((game) => {
								return `
									<li class="fixture-item fixture-item--result">
										<span class="fixture-date">${game.date}</span>
										<span class="fixture-time">${game.time}</span>
										<span class="fixture-match">${formatMatch(game.match)}</span>
										<span class="fixture-country">${(game as WCFixtureGame).stadium || ''}</span>
										${(game as WCFixtureGame).group ? `<span class="fixture-group">${(game as WCFixtureGame).group}</span>` : ''}
									</li>
								`
							})
							.join('')}
					</ul>
				</section>
			`,
		)
		.join('')
}

function renderFixturesAndResultsMarkup(searchText: string, selectedCountry: string): string {
	const query = searchText.trim().toLowerCase()
	const now = new Date()
	const upcomingMatchdays: WCFixtureMatchday[] = []
	const pastMatchdays: WCFixtureMatchday[] = []

	for (const matchday of fixtureMatchdays) {
		const upcomingGames: WCFixtureGame[] = []
		const pastGames: WCFixtureGame[] = []

		for (const game of matchday.games) {
			const countryMatches = selectedCountry === '' || getHostCountryForStadium(game.stadium) === selectedCountry
			const stadiumText = game.stadium.toLowerCase()
			const textMatches =
				query === '' ||
				game.date.toLowerCase().includes(query) ||
				game.match.toLowerCase().includes(query) ||
				game.time.toLowerCase().includes(query) ||
				stadiumText.includes(query) ||
				game.group.toLowerCase().includes(query) ||
				game.round.toLowerCase().includes(query)

			if (!(countryMatches && textMatches)) {
				continue
			}

			const kickoff = parseFixtureKickoff(game as unknown as FixtureGame, now)
			if (kickoff && kickoff.getTime() < now.getTime()) {
				pastGames.push(game)
			} else {
				upcomingGames.push(game)
			}
		}

		if (upcomingGames.length > 0) {
			upcomingMatchdays.push({
				matchday: matchday.matchday,
				round: matchday.round,
				games: upcomingGames,
			})
		}

		if (pastGames.length > 0) {
			pastMatchdays.push({
				matchday: matchday.matchday,
				round: matchday.round,
				games: pastGames,
			})
		}
	}

	// Results: reverse chronological — sort matchdays most recent first,
	// and within each matchday sort games most recent kickoff first
	const sortedPastMatchdays = [...pastMatchdays]
		.sort((a, b) => b.matchday - a.matchday)
		.map((md) => ({
			...md,
			games: [...md.games].sort((a, b) => {
				const ta = parseFixtureKickoff(a as unknown as FixtureGame, now)?.getTime() ?? 0
				const tb = parseFixtureKickoff(b as unknown as FixtureGame, now)?.getTime() ?? 0
				return tb - ta
			}),
		}))
	// Fixtures: chronological (lowest matchday first), games by kickoff ascending
	const sortedUpcomingMatchdays = [...upcomingMatchdays]
		.sort((a, b) => a.matchday - b.matchday)
		.map((md) => ({
			...md,
			games: [...md.games].sort((a, b) => {
				const ta = parseFixtureKickoff(a as unknown as FixtureGame, now)?.getTime() ?? Number.MAX_SAFE_INTEGER
				const tb = parseFixtureKickoff(b as unknown as FixtureGame, now)?.getTime() ?? Number.MAX_SAFE_INTEGER
				return ta - tb
			}),
		}))

	return `
		<div class="fixtures-results-columns">
			<section class="fixture-section">
				<h2>Results</h2>
				${renderWCSectionMarkup(sortedPastMatchdays, 'results')}
			</section>
			<section class="fixture-section">
				<h2>Fixtures</h2>
				${renderWCSectionMarkup(sortedUpcomingMatchdays, 'fixtures')}
			</section>
		</div>
	`
}

let fixtureMatchdays: WCFixtureMatchday[] = []

const initialMarkup = `
	<section class="fixture-controls">
		<input
			id="fixture-search"
			type="text"
			placeholder="Search by team, date, time, or score"
			aria-label="Search fixtures"
		/>
		<select id="fixture-country" aria-label="Filter fixtures by country">
			<option value="">All host countries</option>
			<option value="Mexico">Mexico 🇲🇽</option>
			<option value="USA">USA 🇺🇸</option>
			<option value="Canada">Canada 🇨🇦</option>
		</select>
	</section>
	<div id="fixture-results"></div>
`

renderPage('Fixtures', 'fixtures', initialMarkup)

const results = document.querySelector<HTMLDivElement>('#fixture-results')
const searchInput = document.querySelector<HTMLInputElement>('#fixture-search')
const countrySelect = document.querySelector<HTMLSelectElement>('#fixture-country')

function updateResults(): void {
	if (!results || !searchInput || !countrySelect) {
		return
	}

	results.innerHTML = renderFixturesAndResultsMarkup(searchInput.value, countrySelect.value)
}

if (results && searchInput && countrySelect) {
	searchInput.addEventListener('input', updateResults)
	countrySelect.addEventListener('change', updateResults)
	results.innerHTML = '<p class="empty-state">Loading fixtures...</p>'

	async function loadAndUpdateResults() {
		try {
			fixtureMatchdays = await getWCFixtureMatchdays()
			updateResults()
		} catch {
			if (results) {
				results.innerHTML = '<p class="empty-state">Unable to load fixtures right now.</p>'
			}
		}
	}

	loadAndUpdateResults()

}
