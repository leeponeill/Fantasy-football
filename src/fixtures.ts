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

function normalizeTeamToken(value: string): string {
	const aliases: Record<string, string> = {
		mex: 'mexico',
		rsa: 'southafrica',
		kor: 'southkorea',
		cze: 'czechia',
		can: 'canada',
		bih: 'bosniaandherzegovina',
		par: 'paraguay',
		qat: 'qatar',
		sui: 'switzerland',
		bra: 'brazil',
		mar: 'morocco',
		hai: 'haiti',
		sco: 'scotland',
		aus: 'australia',
		tur: 'turkiye',
		ger: 'germany',
		cuw: 'curacao',
		ned: 'netherlands',
		jpn: 'japan',
		civ: 'cotedivoire',
		ecu: 'ecuador',
		swe: 'sweden',
		tun: 'tunisia',
		esp: 'spain',
		cpv: 'caboverde',
		bel: 'belgium',
		egy: 'egypt',
		ksa: 'saudiarabia',
		uru: 'uruguay',
		irn: 'iran',
		nzl: 'newzealand',
		fra: 'france',
		sen: 'senegal',
		irq: 'iraq',
		nor: 'norway',
		arg: 'argentina',
		alg: 'algeria',
		aut: 'austria',
		jor: 'jordan',
		por: 'portugal',
		cod: 'congodr',
		eng: 'england',
		cro: 'croatia',
		gha: 'ghana',
		pan: 'panama',
		uzb: 'uzbekistan',
		col: 'colombia',
		korearepublic: 'southkorea',
		republicofkorea: 'southkorea',
		southkorea: 'southkorea',
		czechrepublic: 'czechia',
		czecrepublic: 'czechia',
		unitedstates: 'usa',
		unitedstatesofamerica: 'usa',
		us: 'usa',
		canadanationalteam: 'canada',
		bosniaherzigovina: 'bosniaandherzegovina',
		bosniaandherzigovina: 'bosniaandherzegovina',
		bozniaherzigovina: 'bosniaandherzegovina',
		bozniaandherzigovina: 'bosniaandherzegovina',
		bozniaherzegovina: 'bosniaandherzegovina',
		bozniaandherzegovina: 'bosniaandherzegovina',
		boznia: 'bosniaandherzegovina',
		iriran: 'iran',
		islamicrepublicofiran: 'iran',
		turkey: 'turkiye',
		turquie: 'turkiye',
		ivorycoast: 'cotedivoire',
		coteivoire: 'cotedivoire',
		capeverde: 'caboverde',
		drcongo: 'congodr',
		democraticrepublicofcongo: 'congodr',
		democraticrepublicofthecongo: 'congodr',
		republicofthecongo: 'congodr',
		bosniaherzegovina: 'bosniaandherzegovina',
		bosniaandherzegovia: 'bosniaandherzegovina',
		bosnia: 'bosniaandherzegovina',
	}

	const base = value
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '')

	const withoutNationalTeam = base.endsWith('nationalteam')
		? base.slice(0, -'nationalteam'.length)
		: base
	const withoutMensSuffix = withoutNationalTeam.endsWith('mens')
		? withoutNationalTeam.slice(0, -'mens'.length)
		: withoutNationalTeam
	const withoutWomensSuffix = withoutMensSuffix.endsWith('womens')
		? withoutMensSuffix.slice(0, -'womens'.length)
		: withoutMensSuffix

	return aliases[base] ?? aliases[withoutNationalTeam] ?? aliases[withoutMensSuffix] ?? aliases[withoutWomensSuffix] ?? withoutWomensSuffix
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
								const wcGame = game as WCFixtureGame
								const homeScore = typeof wcGame.homeScore === 'string' ? wcGame.homeScore.trim() : ''
								const awayScore = typeof wcGame.awayScore === 'string' ? wcGame.awayScore.trim() : ''
								const hasScore = /^\d+$/.test(homeScore) && /^\d+$/.test(awayScore)
								const teams = game.match.split(' vs ')
								const homeTeam = teams[0]?.trim() ?? ''
								const awayTeam = teams[1]?.trim() ?? ''
								const scorelineMarkup = hasScore && homeTeam && awayTeam
									? `
										<span class="fixture-scoreline-main">
											<span class="fixture-team fixture-team--home">${withTeamFlag(homeTeam)}</span>
											<span class="fixture-score-center"><strong class="fixture-score-number">${homeScore}</strong> <span class="fixture-score-separator">-</span> <strong class="fixture-score-number">${awayScore}</strong></span>
											<span class="fixture-team fixture-team--away">${withTeamFlag(awayTeam)}</span>
										</span>
									`
									: `${formatMatch(game.match)}${hasScore ? ` <strong>${homeScore}-${awayScore}</strong>` : ''}`
								const scorerRows = Array.isArray(wcGame.scorers)
									? wcGame.scorers
										.filter((row) => row && typeof row.player === 'string')
										.map((row) => {
											const player = row.player.trim()
											const minute = typeof row.minute === 'string' ? row.minute.trim() : ''
											const team = typeof row.team === 'string' ? row.team.trim() : ''
											if (!player) {
												return null
											}

											return { player, minute, team }
										})
										.filter((value): value is { player: string; minute: string; team: string } => value !== null)
									: []
								const homeTeamToken = normalizeTeamToken(homeTeam)
								const awayTeamToken = normalizeTeamToken(awayTeam)
								const homeScorers = scorerRows.filter((row) => normalizeTeamToken(row.team) === homeTeamToken)
								const awayScorers = scorerRows.filter((row) => normalizeTeamToken(row.team) === awayTeamToken)
								const homeScorersMarkup = homeScorers
									.map((row) => `<span class="fixture-scorer-row">${row.player}${row.minute ? ` ${row.minute}'` : ''}</span>`)
									.join('')
								const awayScorersMarkup = awayScorers
									.map((row) => `<span class="fixture-scorer-row">${row.player}${row.minute ? ` ${row.minute}'` : ''}</span>`)
									.join('')
								const scorersMarkup = hasScore && (homeScorers.length > 0 || awayScorers.length > 0)
									? `
										<span class="fixture-scorers-grid">
											<span class="fixture-scorers-col fixture-scorers-col--home">${homeScorersMarkup}</span>
											<span class="fixture-scorers-col fixture-scorers-col--score" aria-hidden="true">${homeScore}-${awayScore}</span>
											<span class="fixture-scorers-col fixture-scorers-col--away">${awayScorersMarkup}</span>
										</span>
									`
									: ''
								return `
									<li class="fixture-item fixture-item--result">
										<span class="fixture-date">${game.date}</span>
										<span class="fixture-time">${game.time}</span>
										<span class="fixture-match fixture-match--result"><span class="fixture-scoreline">${scorelineMarkup}</span>${scorersMarkup}</span>
										<span class="fixture-country">${wcGame.stadium || ''}</span>
										${wcGame.group ? `<span class="fixture-group">${wcGame.group}</span>` : ''}
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

type FixtureView = 'fixtures' | 'results' | 'groups'

function isMobileViewport(): boolean {
	return window.matchMedia('(max-width: 720px)').matches
}

function renderGroupsTableMarkup(): string {
	type GroupStandingRow = {
		team: string
		played: number
		wins: number
		draws: number
		losses: number
		goalsFor: number
		goalsAgainst: number
		points: number
		form: string[]
	}

	type ParsedResult = {
		homeTeam: string
		awayTeam: string
		homeScore: number
		awayScore: number
		homeYellowCards: number
		awayYellowCards: number
		homeRedCards: number
		awayRedCards: number
	}

	type TiebreakMetrics = {
		points: number
		goalDifference: number
		goalsFor: number
	}

	function parseResultFromGame(game: WCFixtureGame): ParsedResult | null {
		const homeScoreText = typeof game.homeScore === 'string' ? game.homeScore.trim() : ''
		const awayScoreText = typeof game.awayScore === 'string' ? game.awayScore.trim() : ''

		if (/^\d+$/.test(homeScoreText) && /^\d+$/.test(awayScoreText)) {
			const teams = extractFixtureTeams(game.match)
			if (!teams) {
				return null
			}

			const homeYellowCards = Number.isFinite(game.homeYellowCards) ? Math.max(0, Math.floor(game.homeYellowCards ?? 0)) : 0
			const awayYellowCards = Number.isFinite(game.awayYellowCards) ? Math.max(0, Math.floor(game.awayYellowCards ?? 0)) : 0
			const homeRedCards = Number.isFinite(game.homeRedCards) ? Math.max(0, Math.floor(game.homeRedCards ?? 0)) : 0
			const awayRedCards = Number.isFinite(game.awayRedCards) ? Math.max(0, Math.floor(game.awayRedCards ?? 0)) : 0

			return {
				homeTeam: teams[0],
				awayTeam: teams[1],
				homeScore: Number.parseInt(homeScoreText, 10),
				awayScore: Number.parseInt(awayScoreText, 10),
				homeYellowCards,
				awayYellowCards,
				homeRedCards,
				awayRedCards,
			}
		}

		return null
	}

	function extractFixtureTeams(match: string): [string, string] | null {
		const parts = match.split(' vs ')
		if (parts.length === 2) {
			return [parts[0].trim(), parts[1].trim()]
		}

		return null
	}

	function isGroupStageGame(game: WCFixtureGame): boolean {
		return 'group' in game && !!game.group
	}

	function createEmptyRow(team: string): GroupStandingRow {
		return {
			team,
			played: 0,
			wins: 0,
			draws: 0,
			losses: 0,
			goalsFor: 0,
			goalsAgainst: 0,
			points: 0,
			form: [],
		}
	}

	function buildHeadToHeadMetrics(tiedTeams: Set<string>, results: ParsedResult[]): Map<string, TiebreakMetrics> {
		const metrics = new Map<string, TiebreakMetrics>()
		for (const team of tiedTeams) {
			metrics.set(team, { points: 0, goalDifference: 0, goalsFor: 0 })
		}

		for (const result of results) {
			if (!tiedTeams.has(result.homeTeam) || !tiedTeams.has(result.awayTeam)) {
				continue
			}

			const homeMetrics = metrics.get(result.homeTeam)
			const awayMetrics = metrics.get(result.awayTeam)
			if (!homeMetrics || !awayMetrics) {
				continue
			}

			homeMetrics.goalsFor += result.homeScore
			homeMetrics.goalDifference += result.homeScore - result.awayScore
			awayMetrics.goalsFor += result.awayScore
			awayMetrics.goalDifference += result.awayScore - result.homeScore

			if (result.homeScore > result.awayScore) {
				homeMetrics.points += 3
			} else if (result.homeScore < result.awayScore) {
				awayMetrics.points += 3
			} else {
				homeMetrics.points += 1
				awayMetrics.points += 1
			}
		}

		return metrics
	}

	function getTeamConductScore(team: string, results: ParsedResult[]): number {
		let yellowCards = 0
		let redCards = 0

		for (const result of results) {
			if (result.homeTeam === team) {
				yellowCards += result.homeYellowCards
				redCards += result.homeRedCards
			}
			if (result.awayTeam === team) {
				yellowCards += result.awayYellowCards
				redCards += result.awayRedCards
			}
		}

		// Higher score is better: fewer cards leads to less negative score.
		return (yellowCards * -1) + (redCards * -3)
	}

	function rankRowsByCompetitionTiebreakers(rows: GroupStandingRow[], results: ParsedResult[]): GroupStandingRow[] {
		const byPoints = new Map<number, GroupStandingRow[]>()
		for (const row of rows) {
			const bucket = byPoints.get(row.points) ?? []
			bucket.push(row)
			byPoints.set(row.points, bucket)
		}

		const sortedPointValues = Array.from(byPoints.keys()).sort((a, b) => b - a)
		const ranked: GroupStandingRow[] = []

		for (const pointsValue of sortedPointValues) {
			const tiedRows = byPoints.get(pointsValue) ?? []
			if (tiedRows.length <= 1) {
				ranked.push(...tiedRows)
				continue
			}

			const tiedTeams = new Set(tiedRows.map((row) => row.team))
			const headToHead = buildHeadToHeadMetrics(tiedTeams, results)

			const ordered = [...tiedRows].sort((a, b) => {
				const aH2H = headToHead.get(a.team) ?? { points: 0, goalDifference: 0, goalsFor: 0 }
				const bH2H = headToHead.get(b.team) ?? { points: 0, goalDifference: 0, goalsFor: 0 }

				// Step one: head-to-head points, head-to-head GD, head-to-head goals scored.
				if (bH2H.points !== aH2H.points) {
					return bH2H.points - aH2H.points
				}
				if (bH2H.goalDifference !== aH2H.goalDifference) {
					return bH2H.goalDifference - aH2H.goalDifference
				}
				if (bH2H.goalsFor !== aH2H.goalsFor) {
					return bH2H.goalsFor - aH2H.goalsFor
				}

				// Step two: overall GD, overall goals scored, then conduct score.
				const aOverallGD = a.goalsFor - a.goalsAgainst
				const bOverallGD = b.goalsFor - b.goalsAgainst
				if (bOverallGD !== aOverallGD) {
					return bOverallGD - aOverallGD
				}
				if (b.goalsFor !== a.goalsFor) {
					return b.goalsFor - a.goalsFor
				}

				const aConductScore = getTeamConductScore(a.team, results)
				const bConductScore = getTeamConductScore(b.team, results)
				if (bConductScore !== aConductScore) {
					return bConductScore - aConductScore
				}

				return a.team.localeCompare(b.team)
			})

			ranked.push(...ordered)
		}

		return ranked
	}

	const groupTeams = new Map<string, Set<string>>()
	const standingsByGroup = new Map<string, Map<string, GroupStandingRow>>()
	const groupResults = new Map<string, ParsedResult[]>()
	const now = new Date()

	for (const matchday of fixtureMatchdays) {
		for (const game of matchday.games) {
			if (!isGroupStageGame(game)) {
				continue
			}

			const teams = extractFixtureTeams(game.match)
			if (!teams) {
				continue
			}

			const groupName = game.group.trim()
			if (!groupTeams.has(groupName)) {
				groupTeams.set(groupName, new Set<string>())
			}
			if (!standingsByGroup.has(groupName)) {
				standingsByGroup.set(groupName, new Map<string, GroupStandingRow>())
			}
			if (!groupResults.has(groupName)) {
				groupResults.set(groupName, [])
			}

			groupTeams.get(groupName)?.add(teams[0])
			groupTeams.get(groupName)?.add(teams[1])

			const groupStandings = standingsByGroup.get(groupName)
			if (!groupStandings) {
				continue
			}

			if (!groupStandings.has(teams[0])) {
				groupStandings.set(teams[0], createEmptyRow(teams[0]))
			}
			if (!groupStandings.has(teams[1])) {
				groupStandings.set(teams[1], createEmptyRow(teams[1]))
			}

			const kickoff = parseFixtureKickoff(game as unknown as FixtureGame, now)
			if (!kickoff || kickoff.getTime() > now.getTime()) {
				continue
			}

			const parsedResult = parseResultFromGame(game)
			if (!parsedResult) {
				continue
			}
			groupResults.get(groupName)?.push(parsedResult)

			const homeRow = groupStandings.get(parsedResult.homeTeam)
			const awayRow = groupStandings.get(parsedResult.awayTeam)
			if (!homeRow || !awayRow) {
				continue
			}

			homeRow.played += 1
			awayRow.played += 1
			homeRow.goalsFor += parsedResult.homeScore
			homeRow.goalsAgainst += parsedResult.awayScore
			awayRow.goalsFor += parsedResult.awayScore
			awayRow.goalsAgainst += parsedResult.homeScore

			if (parsedResult.homeScore > parsedResult.awayScore) {
				homeRow.wins += 1
				homeRow.points += 3
				homeRow.form.push('W')
				awayRow.losses += 1
				awayRow.form.push('L')
			} else if (parsedResult.homeScore < parsedResult.awayScore) {
				awayRow.wins += 1
				awayRow.points += 3
				awayRow.form.push('W')
				homeRow.losses += 1
				homeRow.form.push('L')
			} else {
				homeRow.draws += 1
				awayRow.draws += 1
				homeRow.points += 1
				awayRow.points += 1
				homeRow.form.push('D')
				awayRow.form.push('D')
			}
		}
	}

	const sortedGroups = Array.from(groupTeams.entries()).sort(([a], [b]) => a.localeCompare(b))
	if (sortedGroups.length === 0) {
		return '<p class="empty-state">No group data is available yet.</p>'
	}

	const mobile = isMobileViewport()

	return sortedGroups
		.map(([groupName, teams]) => {
			const isCompact = mobile
			const standings = standingsByGroup.get(groupName) ?? new Map<string, GroupStandingRow>()
			for (const team of teams) {
				if (!standings.has(team)) {
					standings.set(team, createEmptyRow(team))
				}
			}

			const sortedRows = rankRowsByCompetitionTiebreakers(
				Array.from(standings.values()),
				groupResults.get(groupName) ?? [],
			)

			const rows = sortedRows
				.map(
					(row, index) => {
						const recentForm = row.form.slice(-5)
						const paddedForm = [...recentForm, ...Array.from({ length: Math.max(0, 5 - recentForm.length) }, () => '-')]
						const formHtml = paddedForm
							.map((r) => {
								const cls = r === 'W' ? 'form-w' : r === 'L' ? 'form-l' : r === 'D' ? 'form-d' : 'form-blank'
								return `<span class="${cls}">${r}</span>`
							})
							.join('')
						return `
						<tr>
							<td>${index + 1}</td>
							<td>${withTeamFlag(row.team)}</td>
							<td>${row.played}</td>
							<td>${row.wins}</td>
							<td>${row.draws}</td>
							<td>${row.losses}</td>
							<td>${row.goalsFor}</td>
							<td>${row.goalsAgainst}</td>
							<td>${row.goalsFor - row.goalsAgainst}</td>
							<td>${row.points}</td>
							<td class="group-form">${formHtml}</td>
						</tr>
						`
					},
				)
				.join('')

			return `
				<section class="fixture-matchday fixture-matchday--groups">
					<h2>Standings - ${groupName}</h2>
					<div class="history-table-wrap">
						<table class="history-table groups-table${isCompact ? ' groups-table--compact' : ''}">
							<colgroup>
								<col class="col-rank">
								<col class="col-team">
								<col class="col-stat">
								<col class="col-stat">
								<col class="col-stat">
								<col class="col-stat">
								<col class="col-stat">
								<col class="col-stat">
								<col class="col-stat">
								<col class="col-stat">
								<col class="col-form">
							</colgroup>
							<thead>
								<tr>
									<th>#</th>
									<th>Team</th>
									<th>P</th>
									<th>W</th>
									<th>D</th>
									<th>L</th>
									<th>GF</th>
									<th>GA</th>
									<th>GD</th>
									<th>Pts</th>
									<th>Form</th>
								</tr>
							</thead>
							<tbody>${rows}</tbody>
						</table>
					</div>
				</section>
			`
		})
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

	const activeSection = activeFixtureView === 'results'
		? `
			<section class="fixture-section">
				<h2>Results</h2>
				${renderWCSectionMarkup(sortedPastMatchdays, 'results')}
			</section>
		`
		: `
			<section class="fixture-section">
				<h2>Fixtures</h2>
				${renderWCSectionMarkup(sortedUpcomingMatchdays, 'fixtures')}
			</section>
		`

	return `
		<div class="fixtures-results-view">
			${activeSection}
		</div>
	`
}

let fixtureMatchdays: WCFixtureMatchday[] = []
let activeFixtureView: FixtureView = 'results'

const initialMarkup = `
	<div class="fixtures-results-columns">
		<div class="fixtures-view-switch" role="tablist" aria-label="Toggle fixtures, results, and groups views">
			<button
				type="button"
				class="fixtures-view-btn is-active"
				data-view="results"
				role="tab"
				aria-selected="true"
			>
				Results
			</button>
			<button
				type="button"
				class="fixtures-view-btn"
				data-view="fixtures"
				role="tab"
				aria-selected="false"
			>
				Fixtures
			</button>
			<button
				type="button"
				class="fixtures-view-btn"
				data-view="groups"
				role="tab"
				aria-selected="false"
			>
				Groups
			</button>
		</div>
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
	</div>
	<div id="fixture-results"></div>
`

renderPage('Fixtures', 'fixtures', initialMarkup)

const results = document.querySelector<HTMLDivElement>('#fixture-results')
const searchInput = document.querySelector<HTMLInputElement>('#fixture-search')
const countrySelect = document.querySelector<HTMLSelectElement>('#fixture-country')

function updateResults(): void {
	if (!results) {
		return
	}

	if (activeFixtureView === 'groups') {
		results.innerHTML = renderGroupsTableMarkup()
	} else {
		if (!searchInput || !countrySelect) {
			return
		}
		results.innerHTML = renderFixturesAndResultsMarkup(searchInput.value, countrySelect.value)
	}
}

if (results && searchInput && countrySelect) {
	searchInput.addEventListener('input', updateResults)
	countrySelect.addEventListener('change', updateResults)
	window.addEventListener('resize', () => {
		if (activeFixtureView === 'groups') {
			updateResults()
		}
	})
	
	// Set up view switching
	document.querySelectorAll<HTMLButtonElement>('.fixtures-view-btn').forEach((button) => {
		button.addEventListener('click', () => {
			const selectedView = button.getAttribute('data-view') as FixtureView
			if (selectedView === activeFixtureView) {
				return
			}

			activeFixtureView = selectedView

			// Update button states
			document.querySelectorAll<HTMLButtonElement>('.fixtures-view-btn').forEach((btn) => {
				btn.classList.toggle('is-active', btn.getAttribute('data-view') === selectedView)
				btn.setAttribute('aria-selected', String(btn.getAttribute('data-view') === selectedView))
			})

			// Show/hide controls
			const controls = document.querySelector<HTMLElement>('.fixture-controls')
			if (controls) {
				controls.classList.toggle('fixture-controls--hidden', selectedView === 'groups')
			}

			updateResults()
		})
	})
	
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
