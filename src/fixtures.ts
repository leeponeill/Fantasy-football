import { renderPage } from './renderPage'
import {
	getFixtureMatchdays,
	getFixtureResults,
	type FixtureGame,
	type FixtureMatchday,
	type FixtureResult,
} from './fixturesData'
import { requireAuth } from './auth'

requireAuth()

const hostCitiesByCountry: Record<'Mexico' | 'USA' | 'Canada', string[]> = {
	Mexico: ['Guadalajara', 'Mexico City', 'Monterrey'],
	USA: [
		'Atlanta',
		'Boston',
		'Dallas',
		'Houston',
		'Kansas City',
		'Los Angeles',
		'Miami',
		'New York/New Jersey',
		'Philadelphia',
		'San Francisco Bay Area',
		'Seattle',
	],
	Canada: ['Toronto', 'Vancouver'],
}

function hashString(value: string): number {
	let hash = 0
	for (let index = 0; index < value.length; index += 1) {
		hash = (hash * 31 + value.charCodeAt(index)) >>> 0
	}

	return hash
}

function getHostCityForGame(game: FixtureGame): string {
	if (!game.country) {
		return ''
	}

	const cityPool = hostCitiesByCountry[game.country]
	const seed = `${game.date}|${game.time}|${game.match}|${game.country}`
	const cityIndex = hashString(seed) % cityPool.length
	return cityPool[cityIndex]
}

const teamFlags: Record<string, string> = {
	Algeria: '🇩🇿',
	Argentina: '🇦🇷',
	Australia: '🇦🇺',
	Austria: '🇦🇹',
	Belgium: '🇧🇪',
	'Bosnia & Herzegovina': '🇧🇦',
	Brazil: '🇧🇷',
	Canada: '🇨🇦',
	'Cape Verde': '🇨🇻',
	Colombia: '🇨🇴',
	Croatia: '🇭🇷',
	Curacao: '🇨🇼',
	'Czech Republic': '🇨🇿',
	'DR Congo': '🇨🇩',
	Ecuador: '🇪🇨',
	Egypt: '🇪🇬',
	England: '🏴',
	France: '🇫🇷',
	Germany: '🇩🇪',
	Ghana: '🇬🇭',
	Haiti: '🇭🇹',
	Iran: '🇮🇷',
	Iraq: '🇮🇶',
	'Ivory Coast': '🇨🇮',
	Japan: '🇯🇵',
	Jordan: '🇯🇴',
	Mexico: '🇲🇽',
	Morocco: '🇲🇦',
	Netherlands: '🇳🇱',
	'New Zealand': '🇳🇿',
	Norway: '🇳🇴',
	Panama: '🇵🇦',
	Paraguay: '🇵🇾',
	Portugal: '🇵🇹',
	Qatar: '🇶🇦',
	'Saudi Arabia': '🇸🇦',
	Scotland: '🏴',
	Senegal: '🇸🇳',
	'South Africa': '🇿🇦',
	'South Korea': '🇰🇷',
	Spain: '🇪🇸',
	Sweden: '🇸🇪',
	Switzerland: '🇨🇭',
	Tunisia: '🇹🇳',
	Turkey: '🇹🇷',
	Uruguay: '🇺🇾',
	USA: '🇺🇸',
	Uzbekistan: '🇺🇿',
}

function withTeamFlag(name: string): string {
	const flag = teamFlags[name]
	return flag ? `${flag} ${name}` : name
}

function formatMatch(match: string): string {
	if (!match.includes(' vs ')) {
		return match
	}

	const [left, right] = match.split(' vs ')
	return `${withTeamFlag(left)} vs ${withTeamFlag(right)}`
}

