import { renderPage } from './renderPage'
import {
	type FixtureGame,
} from './fixturesData'
import {
	getWCFixtureGameweeks,
	type WCFixtureGame,
	type WCFixtureGameweek,
} from './fixturesData'
import { requireAuth } from './auth'
import { getTeamBadgeOrFlagHtml } from './teamsData'

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
	return `${getTeamBadgeOrFlagHtml(name, 'fixture-team-icon')} ${name}`
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
	const currentMonthIndex = now.getMonth()

	// Infer season year for dates that omit a year (Aug-May season model).
	// Jul-Dec belong to the season start year; Jan-Jun belong to season end year.
	const isSecondHalfOfSeasonMonth = monthIndex <= 5
	const isNowSecondHalfOfSeason = currentMonthIndex <= 5
	const seasonStartYear = isNowSecondHalfOfSeason ? currentYear - 1 : currentYear
	const inferredYear = isSecondHalfOfSeasonMonth ? seasonStartYear + 1 : seasonStartYear

	const kickoff = new Date(inferredYear, monthIndex, day, hour24, minute, 0, 0)

	return kickoff
}

function renderWCSectionMarkup(Gameweeks: WCFixtureGameweek[], section: 'fixtures' | 'results'): string {
	if (Gameweeks.length === 0) {
		return section === 'fixtures'
			? '<p class="empty-state">No upcoming fixtures match your filter.</p>'
			: '<p class="empty-state">No finished fixtures match your filter.</p>'
	}

	if (section === 'fixtures') {
		return Gameweeks
			.map(
				(Gameweek) => `
					<section class="fixture-Gameweek">
						<h2>${Gameweek.round || `Gameweek ${Gameweek.Gameweek}`}</h2>
						<ul class="fixture-list">
							${Gameweek.games
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

	return Gameweeks
		.map(
			(Gameweek) => `
				<section class="fixture-Gameweek fixture-Gameweek--results"> 
					<h2>${Gameweek.round || `Gameweek ${Gameweek.Gameweek}`}</h2>
					<ul class="fixture-list">
						${Gameweek.games
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
type GroupsSubView = 'standings' | 'third-place' | 'knockouts'

function isMobileViewport(): boolean {
	return window.matchMedia('(max-width: 720px)').matches
}

function renderGroupsTableMarkup(groupsSubView: GroupsSubView): string {
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

	type RoundOf32Pairing = [string, string]

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

	function renderFormMarkup(form: string[]): string {
		const recentForm = form.slice(-5)
		const paddedForm = [...recentForm, ...Array.from({ length: Math.max(0, 5 - recentForm.length) }, () => '-')]
		return paddedForm
			.map((result) => {
				const cls = result === 'W' ? 'form-w' : result === 'L' ? 'form-l' : result === 'D' ? 'form-d' : 'form-blank'
				return `<span class="${cls}">${result}</span>`
			})
			.join('')
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

	for (const Gameweek of fixtureGameweeks) {
		for (const game of Gameweek.games) {
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
	const groupSections: string[] = []
	const thirdPlaceRows: Array<{ groupName: string; row: GroupStandingRow; conductScore: number }> = []
	const groupQualifiers = new Map<string, { winner: string; runnerUp: string }>()

	for (const [groupName, teams] of sortedGroups) {
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

			const groupLetter = groupName.replace(/^Group\s+/i, '').trim().toUpperCase()
			if (sortedRows.length >= 2 && /^[A-L]$/.test(groupLetter)) {
				groupQualifiers.set(groupLetter, {
					winner: sortedRows[0].team,
					runnerUp: sortedRows[1].team,
				})
			}

			const rows = sortedRows
				.map(
					(row, index) => {
						const formHtml = renderFormMarkup(row.form)
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

			if (sortedRows.length >= 3) {
				const thirdRow = sortedRows[2]
				thirdPlaceRows.push({
					groupName,
					row: thirdRow,
					conductScore: getTeamConductScore(thirdRow.team, groupResults.get(groupName) ?? []),
				})
			}

			groupSections.push(`
				<section class="fixture-Gameweek fixture-Gameweek--groups">
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
			`)
	}

	function compareThirdPlaceRows(
		a: { groupName: string; row: GroupStandingRow; conductScore: number },
		b: { groupName: string; row: GroupStandingRow; conductScore: number },
	): number {
		const aPoints = Number(a.row.points) || 0
		const bPoints = Number(b.row.points) || 0
		if (bPoints !== aPoints) {
			return bPoints - aPoints
		}

		const aGoalDifference = (Number(a.row.goalsFor) || 0) - (Number(a.row.goalsAgainst) || 0)
		const bGoalDifference = (Number(b.row.goalsFor) || 0) - (Number(b.row.goalsAgainst) || 0)
		if (bGoalDifference !== aGoalDifference) {
			return bGoalDifference - aGoalDifference
		}

		const aGoalsFor = Number(a.row.goalsFor) || 0
		const bGoalsFor = Number(b.row.goalsFor) || 0
		if (bGoalsFor !== aGoalsFor) {
			return bGoalsFor - aGoalsFor
		}

		if (b.conductScore !== a.conductScore) {
			return b.conductScore - a.conductScore
		}

		const byTeamName = a.row.team.localeCompare(b.row.team)
		if (byTeamName !== 0) {
			return byTeamName
		}

		return a.groupName.localeCompare(b.groupName)
	}

	const sortedThirdPlaceRows = [...thirdPlaceRows].sort(compareThirdPlaceRows)

	function renderKnockoutBracketMarkup(): string {
		const knockoutFixturesByMatch = new Map<string, WCFixtureGame>()
		for (const Gameweek of fixtureGameweeks) {
			for (const game of Gameweek.games) {
				if (game.group) {
					continue
				}

				const roundText = `${Gameweek.round} ${game.round}`.toLowerCase()
				if (!['round of 32', 'round of 16', 'quarter', 'semi', 'final', 'third'].some((token) => roundText.includes(token))) {
					continue
				}

				knockoutFixturesByMatch.set(game.match, game)
			}
		}

		const roundOf32Matches = [
			{ winnerCode: 'W32-1', fixtureTemplate: '1E vs 3ABCDF', pairing: ['1E', '3ABCDF'] as RoundOf32Pairing },
			{ winnerCode: 'W32-2', fixtureTemplate: '1I vs 3CDFGH', pairing: ['1I', '3CDFGH'] as RoundOf32Pairing },
			{ winnerCode: 'W32-3', fixtureTemplate: '2A vs 2B', pairing: ['2A', '2B'] as RoundOf32Pairing },
			{ winnerCode: 'W32-4', fixtureTemplate: '1F vs 2C', pairing: ['1F', '2C'] as RoundOf32Pairing },
			{ winnerCode: 'W32-5', fixtureTemplate: '2K vs 2L', pairing: ['2K', '2L'] as RoundOf32Pairing },
			{ winnerCode: 'W32-6', fixtureTemplate: '1H vs 2J', pairing: ['1H', '2J'] as RoundOf32Pairing },
			{ winnerCode: 'W32-7', fixtureTemplate: '1D vs 3BEFIJ', pairing: ['1D', '3BEFIJ'] as RoundOf32Pairing },
			{ winnerCode: 'W32-8', fixtureTemplate: '1G vs 3AEHIJ', pairing: ['1G', '3AEHIJ'] as RoundOf32Pairing },
			{ winnerCode: 'W32-9', fixtureTemplate: '1C vs 2F', pairing: ['1C', '2F'] as RoundOf32Pairing },
			{ winnerCode: 'W32-10', fixtureTemplate: '2E vs 2I', pairing: ['2E', '2I'] as RoundOf32Pairing },
			{ winnerCode: 'W32-11', fixtureTemplate: '1A vs 3CEFHI', pairing: ['1A', '3CEFHI'] as RoundOf32Pairing },
			{ winnerCode: 'W32-12', fixtureTemplate: '1L vs 3EHIJK', pairing: ['1L', '3EHIJK'] as RoundOf32Pairing },
			{ winnerCode: 'W32-13', fixtureTemplate: '1J vs 2H', pairing: ['1J', '2H'] as RoundOf32Pairing },
			{ winnerCode: 'W32-14', fixtureTemplate: '2D vs 2G', pairing: ['2D', '2G'] as RoundOf32Pairing },
			{ winnerCode: 'W32-15', fixtureTemplate: '1B vs 3EFGIJ', pairing: ['1B', '3EFGIJ'] as RoundOf32Pairing },
			{ winnerCode: 'W32-16', fixtureTemplate: '1K vs 3DEIJL', pairing: ['1K', '3DEIJL'] as RoundOf32Pairing },
		]

		const thirdPreferenceByCode: Record<string, string[]> = {
			'3ABCDF': ['D', 'F', 'A', 'B', 'C'],
			'3CDFGH': ['F', 'D', 'C', 'G', 'H'],
		}

		const qualifiedThirdTeams = sortedThirdPlaceRows
			.slice(0, 8)
			.map(({ groupName, row }, index) => ({
				groupLetter: groupName.replace(/^Group\s+/i, '').trim().toUpperCase(),
				team: row.team,
				rank: index + 1,
			}))
			.filter(({ groupLetter }) => /^[A-L]$/.test(groupLetter))

		const thirdTeamByLetter = new Map<string, string>()
		const thirdRankByLetter = new Map<string, number>()
		for (const entry of qualifiedThirdTeams) {
			thirdTeamByLetter.set(entry.groupLetter, entry.team)
			thirdRankByLetter.set(entry.groupLetter, entry.rank)
		}

		const thirdCodes = Array.from(
			new Set(
				roundOf32Matches
					.flatMap((match) => match.pairing)
					.filter((seed) => /^3[A-L]{3,6}$/.test(seed)),
			),
		)

		let bestThirdAssignment: Record<string, string> | null = null
		let bestScore = Number.POSITIVE_INFINITY

		function assignmentScore(code: string, letter: string): number {
			const preferred = thirdPreferenceByCode[code] ?? []
			const preferenceIndex = preferred.indexOf(letter)
			const preferenceScore = preferenceIndex === -1 ? 50 : preferenceIndex
			const rankScore = thirdRankByLetter.get(letter) ?? 99
			return (preferenceScore * 100) + rankScore
		}

		function assignThirdCodes(
			index: number,
			usedLetters: Set<string>,
			current: Record<string, string>,
			score: number,
		): void {
			if (index === thirdCodes.length) {
				if (score < bestScore) {
					bestScore = score
					bestThirdAssignment = { ...current }
				}
				return
			}

			const code = thirdCodes[index]
			const candidates = code
				.slice(1)
				.split('')
				.filter((letter) => thirdTeamByLetter.has(letter) && !usedLetters.has(letter))
				.sort((a, b) => assignmentScore(code, a) - assignmentScore(code, b))

			for (const letter of candidates) {
				const nextScore = score + assignmentScore(code, letter)
				if (nextScore >= bestScore) {
					continue
				}

				usedLetters.add(letter)
				current[code] = letter
				assignThirdCodes(index + 1, usedLetters, current, nextScore)
				usedLetters.delete(letter)
				delete current[code]
			}
		}

		assignThirdCodes(0, new Set<string>(), {}, 0)

		function resolveSeed(seed: string): string {
			const winnerMatch = /^1([A-L])$/.exec(seed)
			if (winnerMatch) {
				return groupQualifiers.get(winnerMatch[1])?.winner ?? seed
			}

			const runnerMatch = /^2([A-L])$/.exec(seed)
			if (runnerMatch) {
				return groupQualifiers.get(runnerMatch[1])?.runnerUp ?? seed
			}

			if (/^3[A-L]{3,6}$/.test(seed)) {
				const assignedLetter = bestThirdAssignment?.[seed]
				if (!assignedLetter) {
					return seed
				}

				return thirdTeamByLetter.get(assignedLetter) ?? seed
			}

			return seed
		}

		function renderTeamSlot(seed: string): string {
			const resolvedTeam = resolveSeed(seed)
			if (resolvedTeam === seed) {
				return `<div class="knockout-team knockout-team--placeholder">${seed}</div>`
			}

			return `<div class="knockout-team">${withTeamFlag(resolvedTeam)}</div>`
		}

		function renderScheduleMeta(matchTemplate: string): string {
			const fixture = knockoutFixturesByMatch.get(matchTemplate)
			if (!fixture) {
				return '<div class="knockout-match-meta knockout-match-meta--placeholder"></div>'
			}

			return `
				<div class="knockout-match-meta">
					<span class="knockout-match-meta-label">Scheduled</span>
					<span class="knockout-match-meta-time">${fixture.time}</span>
					<span class="knockout-match-meta-date">${fixture.date}</span>
				</div>
			`
		}

		const roundOf32Markup = roundOf32Matches
			.map((match, index) => `
				<div class="knockout-match" aria-label="Round of 32 Match ${index + 1}">
					${renderScheduleMeta(match.fixtureTemplate)}
					${renderTeamSlot(match.pairing[0])}
					${renderTeamSlot(match.pairing[1])}
				</div>
			`)
			.join('')

		const laterRounds = [
			{
				title: 'Round of 16',
				className: 'knockout-round--last-16',
				matches: [
					{ fixtureTemplate: 'W73 vs W75', displayPair: ['W32-2', 'W32-5'] },
					{ fixtureTemplate: 'W74 vs W77', displayPair: ['W32-1', 'W32-3'] },
					{ fixtureTemplate: 'W79 vs W80', displayPair: ['W32-11', 'W32-12'] },
					{ fixtureTemplate: 'W81 vs W82', displayPair: ['W32-9', 'W32-10'] },
					{ fixtureTemplate: 'W76 vs W78', displayPair: ['W32-4', 'W32-6'] },
					{ fixtureTemplate: 'W83 vs W84', displayPair: ['W32-7', 'W32-8'] },
					{ fixtureTemplate: 'W86 vs W88', displayPair: ['W32-14', 'W32-16'] },
					{ fixtureTemplate: 'W85 vs W87', displayPair: ['W32-13', 'W32-15'] },
				],
			},
			{
				title: 'Quarter-finals',
				className: 'knockout-round--quarter-finals',
				matches: [
					{ fixtureTemplate: 'W89 vs W90', displayPair: ['W16-1', 'W16-2'] },
					{ fixtureTemplate: 'W91 vs W92', displayPair: ['W16-5', 'W16-6'] },
					{ fixtureTemplate: 'W93 vs W94', displayPair: ['W16-3', 'W16-4'] },
					{ fixtureTemplate: 'W95 vs W96', displayPair: ['W16-7', 'W16-8'] },
				],
			},
			{
				title: 'Semi-finals',
				className: 'knockout-round--semi-finals',
				matches: [
					{ fixtureTemplate: 'W97 vs W98', displayPair: ['WQF-1', 'WQF-2'] },
					{ fixtureTemplate: 'W99 vs W100', displayPair: ['WQF-3', 'WQF-4'] },
				],
			},
			{
				title: 'Final',
				className: 'knockout-round--final',
				matches: [
					{ fixtureTemplate: 'W101 vs W102', displayPair: ['WSF-1', 'WSF-2'] },
				],
			},
		]

		const laterRoundMarkup = laterRounds
			.map((round) => {
				const matchesMarkup = round.matches
					.map((match, index) => `
						<div class="knockout-match" aria-label="${round.title} Match ${index + 1}">
							${renderScheduleMeta(match.fixtureTemplate)}
							<div class="knockout-team knockout-team--placeholder">${match.displayPair[0]}</div>
							<div class="knockout-team knockout-team--placeholder">${match.displayPair[1]}</div>
						</div>
					`)
					.join('')

				return `
					<section class="knockout-round ${round.className}">
						<h3>${round.title}</h3>
						<div class="knockout-round-matches">${matchesMarkup}</div>
					</section>
				`
			})
			.join('')

		const roundsMarkup = `
			<section class="knockout-round knockout-round--round-of-32">
				<h3>Round of 32</h3>
				<div class="knockout-round-matches">${roundOf32Markup}</div>
			</section>
			${laterRoundMarkup}
		`

		return `
			<section class="fixture-Gameweek fixture-Gameweek--groups">
				<h2>Knockout Diagram</h2>
				<div class="knockout-bracket-wrap">
					<div class="knockout-bracket" aria-label="Knockout bracket from 32 teams to a final of 2 teams">
						${roundsMarkup}
					</div>
				</div>
			</section>
		`
	}

	const thirdRowsMarkup = sortedThirdPlaceRows
		.map(({ groupName, row }, index) => {
			const groupCellClass = index < 8
				? 'third-place-group third-place-group--qualified'
				: 'third-place-group third-place-group--eliminated'

			return `
			<tr>
				<td class="${groupCellClass}">${groupName.replace(/^Group\s+/i, '')}</td>
				<td>${withTeamFlag(row.team)}</td>
				<td>${row.played}</td>
				<td>${row.wins}</td>
				<td>${row.draws}</td>
				<td>${row.losses}</td>
				<td>${row.goalsFor}</td>
				<td>${row.goalsAgainst}</td>
				<td>${row.goalsFor - row.goalsAgainst}</td>
				<td>${row.points}</td>
				<td class="group-form">${renderFormMarkup(row.form)}</td>
			</tr>
		`
		})
		.join('')

	const thirdPlaceSection = thirdPlaceRows.length > 0
		? `
			<section class="fixture-Gameweek fixture-Gameweek--groups">
				<h2>Current 3rd-Place Teams</h2>
				<div class="history-table-wrap">
					<table class="history-table groups-table${mobile ? ' groups-table--compact' : ''}">
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
								<th>Grp</th>
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
						<tbody>${thirdRowsMarkup}</tbody>
					</table>
				</div>
			</section>
		`
		: ''

	if (groupsSubView === 'knockouts') {
		return renderKnockoutBracketMarkup()
	}

	if (groupsSubView === 'third-place') {
		return thirdPlaceSection || '<p class="empty-state">No 3rd-place teams are available yet.</p>'
	}

	return groupSections.join('')
}

function renderFixturesAndResultsMarkup(searchText: string, selectedCountry: string): string {
	const query = searchText.trim().toLowerCase()
	const now = new Date()
	const upcomingGameweeks: WCFixtureGameweek[] = []
	const pastGameweeks: WCFixtureGameweek[] = []

	for (const Gameweek of fixtureGameweeks) {
		const upcomingGames: WCFixtureGame[] = []
		const pastGames: WCFixtureGame[] = []

		for (const game of Gameweek.games) {
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
			upcomingGameweeks.push({
				Gameweek: Gameweek.Gameweek,
				round: Gameweek.round,
				games: upcomingGames,
			})
		}

		if (pastGames.length > 0) {
			pastGameweeks.push({
				Gameweek: Gameweek.Gameweek,
				round: Gameweek.round,
				games: pastGames,
			})
		}
	}

	// Results: reverse chronological — sort Gameweeks most recent first,
	// and within each Gameweek sort games most recent kickoff first
	const sortedPastGameweeks = [...pastGameweeks]
		.sort((a, b) => b.Gameweek - a.Gameweek)
		.map((md) => ({
			...md,
			games: [...md.games].sort((a, b) => {
				const ta = parseFixtureKickoff(a as unknown as FixtureGame, now)?.getTime() ?? 0
				const tb = parseFixtureKickoff(b as unknown as FixtureGame, now)?.getTime() ?? 0
				return tb - ta
			}),
		}))
	// Fixtures: chronological (lowest Gameweek first), games by kickoff ascending
	const sortedUpcomingGameweeks = [...upcomingGameweeks]
		.sort((a, b) => a.Gameweek - b.Gameweek)
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
				${renderWCSectionMarkup(sortedPastGameweeks, 'results')}
			</section>
		`
		: `
			<section class="fixture-section">
				<h2>Fixtures</h2>
				${renderWCSectionMarkup(sortedUpcomingGameweeks, 'fixtures')}
			</section>
		`

	return `
		<div class="fixtures-results-view">
			${activeSection}
		</div>
	`
}

let fixtureGameweeks: WCFixtureGameweek[] = []
let activeFixtureView: FixtureView = 'results'
let activeGroupsSubView: GroupsSubView = 'standings'

const initialMarkup = `
	<div class="fixtures-results-columns">
		<div class="fixtures-view-switch" data-switch="main" role="tablist" aria-label="Toggle fixtures, results, and groups views">
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
		<div class="fixtures-view-switch fixture-controls--hidden" data-switch="groups" role="tablist" aria-label="Toggle groups pages">
			<button
				type="button"
				class="groups-view-btn is-active"
				data-groups-view="standings"
				role="tab"
				aria-selected="true"
			>
				Group Standings
			</button>
			<button
				type="button"
				class="groups-view-btn"
				data-groups-view="third-place"
				role="tab"
				aria-selected="false"
			>
				3rd-Place Page
			</button>
			<button
				type="button"
				class="groups-view-btn"
				data-groups-view="knockouts"
				role="tab"
				aria-selected="false"
			>
				Knockouts
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
		results.innerHTML = renderGroupsTableMarkup(activeGroupsSubView)
	} else {
		if (!searchInput || !countrySelect) {
			return
		}
		results.innerHTML = renderFixturesAndResultsMarkup(searchInput.value, countrySelect.value)
	}
}

function syncFixtureControlVisibility(): void {
	const controls = document.querySelector<HTMLElement>('.fixture-controls')
	const groupsSwitch = document.querySelector<HTMLElement>('.fixtures-view-switch[data-switch="groups"]')

	if (controls) {
		controls.classList.toggle('fixture-controls--hidden', activeFixtureView === 'groups')
	}

	if (groupsSwitch) {
		groupsSwitch.classList.toggle('fixture-controls--hidden', activeFixtureView !== 'groups')
	}
}

if (results && searchInput && countrySelect) {
	searchInput.addEventListener('input', updateResults)
	countrySelect.addEventListener('change', updateResults)
	syncFixtureControlVisibility()
	window.addEventListener('resize', () => {
		if (activeFixtureView === 'groups') {
			updateResults()
		}
	})
	
	// Set up main view switching
	document.querySelectorAll<HTMLButtonElement>('.fixtures-view-switch[data-switch="main"] .fixtures-view-btn').forEach((button) => {
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
			syncFixtureControlVisibility()

			updateResults()
		})
	})

	// Set up groups sub-view switching
	document.querySelectorAll<HTMLButtonElement>('.groups-view-btn').forEach((button) => {
		button.addEventListener('click', () => {
			const selectedView = button.getAttribute('data-groups-view') as GroupsSubView
			if (selectedView === activeGroupsSubView) {
				return
			}

			activeGroupsSubView = selectedView

			document.querySelectorAll<HTMLButtonElement>('.groups-view-btn').forEach((btn) => {
				btn.classList.toggle('is-active', btn.getAttribute('data-groups-view') === selectedView)
				btn.setAttribute('aria-selected', String(btn.getAttribute('data-groups-view') === selectedView))
			})

			if (activeFixtureView === 'groups') {
				updateResults()
			}
		})
	})
	
	results.innerHTML = '<p class="empty-state">Loading fixtures...</p>'

	async function loadAndUpdateResults() {
		try {
			fixtureGameweeks = await getWCFixtureGameweeks()
			updateResults()
		} catch {
			if (results) {
				results.innerHTML = '<p class="empty-state">Unable to load fixtures right now.</p>'
			}
		}
	}

	loadAndUpdateResults()

}
