import { renderPage } from './renderPage'
import { getFixtureMatchdays, type FixtureGame, type FixtureMatchday } from './fixturesData'
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

function renderMatchdaysMarkup(searchText: string, selectedCountry: string): string {
	const query = searchText.trim().toLowerCase()

	const filteredMatchdays = fixtureMatchdays
		.map((matchday) => {
			const games = matchday.games.filter((game) => {
				const countryMatches = selectedCountry === '' || game.country === selectedCountry
				const textMatches =
					query === '' ||
					game.date.toLowerCase().includes(query) ||
					game.match.toLowerCase().includes(query) ||
					game.time.toLowerCase().includes(query) ||
					game.country.toLowerCase().includes(query)

				return countryMatches && textMatches
			})

			return {
				matchday: matchday.matchday,
				games,
			}
		})
		.filter((matchday) => matchday.games.length > 0)

	if (filteredMatchdays.length === 0) {
		return '<p class="empty-state">No fixtures match your filter.</p>'
	}

	return filteredMatchdays
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
										<span class="fixture-country">Host city: ${getHostCityForGame(game)}</span>
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

let fixtureMatchdays: FixtureMatchday[] = []

const initialMarkup = `
	<section class="fixture-controls">
		<input
			id="fixture-search"
			type="text"
			placeholder="Search by team, date, or time"
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

	results.innerHTML = renderMatchdaysMarkup(searchInput.value, countrySelect.value)
}

if (results && searchInput && countrySelect) {
	searchInput.addEventListener('input', updateResults)
	countrySelect.addEventListener('change', updateResults)
	results.innerHTML = '<p class="empty-state">Loading fixtures...</p>'
	void getFixtureMatchdays()
		.then((loadedMatchdays) => {
			fixtureMatchdays = loadedMatchdays
			updateResults()
		})
		.catch(() => {
			results.innerHTML = '<p class="empty-state">Unable to load fixtures right now.</p>'
		})
}