function getFixtureKey(game: FixtureGame): string {
	// Always use '' for missing or empty country
	const country = game.country || ''
	return `${game.date}|${game.time}|${country}|${game.match}`
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

function renderSectionMarkup(matchdays: Array<{ matchday: number; games: FixtureGame[] }>, section: 'fixtures' | 'results'): string {
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
						<h2>Matchday ${matchday.matchday}</h2>
						<ul class="fixture-list">
							${matchday.games
								.map(
									(game) => `
										<li class="fixture-item">
											<span class="fixture-date">${game.date}</span>
											<span class="fixture-time">${game.time}</span>
											<span class="fixture-match">${formatMatch(game.match)}</span>
											<span class="fixture-country">${getHostCityForGame(game) ? `Host city: ${getHostCityForGame(game)}` : ''}</span>
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

	const resultByKey = new Map<string, FixtureResult>()
	for (const result of fixtureResults) {
		const country = result.country ? result.country : ''
		resultByKey.set(`${result.date}|${result.time}|${country}|${result.match}`, result)
	}

	return matchdays
		.map(
			(matchday) => `
				<section class="fixture-matchday fixture-matchday--results">
					<h2>Matchday ${matchday.matchday}</h2>
					<ul class="fixture-list">
						${matchday.games
							.map((game) => {
								const result = resultByKey.get(getFixtureKey(game))
								const score = result ? `${result.homeScore} - ${result.awayScore}` : 'Score unavailable'

								return `
									<li class="fixture-item fixture-item--result">
										<span class="fixture-date">${game.date}</span>
										<span class="fixture-time">${game.time}</span>
										<span class="fixture-match">${formatMatch(game.match)}</span>
										<span class="fixture-score">${score}</span>
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
	const resultByKey = new Map<string, FixtureResult>()
	for (const result of fixtureResults) {
		const country = result.country ? result.country : ''
		resultByKey.set(`${result.date}|${result.time}|${country}|${result.match}`, result)
	}

	const upcomingMatchdays: Array<{ matchday: number; games: FixtureGame[] }> = []
	const pastMatchdays: Array<{ matchday: number; games: FixtureGame[] }> = []

	for (const matchday of fixtureMatchdays) {
		const upcomingGames: FixtureGame[] = []
		const pastGames: FixtureGame[] = []

		for (const game of matchday.games) {
			const result = resultByKey.get(getFixtureKey(game))
			const scoreText = result ? `${result.homeScore} ${result.awayScore}` : ''
			const countryMatches = selectedCountry === '' || game.country === selectedCountry
			const countryText = (game.country ?? '').toLowerCase()
			const textMatches =
				query === '' ||
				game.date.toLowerCase().includes(query) ||
				game.match.toLowerCase().includes(query) ||
				game.time.toLowerCase().includes(query) ||
				countryText.includes(query) ||
				scoreText.toLowerCase().includes(query)

			if (!(countryMatches && textMatches)) {
				continue
			}

			const kickoff = parseFixtureKickoff(game, now)
			if (kickoff && kickoff.getTime() < now.getTime()) {
				pastGames.push(game)
			} else {
				upcomingGames.push(game)
			}
		}

		if (upcomingGames.length > 0) {
			upcomingMatchdays.push({
				matchday: matchday.matchday,
				games: upcomingGames,
			})
		}

		if (pastGames.length > 0) {
			pastMatchdays.push({
				matchday: matchday.matchday,
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
				const ta = parseFixtureKickoff(a, now)?.getTime() ?? 0
				const tb = parseFixtureKickoff(b, now)?.getTime() ?? 0
				return tb - ta
			}),
		}))
	// Fixtures: chronological (lowest matchday first), games by kickoff ascending
	const sortedUpcomingMatchdays = [...upcomingMatchdays]
		.sort((a, b) => a.matchday - b.matchday)
		.map((md) => ({
			...md,
			games: [...md.games].sort((a, b) => {
				const ta = parseFixtureKickoff(a, now)?.getTime() ?? Number.MAX_SAFE_INTEGER
				const tb = parseFixtureKickoff(b, now)?.getTime() ?? Number.MAX_SAFE_INTEGER
				return ta - tb
			}),
		}))

	return `
		<div class="fixtures-results-columns">
			<section class="fixture-section">
				<h2>Results</h2>
				${renderSectionMarkup(sortedPastMatchdays, 'results')}
			</section>
			<section class="fixture-section">
				<h2>Fixtures</h2>
				${renderSectionMarkup(sortedUpcomingMatchdays, 'fixtures')}
			</section>
		</div>
	`
}

let fixtureMatchdays: FixtureMatchday[] = []
let fixtureResults: FixtureResult[] = []

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
			const [loadedMatchdays, loadedResults] = await Promise.all([
				getFixtureMatchdays(),
				getFixtureResults().catch(() => [] as FixtureResult[]),
			])
			fixtureMatchdays = loadedMatchdays
			fixtureResults = loadedResults
			updateResults()
		} catch {
			if (results) {
				results.innerHTML = '<p class="empty-state">Unable to load fixtures right now.</p>'
			}
		}
	}

	loadAndUpdateResults()

	// Poll for new results every 10 seconds
	setInterval(() => {
		getFixtureResults()
			.then((loadedResults) => {
				fixtureResults = loadedResults
				updateResults()
			})
			.catch(() => {/* ignore errors during polling */})
	}, 10000)
}
