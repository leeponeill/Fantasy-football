import { renderPage } from './renderPage'
import {
	getAllPlayers,
	getCurrentGameweekPlayerPoints,
	hasTeamPlayedThisGameweek,
	getPlayerPoints,
	getTotalAccumulatedPoints,
	type SelectablePlayer,
	getTeamBadgeOrFlagHtml,
	getTeamKitColors,
} from './teamsData'
import { getTeamNameForUser, getTeamTileDisplayPreferenceForUser, requireAuth, userScopedStorageKey } from './auth'
import { getSharedItem, setSharedItem, sharedLeagueUpdatedEvent } from './sharedLeague'
import { getWCFixtureGameweeks, type WCFixtureGame, type WCFixtureGameweek } from './fixturesData'
import {
	getTransferAwareGameweekPoints,
	getTransferAwarePlayerCurrentPoints,
	parseTransferPointEvents,
	pruneTransferPointEvents,
	recordTransferPointEvent,
	type TransferPointEvent,
} from './transferPoints'

function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;')
}

function playerKey(player: SelectablePlayer): string {
	return `${player.team}::${player.name}`
}

function renderPitchPlayerName(name: string): string {
	const parts = name.trim().split(/\s+/)
	if (parts.length === 2) {
		return `${escapeHtml(parts[0])}<br />${escapeHtml(parts[1])}`
	}

	return escapeHtml(name)
}

const maxTeamSize = 11
const defaultBenchSize = 4
const defaultBudget = 100
const maxTransfersPerGameweek = 3
const currentUsername = requireAuth()
const currentTeamName = getTeamNameForUser(currentUsername) ?? 'Unnamed Team'
const teamStateStorageKey = userScopedStorageKey('fantasy-football-my-team-state', currentUsername)
const globalGameweekStorageKey = 'fantasy-football-global-Gameweek'
const globalBudgetStorageKey = 'fantasy-football-global-budget'
const benchModeStorageKey = 'fantasy-football-bench-mode'
const positionLimits: Record<string, number> = {
	Goalkeeper: 1,
	Defender: 5,
	Midfielder: 5,
	Forward: 3,
}
const positionMinimums: Record<keyof typeof positionLimits, number> = {
	Goalkeeper: 1,
	Defender: 3,
	Midfielder: 3,
	Forward: 1,
}

const unlimitedTransferGameweek = 0
const transferKickoffLockWindowMs = 3.5 * 60 * 60 * 1000

const allPlayers = getAllPlayers()
const minimumPlayerPrice = allPlayers.reduce((min, player) => Math.min(min, player.price), Number.POSITIVE_INFINITY)
let maxBudget = defaultBudget
let selectedPlayers: SelectablePlayer[] = []
let benchPlayers: SelectablePlayer[] = []
let claimedByOthers: Map<string, string> = new Map()
let draftModeEnabled = false
let draftOrder: string[] = []
let draftCurrentTurn: string | null = null
let draftType: 'round-robin' | 'snake' = 'round-robin'
let draftComplete = false
let benchModeEnabled = getSharedItem(benchModeStorageKey) !== 'false'
let benchSize = defaultBenchSize
let remainingBudget = maxBudget
let incomingTransferRequests: TransferRequest[] = []
let outgoingTransferRequests: TransferRequest[] = []
let fixtureGameweeks: WCFixtureGameweek[] = []

type TeamTileDisplayMode = 'flag' | 'name'

function getTeamTileDisplayMode(): TeamTileDisplayMode {
	const perUserPreference = getTeamTileDisplayPreferenceForUser(currentUsername)
	if (perUserPreference) {
		return perUserPreference
	}

	return 'flag'
}

function renderTeamIdentity(player: SelectablePlayer): string {
	if (getTeamTileDisplayMode() === 'name') {
		return `<div class="player-flag player-team-name">${escapeHtml(player.team)}</div>`
	}

	return `<div class="player-flag">${getTeamBadgeOrFlagHtml(player.team, 'team-icon')}</div>`
}

const transferTeamAliases: Record<string, string> = {
	manutd: 'manchesterunited',
	manchesterutd: 'manchesterunited',
	manchesterunited: 'manchesterunited',
	mancity: 'manchestercity',
	manchestercity: 'manchestercity',
	spurs: 'tottenham',
	tottenham: 'tottenham',
	tottenhamhotspur: 'tottenham',
	nottmforest: 'nottinghamforest',
	nottinghamforest: 'nottinghamforest',
	westham: 'westham',
	westhamunited: 'westham',
	wolves: 'wolves',
	wolverhampton: 'wolves',
	wolverhamptonwanderers: 'wolves',
	brighton: 'brighton',
	brightonandhovealbion: 'brighton',
	newcastle: 'newcastle',
	newcastleunited: 'newcastle',
}

function toToken(value: string): string {
	return value
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '')
}

function normalizeTeamToken(teamName: string): string {
	const token = toToken(teamName)
	const trimmedToken = token.startsWith('afc') && token.length > 3
		? token.slice(3)
		: token.endsWith('fc') && token.length > 2
			? token.slice(0, -2)
			: token

	return transferTeamAliases[token] ?? transferTeamAliases[trimmedToken] ?? trimmedToken
}

type LondonDateParts = {
	year: number
	month: number
	day: number
	hour: number
	minute: number
	second: number
}

function getLondonDateParts(date: Date): LondonDateParts {
	const formatter = new Intl.DateTimeFormat('en-GB', {
		timeZone: 'Europe/London',
		hour12: false,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	})

	const parts = formatter.formatToParts(date)
	const byType: Record<string, string> = {}
	for (const part of parts) {
		byType[part.type] = part.value
	}

	return {
		year: Number.parseInt(byType.year ?? '0', 10),
		month: Number.parseInt(byType.month ?? '1', 10),
		day: Number.parseInt(byType.day ?? '1', 10),
		hour: Number.parseInt(byType.hour ?? '0', 10),
		minute: Number.parseInt(byType.minute ?? '0', 10),
		second: Number.parseInt(byType.second ?? '0', 10),
	}
}

function londonCivilToDate(year: number, monthIndex: number, day: number, hour24: number, minute: number): Date {
	const approxUtc = Date.UTC(year, monthIndex, day, hour24, minute, 0, 0)
	const londonAtApprox = getLondonDateParts(new Date(approxUtc))
	const londonAsUtc = Date.UTC(
		londonAtApprox.year,
		londonAtApprox.month - 1,
		londonAtApprox.day,
		londonAtApprox.hour,
		londonAtApprox.minute,
		londonAtApprox.second,
	)
	const offsetMs = londonAsUtc - approxUtc
	return new Date(approxUtc - offsetMs)
}

function parseFixtureKickoff(game: WCFixtureGame, now: Date): Date | null {
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

	const nowLondon = getLondonDateParts(now)
	const kickoff = londonCivilToDate(nowLondon.year, monthIndex, day, hour24, minute)
	const halfYearMs = 180 * 24 * 60 * 60 * 1000
	if (kickoff.getTime() - now.getTime() > halfYearMs) {
		const adjusted = londonCivilToDate(nowLondon.year - 1, monthIndex, day, hour24, minute)
		return adjusted
	} else if (now.getTime() - kickoff.getTime() > halfYearMs) {
		const adjusted = londonCivilToDate(nowLondon.year + 1, monthIndex, day, hour24, minute)
		return adjusted
	}

	return kickoff
}

let transferLockCacheMinute = -1
let transferLockCacheFixtureRef: WCFixtureGameweek[] | null = null
let transferLockCacheLockedTeamTokens = new Set<string>()

function getLockedTeamTokensNow(now: Date): Set<string> {
	const minuteBucket = Math.floor(now.getTime() / 60000)
	if (transferLockCacheFixtureRef === fixtureGameweeks && transferLockCacheMinute === minuteBucket) {
		return transferLockCacheLockedTeamTokens
	}

	const nowMs = now.getTime()
	const lockedTokens = new Set<string>()

	for (const Gameweek of fixtureGameweeks) {
		for (const game of Gameweek.games) {
			const kickoff = parseFixtureKickoff(game, now)
			if (!kickoff) {
				continue
			}

			const kickoffMs = kickoff.getTime()
			if (nowMs < kickoffMs || nowMs > kickoffMs + transferKickoffLockWindowMs) {
				continue
			}

			const [homeTeam, awayTeam] = game.match.split(' vs ')
			if (homeTeam) {
				lockedTokens.add(normalizeTeamToken(homeTeam))
			}
			if (awayTeam) {
				lockedTokens.add(normalizeTeamToken(awayTeam))
			}
		}
	}

	transferLockCacheMinute = minuteBucket
	transferLockCacheFixtureRef = fixtureGameweeks
	transferLockCacheLockedTeamTokens = lockedTokens
	return lockedTokens
}

function isPlayerTransferLockedNow(player: SelectablePlayer): boolean {
	const now = new Date()

	if (fixtureGameweeks.length === 0) {
		return false
	}

	const lockedTeams = getLockedTeamTokensNow(now)
	return lockedTeams.has(normalizeTeamToken(player.team))
}

function getTransferLockMessage(player: SelectablePlayer): string {
	return `${player.name} cannot be transferred from kickoff until 3.5 hours after kickoff for ${player.team}.`
}

async function refreshFixtureGameweeks(): Promise<void> {
	try {
		fixtureGameweeks = await getWCFixtureGameweeks()
	} catch {
		fixtureGameweeks = []
	}
}

async function refreshTeamsPlayedThisGameweek(): Promise<void> {
	return Promise.resolve()
}

type TransferRequest = {
	id: string
	playerKey: string
	playerName?: string
	marketPrice?: number
	position?: string
	fromUser: string
	toUser: string
	offeredPrice?: number
	status: 'pending' | 'accepted' | 'denied' | string
	createdAt?: string
	resolvedAt?: string
}

async function logTransferHistoryEvent(payload: {
	type: 'market-buy' | 'market-sell'
	playerKey: string
	playerName: string
	marketPrice: number
	salePrice: number
}): Promise<void> {
	try {
		await fetch('/api/transfer-history', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				user: currentUsername,
				type: payload.type,
				playerKey: payload.playerKey,
				playerName: payload.playerName,
				marketPrice: Number(payload.marketPrice.toFixed(1)),
				salePrice: Number(payload.salePrice.toFixed(1)),
			}),
		})
	} catch {
		// Non-blocking: history logging should never block the transfer action.
	}
}

async function refreshClaimedPlayers(): Promise<void> {
	try {
		const response = await fetch(`/api/claimed-players?user=${encodeURIComponent(currentUsername)}`)
		if (!response.ok) return
		const data = (await response.json()) as { claimed?: Record<string, string> }
		claimedByOthers = new Map(Object.entries(data.claimed ?? {}))
	} catch {
		// Keep the existing cached set on failure.
	}
}

async function refreshTransferRequests(): Promise<void> {
	try {
		const response = await fetch(`/api/player-transfer-requests?user=${encodeURIComponent(currentUsername)}`)
		if (!response.ok) return
		const data = (await response.json()) as {
			incoming?: TransferRequest[]
			outgoing?: TransferRequest[]
		}
		incomingTransferRequests = Array.isArray(data.incoming) ? data.incoming : []
		outgoingTransferRequests = Array.isArray(data.outgoing) ? data.outgoing : []
	} catch {
		// Keep existing state on failure.
	}
	renderTransferRequests()
}

async function refreshDraftMode(): Promise<void> {
	try {
		const response = await fetch('/api/draft-mode')
		if (!response.ok) return
		const data = (await response.json()) as {
			enabled?: boolean
			canEnable?: boolean
			order?: string[]
			currentTurn?: string | null
			type?: string
			complete?: boolean
		}
		draftModeEnabled = data.enabled === true
		draftOrder = Array.isArray(data.order) ? data.order.filter((value) => typeof value === 'string') : []
		draftCurrentTurn = typeof data.currentTurn === 'string' ? data.currentTurn : null
		draftType = data.type === 'snake' ? 'snake' : 'round-robin'
		draftComplete = data.complete === true
	} catch {
		// Keep existing state on failure.
	}
	renderDraftStatus()
}

function normalizeBenchStateForMode(): boolean {
	if (benchModeEnabled || benchPlayers.length === 0) {
		return false
	}

	benchPlayers = []
	remainingBudget = Math.max(0, Number((maxBudget - getTotalPrice(selectedPlayers)).toFixed(1)))
	return true
}

async function refreshBenchMode(): Promise<void> {
	try {
		const response = await fetch('/api/bench-mode', { cache: 'no-store' })
		if (!response.ok) return
		const data = (await response.json()) as {
			enabled?: boolean
			benchSize?: number
		}
		benchModeEnabled = data.enabled !== false
		if (Number.isFinite(data.benchSize)) {
			benchSize = Math.max(0, Math.floor(data.benchSize ?? benchSize))
		}
	} catch {
		// Keep existing state on failure.
	}

	const benchStateChanged = normalizeBenchStateForMode()
	if (benchStateChanged) {
		saveTeamState()
	}

	renderSelectedTeam()
	renderBench()
	renderSearchResults()
}

function renderDraftStatus(): void {
	const status = document.querySelector<HTMLParagraphElement>('#draft-status')
	if (!status) return
	const draftTypeLabel = draftType === 'snake' ? 'Snake' : 'Round Robin'

	if (!draftModeEnabled) {
		status.textContent = 'Draft Mode: Off'
		renderAutoDraftPickButton()
		return
	}

	if (draftOrder.length === 0) {
		status.textContent = `Draft Mode: On (${draftTypeLabel}, waiting for order)`
		renderAutoDraftPickButton()
		return
	}

	if (draftComplete) {
		status.textContent = `Draft Mode: Complete (${draftTypeLabel} | ${draftOrder.join(' -> ')})`
		renderAutoDraftPickButton()
		return
	}

	const turnLabel = draftCurrentTurn ? draftCurrentTurn : 'Unknown'
	status.textContent = `Draft Mode: ${turnLabel}'s turn (${draftTypeLabel} | ${draftOrder.join(' -> ')})`
	renderAutoDraftPickButton()
}

function isDraftPhaseActive(): boolean {
	return draftModeEnabled && !draftComplete && currentGameweek === 1
}

function isUnlimitedTransferGameweek(Gameweek: number = currentGameweek): boolean {
	return Gameweek === unlimitedTransferGameweek
}

function renderTransferRequests(): void {
	const section = document.querySelector<HTMLDivElement>('#transfer-requests-section')
	const container = document.querySelector<HTMLDivElement>('#transfer-requests')
	if (!container || !section) return

	section.hidden = !draftModeEnabled
	if (!draftModeEnabled) {
		container.innerHTML = ''
		return
	}

	const incomingPending = incomingTransferRequests.filter((request) => request.status === 'pending')
	const outgoingPending = outgoingTransferRequests.filter((request) => request.status === 'pending')

	if (incomingPending.length === 0 && outgoingPending.length === 0) {
		container.innerHTML = '<p class="players-help">No pending transfer requests.</p>'
		return
	}

	const incomingMarkup = incomingPending
		.map((request) => {
			const player = findPlayerByKey(request.playerKey)
			const playerLabel = player ? `${player.name} (${player.team})` : request.playerKey
			return `
				<li class="transfer-request-item">
					<div>
						<strong>${escapeHtml(playerLabel)}</strong>
						<div class="selected-meta">Requested by ${escapeHtml(request.fromUser)} for £${Number(request.offeredPrice ?? 0).toFixed(1)}</div>
					</div>
					<div class="transfer-request-actions">
						<button type="button" class="transfer-request-action transfer-request-action--accept" data-request-id="${escapeHtml(request.id)}" data-decision="accept">Accept</button>
						<button type="button" class="transfer-request-action transfer-request-action--deny" data-request-id="${escapeHtml(request.id)}" data-decision="deny">Deny</button>
					</div>
				</li>
			`
		})
		.join('')

	const outgoingMarkup = outgoingPending
		.map((request) => {
			const player = findPlayerByKey(request.playerKey)
			const playerLabel = player ? `${player.name} (${player.team})` : request.playerKey
			return `
				<li class="transfer-request-item">
					<div>
						<strong>${escapeHtml(playerLabel)}</strong>
						<div class="selected-meta">Offer £${Number(request.offeredPrice ?? 0).toFixed(1)} pending with ${escapeHtml(request.toUser)}</div>
					</div>
				</li>
			`
		})
		.join('')

	container.innerHTML = `
		${incomingPending.length > 0 ? `<p class="players-help">Incoming Requests</p><ul class="transfer-request-list">${incomingMarkup}</ul>` : ''}
		${outgoingPending.length > 0 ? `<p class="players-help">Outgoing Requests</p><ul class="transfer-request-list">${outgoingMarkup}</ul>` : ''}
	`
}

let transfersUsedThisGameweek = 0
let currentGameweek = 1
let captainPlayerKey: string | null = null
let captainChangesThisGameweek = 0
let captainBonusTotal = 0
let manualPointsAdjustment = 0
let ownedPointsTotal = 0
let isCaptainSelectMode = false
let swapBenchKey: string | null = null
let transferPointEvents: TransferPointEvent[] = []
let transferUsageByGameweek: Record<number, number> = {}
let hasLoadedTeamState = false

function isTeamLockedForGameweek(Gameweek: number = currentGameweek): boolean {
	return Gameweek !== unlimitedTransferGameweek
}

function getCurrentPointsByPlayerKey(key: string): number {
	const parts = key.split('::')
	if (parts.length < 2) {
		return 0
	}

	const teamName = parts[0]
	const playerName = parts.slice(1).join('::')
	return getCurrentGameweekPlayerPoints(playerName, teamName)
}

function getDisplayedPlayerTotalPoints(playerName: string, teamName: string): number {
	return getCurrentGameweekPlayerPoints(playerName, teamName)
}

function getSearchPlayerTotalPoints(playerName: string, teamName: string): number {
	return getTotalAccumulatedPoints(playerName, teamName) + getPlayerPoints(playerName, teamName)
}

function getDisplayedSelectedPlayerTotalPoints(player: SelectablePlayer, selectedKeys: string[]): number {
	return getTransferAwarePlayerCurrentPoints(
		playerKey(player),
		selectedKeys,
		currentGameweek,
		transferPointEvents,
		getCurrentPointsByPlayerKey,
	)
}

function addTransferPointEvent(direction: 'in' | 'out', key: string): void {
	if (!isTeamLockedForGameweek()) {
		return
	}

	const effectiveGameweek = getGlobalGameweek()
	if (currentGameweek !== effectiveGameweek) {
		currentGameweek = effectiveGameweek
	}

	transferPointEvents = recordTransferPointEvent(
		transferPointEvents,
		key,
		direction,
		effectiveGameweek,
		getCurrentPointsByPlayerKey,
	)
}

function reconcileTransferPointEventsFromRosterDiff(previousSelectedKeys: Set<string>, previousGameweek: number): void {
	if (!hasLoadedTeamState || !isTeamLockedForGameweek() || previousGameweek !== currentGameweek) {
		return
	}

	const nextSelectedKeys = new Set(selectedPlayers.map(playerKey))
	const eventsBefore = transferPointEvents.length

	for (const key of previousSelectedKeys) {
		if (!nextSelectedKeys.has(key)) {
			addTransferPointEvent('out', key)
		}
	}

	for (const key of nextSelectedKeys) {
		if (!previousSelectedKeys.has(key)) {
			addTransferPointEvent('in', key)
		}
	}

	if (transferPointEvents.length !== eventsBefore) {
		saveTeamState()
	}
}

// Extract unique positions and countries from all players
const uniquePositions = Array.from(new Set(allPlayers.map((p) => p.position))).sort()
const uniqueCountries = Array.from(new Set(allPlayers.map((p) => p.team))).sort()

const myTeamMarkup = `
	<section class="my-team-grid">

		<div class="my-team-panel pitch-container">
			<div class="search-panel-header">
				<h2>My Team <span id="team-count">0/11</span></h2>
				<button id="toggle-pitch-view-btn" type="button" class="player-list-toggle-btn" aria-expanded="true">Collapse Pitch</button>
			</div>
			<p class="my-team-name">${escapeHtml(currentTeamName)}</p>
			<p class="players-help">Pick up to 11 players. Limits: 1 GK, 5 DEF, 5 MID, 3 FWD. Minimums: 1 GK, 3 DEF, 3 MID, 1 FWD.</p>
			<p class="players-help" id="transfer-status">Gameweek 1 Transfers: 0/3 used</p>
			<p class="players-help" id="captain-status">Captain: None</p>
			<button id="select-captain-btn" type="button" class="lock-team-btn">Select Captain</button>
			<p class="players-help" id="budget-count">Budget: £0.0 / £100.0</p>
			<div class="pitch-info-row">
				<div>
					<p class="players-help">Gameweek Points: <span id="Gameweek-points" style="font-weight: 700; color: #059669;">0</span></p>
					<p class="players-help">Total Points: <span id="total-points" style="font-weight: 700; color: #0f172a;">0</span></p>
				</div>
			</div>
			<div id="pitch-panel-section">
				<div class="transfer-requests-section" id="transfer-requests-section" hidden><h3>Transfer Requests</h3><div id="transfer-requests"></div></div>
				<div class="football-pitch" id="selected-team"></div>
				<div class="bench-section" id="bench-section" hidden>
					<h3>Bench <span id="bench-count">0/${benchSize}</span></h3>
					<p class="players-help" id="bench-help-copy">Pick ${benchSize} bench players. Swap to/from active team for free.</p>
					<div class="bench-players" id="bench-players"></div>
				</div>
			</div>
		</div>

		<div class="my-team-panel">
			<div class="search-panel-header">
				<h2>Search Players</h2>
				<button id="toggle-player-list-btn" type="button" class="player-list-toggle-btn" aria-expanded="true">Collapse Search</button>
			</div>
			<div id="search-panel-section">
				<input id="player-search" type="text" placeholder="Search by player name" aria-label="Search players" />
				<p class="transfer-badge" id="transfer-remaining-badge">Transfers Remaining: 3</p>

				<div class="filters-section">
					<div class="filter-group">
						<label for="filter-position">Position:</label>
						<select id="filter-position" aria-label="Filter by position">
							<option value="">All Positions</option>
							${uniquePositions.map((pos) => `<option value="${escapeHtml(pos)}">${escapeHtml(pos)}</option>`).join('')}
						</select>
					</div>

					<div class="filter-group">
						<label for="filter-sort">Sort By:</label>
						<select id="filter-sort" aria-label="Sort players">
							<option value="alphabetical">Alphabetical</option>
							<option value="price-low-high">Price: Low to High</option>
							<option value="price-high-low">Price: High to Low</option>
							<option value="points-low-high">Total Points: Low to High</option>
							<option value="points-high-low">Total Points: High to Low</option>
						</select>
					</div>

					<div class="filter-group">
						<label for="filter-min-price">Min Price (£):</label>
						<input id="filter-min-price" type="number" min="0" step="0.5" placeholder="Any" aria-label="Minimum price" />
					</div>

					<div class="filter-group">
						<label for="filter-max-price">Max Price (£):</label>
						<input id="filter-max-price" type="number" min="0" step="0.5" placeholder="Any" aria-label="Maximum price" />
					</div>

					<div class="filter-group">
						<label for="filter-country">Country:</label>
						<select id="filter-country" aria-label="Filter by country">
							<option value="">All Countries</option>
							${uniqueCountries.map((country) => `<option value="${escapeHtml(country)}">${escapeHtml(country)}</option>`).join('')}
						</select>
					</div>
				</div>

				<p class="players-help" id="draft-status">Draft Mode: Off</p>
				<button id="auto-draft-pick-btn" type="button" class="lock-team-btn" hidden>Auto Pick Best Player</button>
				<p class="players-help" id="search-count"></p>
				<ul class="search-results" id="search-results"></ul>
			</div>
		</div>
	</section>
`

renderPage('My Team', 'my-team', myTeamMarkup)

const searchInput = document.querySelector<HTMLInputElement>('#player-search')
const searchResults = document.querySelector<HTMLUListElement>('#search-results')
const selectedTeamList = document.querySelector<HTMLDivElement>('#selected-team')
const teamCount = document.querySelector<HTMLSpanElement>('#team-count')
const searchCount = document.querySelector<HTMLParagraphElement>('#search-count')
const budgetCount = document.querySelector<HTMLParagraphElement>('#budget-count')
const GameweekPointsDisplay = document.querySelector<HTMLSpanElement>('#Gameweek-points')
const totalPointsDisplay = document.querySelector<HTMLSpanElement>('#total-points')
const selectCaptainBtn = document.querySelector<HTMLButtonElement>('#select-captain-btn')
const transferStatus = document.querySelector<HTMLParagraphElement>('#transfer-status')
const captainStatus = document.querySelector<HTMLParagraphElement>('#captain-status')
const transferRemainingBadge = document.querySelector<HTMLParagraphElement>('#transfer-remaining-badge')

const filterPosition = document.querySelector<HTMLSelectElement>('#filter-position')
const filterMinPrice = document.querySelector<HTMLInputElement>('#filter-min-price')
const filterMaxPrice = document.querySelector<HTMLInputElement>('#filter-max-price')
const filterCountry = document.querySelector<HTMLSelectElement>('#filter-country')
const filterSort = document.querySelector<HTMLSelectElement>('#filter-sort')
const autoDraftPickBtn = document.querySelector<HTMLButtonElement>('#auto-draft-pick-btn')
const togglePlayerListBtn = document.querySelector<HTMLButtonElement>('#toggle-player-list-btn')
const searchPanelSection = document.querySelector<HTMLDivElement>('#search-panel-section')
const togglePitchViewBtn = document.querySelector<HTMLButtonElement>('#toggle-pitch-view-btn')
const pitchPanelSection = document.querySelector<HTMLDivElement>('#pitch-panel-section')

let isPlayerListCollapsed = false
let isPitchViewCollapsed = false

function renderPlayerListVisibility(): void {
	if (!togglePlayerListBtn || !searchPanelSection) {
		return
	}

	searchPanelSection.hidden = isPlayerListCollapsed
	togglePlayerListBtn.textContent = isPlayerListCollapsed ? 'Expand Search' : 'Collapse Search'
	togglePlayerListBtn.setAttribute('aria-expanded', String(!isPlayerListCollapsed))
}

function renderPitchViewVisibility(): void {
	if (!togglePitchViewBtn || !pitchPanelSection) {
		return
	}

	pitchPanelSection.hidden = isPitchViewCollapsed
	togglePitchViewBtn.textContent = isPitchViewCollapsed ? 'Expand Pitch' : 'Collapse Pitch'
	togglePitchViewBtn.setAttribute('aria-expanded', String(!isPitchViewCollapsed))
}

type SavedTeamState = {
	selectedPlayerKeys: string[]
	benchPlayerKeys?: string[]
	isTeamLocked?: boolean
	transfersUsedThisGameweek: number
	transferUsageByGameweek?: Record<string, number>
	currentGameweek: number
	remainingBudget?: number
	captainPlayerKey?: string | null
	captainChangesThisGameweek?: number
	captainBonusTotal?: number
	manualPointsAdjustment?: number
	ownedPointsTotal?: number
	transferPointEvents?: TransferPointEvent[]
}

function parseTransferUsageByGameweek(value: unknown): Record<number, number> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return {}
	}

	const next: Record<number, number> = {}
	for (const [rawGameweek, rawUsed] of Object.entries(value as Record<string, unknown>)) {
		const Gameweek = Number.parseInt(rawGameweek, 10)
		if (!Number.isFinite(Gameweek) || Gameweek < 0) {
			continue
		}

		const used = typeof rawUsed === 'number' && Number.isFinite(rawUsed)
			? Math.max(0, Math.floor(rawUsed))
			: 0
		next[Gameweek] = used
	}

	return next
}

function getGlobalBudget(): number {
	const raw = getSharedItem(globalBudgetStorageKey)
	const parsed = raw ? Number.parseFloat(raw) : Number.NaN
	if (!Number.isFinite(parsed)) {
		return defaultBudget
	}

	return Math.max(1, Number(parsed.toFixed(1)))
}

function syncMaxBudget(): void {
	maxBudget = getGlobalBudget()
}

function saveTeamState(): void {
	transferPointEvents = pruneTransferPointEvents(transferPointEvents, currentGameweek)
	transferUsageByGameweek[currentGameweek] = Math.max(0, Math.floor(transfersUsedThisGameweek))

	const state: SavedTeamState = {
		selectedPlayerKeys: selectedPlayers.map(playerKey),
		benchPlayerKeys: benchPlayers.map(playerKey),
		transfersUsedThisGameweek,
		transferUsageByGameweek,
		currentGameweek,
		remainingBudget: Number(remainingBudget.toFixed(1)),
		captainPlayerKey,
		captainChangesThisGameweek,
		captainBonusTotal,
		manualPointsAdjustment,
		ownedPointsTotal,
		transferPointEvents,
	}

	setSharedItem(teamStateStorageKey, JSON.stringify(state))
	void refreshClaimedPlayers().then(() => { renderSearchResults() })
}

function getGlobalGameweek(): number {
	const raw = getSharedItem(globalGameweekStorageKey)
	const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
	if (Number.isFinite(parsed) && parsed >= 0) {
		return parsed
	}

	return 1
}

function syncWithGlobalGameweek(): void {
	const globalGameweek = getGlobalGameweek()
	if (currentGameweek !== globalGameweek) {
		transferUsageByGameweek[currentGameweek] = Math.max(0, Math.floor(transfersUsedThisGameweek))
		currentGameweek = globalGameweek
		transfersUsedThisGameweek = Math.max(0, Math.floor(transferUsageByGameweek[currentGameweek] ?? 0))
		captainChangesThisGameweek = 0
		transferPointEvents = pruneTransferPointEvents(transferPointEvents, currentGameweek)
		saveTeamState()
	}
}

function loadTeamState(): void {
	const previousSelectedKeys = new Set(selectedPlayers.map(playerKey))
	const previousGameweek = currentGameweek
	let didNormalizeLegacyTotals = false

	syncMaxBudget()
	const raw = getSharedItem(teamStateStorageKey)
	if (!raw) {
		selectedPlayers = []
		benchPlayers = []
		transfersUsedThisGameweek = 0
		currentGameweek = 1
		remainingBudget = maxBudget
		captainPlayerKey = null
		captainChangesThisGameweek = 0
		captainBonusTotal = 0
		manualPointsAdjustment = 0
		ownedPointsTotal = 0
		transferPointEvents = []
		transferUsageByGameweek = {}
		hasLoadedTeamState = true
		return
	}

	try {
		const state = JSON.parse(raw) as SavedTeamState
		const keys = Array.isArray(state.selectedPlayerKeys) ? state.selectedPlayerKeys : []
		selectedPlayers = keys
			.map((key) => findPlayerByKey(key))
			.filter((player): player is SelectablePlayer => Boolean(player))

		const benchKeys = Array.isArray(state.benchPlayerKeys) ? state.benchPlayerKeys : []
		benchPlayers = benchKeys
			.map((key) => findPlayerByKey(key))
			.filter((player): player is SelectablePlayer => Boolean(player))

		const savedTransfersUsedThisGameweek = Number.isFinite(state.transfersUsedThisGameweek)
			? Math.max(0, Math.floor(state.transfersUsedThisGameweek))
			: 0
		currentGameweek = Number.isFinite(state.currentGameweek) ? Math.max(0, Math.floor(state.currentGameweek)) : 1
		transferUsageByGameweek = parseTransferUsageByGameweek(state.transferUsageByGameweek)
		transfersUsedThisGameweek = Object.prototype.hasOwnProperty.call(transferUsageByGameweek, currentGameweek)
			? Math.max(0, Math.floor(transferUsageByGameweek[currentGameweek] ?? 0))
			: savedTransfersUsedThisGameweek
		transferUsageByGameweek[currentGameweek] = transfersUsedThisGameweek
		
		const allTeamPlayers = benchModeEnabled ? [...selectedPlayers, ...benchPlayers] : [...selectedPlayers]
		const playersAreEmpty = allTeamPlayers.length === 0
		remainingBudget = playersAreEmpty
			? maxBudget
			: Number.isFinite(state.remainingBudget)
				? Math.max(0, Math.min(maxBudget, Number(state.remainingBudget)))
				: Math.max(0, Number((maxBudget - getTotalPrice(allTeamPlayers)).toFixed(1)))

		normalizeBenchStateForMode()
		
		captainPlayerKey = typeof state.captainPlayerKey === 'string' ? state.captainPlayerKey : null
		captainChangesThisGameweek = Number.isFinite(state.captainChangesThisGameweek)
			? Math.max(0, Math.min(1, state.captainChangesThisGameweek ?? 0))
			: 0
		captainBonusTotal = Number.isFinite(state.captainBonusTotal) ? Math.max(0, state.captainBonusTotal ?? 0) : 0
		manualPointsAdjustment = Number.isFinite(state.manualPointsAdjustment) ? state.manualPointsAdjustment ?? 0 : 0
		ownedPointsTotal = Number.isFinite(state.ownedPointsTotal) ? Math.max(0, state.ownedPointsTotal ?? 0) : 0
		transferPointEvents = pruneTransferPointEvents(parseTransferPointEvents(state.transferPointEvents), currentGameweek)

		if (currentGameweek <= 1 && (captainBonusTotal > 0 || ownedPointsTotal > 0)) {
			captainBonusTotal = 0
			ownedPointsTotal = 0
			didNormalizeLegacyTotals = true
		}

		if (captainPlayerKey && !selectedPlayers.some((player) => playerKey(player) === captainPlayerKey)) {
			captainPlayerKey = null
		}
	} catch {
		selectedPlayers = []
		benchPlayers = []
		transfersUsedThisGameweek = 0
		currentGameweek = 1
		remainingBudget = maxBudget
		captainPlayerKey = null
		captainChangesThisGameweek = 0
		captainBonusTotal = 0
		ownedPointsTotal = 0
		transferPointEvents = []
		transferUsageByGameweek = {}
	}

	reconcileTransferPointEventsFromRosterDiff(previousSelectedKeys, previousGameweek)
	hasLoadedTeamState = true

	if (didNormalizeLegacyTotals) {
		saveTeamState()
	}
}

function positionBucket(position: string): 'Goalkeeper' | 'Defender' | 'Midfielder' | 'Forward' {
	if (position === 'Goalkeeper') {
		return 'Goalkeeper'
	}

	if (position === 'Defender') {
		return 'Defender'
	}

	if (position === 'Forward' || position === 'Midfielder/Forward') {
		return 'Forward'
	}

	return 'Midfielder'
}

function countByBucket(players: SelectablePlayer[], bucket: keyof typeof positionLimits): number {
	return players.filter((player) => positionBucket(player.position) === bucket).length
}

function getMissingMinimumSlots(players: SelectablePlayer[]): number {
	const buckets = Object.keys(positionMinimums) as Array<keyof typeof positionMinimums>
	return buckets.reduce((sum, bucket) => {
		const currentCount = countByBucket(players, bucket)
		const missingForBucket = Math.max(0, positionMinimums[bucket] - currentCount)
		return sum + missingForBucket
	}, 0)
}

function getTotalPrice(players: SelectablePlayer[]): number {
	const total = players.reduce((sum, player) => sum + player.price, 0)
	return Number(total.toFixed(1))
}

function getGameweekPoints(players: SelectablePlayer[]): number {
	const selectedKeys = players.map(playerKey)
	const basePoints = getTransferAwareGameweekPoints(
		selectedKeys,
		currentGameweek,
		transferPointEvents,
		getCurrentPointsByPlayerKey,
	)
	if (!captainPlayerKey) {
		return basePoints
	}

	const captainCurrentPoints = getTransferAwarePlayerCurrentPoints(
		captainPlayerKey,
		selectedKeys,
		currentGameweek,
		transferPointEvents,
		getCurrentPointsByPlayerKey,
	)

	return basePoints + captainCurrentPoints
}

function getTotalPoints(players: SelectablePlayer[]): number {
	const currentGameweek = getGameweekPoints(players)
	return ownedPointsTotal + currentGameweek + captainBonusTotal + manualPointsAdjustment
}

function canAddPlayer(player: SelectablePlayer): boolean {
	if (isPlayerTransferLockedNow(player)) {
		return false
	}

	if (selectedPlayers.length >= maxTeamSize) {
		return false
	}

	if (remainingBudget < player.price) {
		return false
	}

	// Avoid budget dead-ends where the team cannot be completed to 11 players.
	const remainingSlotsAfterAdding = maxTeamSize - (selectedPlayers.length + 1)
	const minimumBudgetNeededForRemainingSlots =
		remainingSlotsAfterAdding > 0 && Number.isFinite(minimumPlayerPrice)
			? remainingSlotsAfterAdding * minimumPlayerPrice
			: 0
	if (remainingBudget - player.price < minimumBudgetNeededForRemainingSlots) {
		return false
	}

	const bucket = positionBucket(player.position)
	if (countByBucket(selectedPlayers, bucket) >= positionLimits[bucket]) {
		return false
	}

	const nextSelectedPlayers = [...selectedPlayers, player]
	return getMissingMinimumSlots(nextSelectedPlayers) <= remainingSlotsAfterAdding
}

function canRemovePlayer(player?: SelectablePlayer): boolean {
	if (player && isPlayerTransferLockedNow(player)) {
		return false
	}

	if (isDraftPhaseActive()) {
		return false
	}

	if (!isTeamLockedForGameweek()) {
		return true
	}

	if (isUnlimitedTransferGameweek()) {
		return true
	}

	return transfersUsedThisGameweek < maxTransfersPerGameweek
}

function canAddPlayerToBench(player: SelectablePlayer): boolean {
	if (isPlayerTransferLockedNow(player)) {
		return false
	}

	if (!benchModeEnabled) {
		return false
	}

	if (benchPlayers.length >= benchSize) {
		return false
	}

	if (remainingBudget < player.price) {
		return false
	}

	return true
}

function canSwapWithBench(activePlayerKey: string, benchPlayerKey: string): boolean {
	if (!benchModeEnabled) {
		return false
	}

	// Can always swap in non-draft mode
	if (!draftModeEnabled) {
		return true
	}

	// In draft mode, check position limits after swap
	const activePlayer = findPlayerByKey(activePlayerKey)
	const benchPlayer = findPlayerByKey(benchPlayerKey)
	if (!activePlayer || !benchPlayer) {
		return false
	}

	const activeBucket = positionBucket(activePlayer.position)
	const benchBucket = positionBucket(benchPlayer.position)

	// If moving to a different position bucket, check if bench bucket would exceed limits
	if (activeBucket !== benchBucket) {
		const countInBenchBucket = countByBucket(selectedPlayers, benchBucket)
		if (countInBenchBucket >= positionLimits[benchBucket]) {
			return false
		}
	}

	return true
}

function swapPlayerWithBench(activePlayerKey: string, benchPlayerKey: string): void {
	if (!canSwapWithBench(activePlayerKey, benchPlayerKey)) {
		return
	}

	const activeIndex = selectedPlayers.findIndex((p) => playerKey(p) === activePlayerKey)
	const benchIndex = benchPlayers.findIndex((p) => playerKey(p) === benchPlayerKey)

	if (activeIndex < 0 || benchIndex < 0) {
		return
	}

	[selectedPlayers[activeIndex], benchPlayers[benchIndex]] = [benchPlayers[benchIndex], selectedPlayers[activeIndex]]
	saveTeamState()
	renderSelectedTeam()
	renderBench()
	renderSearchResults()
}

function getTransfersRemaining(): number {
	if (isUnlimitedTransferGameweek()) {
		return Number.POSITIVE_INFINITY
	}

	if (!isTeamLockedForGameweek()) {
		return maxTransfersPerGameweek
	}

	return Math.max(0, maxTransfersPerGameweek - transfersUsedThisGameweek)
}

function getTransfersRemainingAfterTransferOut(): number {
	if (isUnlimitedTransferGameweek()) {
		return Number.POSITIVE_INFINITY
	}

	if (!isTeamLockedForGameweek()) {
		return maxTransfersPerGameweek
	}

	return Math.max(0, maxTransfersPerGameweek - (transfersUsedThisGameweek + 1))
}

function confirmTransferOut(playerName: string): boolean {
	const transfersRemainingAfter = getTransfersRemainingAfterTransferOut()
	const transfersRemainingLabel = Number.isFinite(transfersRemainingAfter)
		? String(transfersRemainingAfter)
		: 'Unlimited'

	return confirm(
		`transfering out ${playerName}\ntransfers remaining after transfer ${transfersRemainingLabel}\n\ncontinue yes no`,
	)
}

function hasCurrentCaptainPlayedThisGameweek(): boolean {
	if (!captainPlayerKey) {
		return false
	}

	const captain = selectedPlayers.find((player) => playerKey(player) === captainPlayerKey)
	if (!captain) {
		return false
	}

	return hasTeamPlayedThisGameweek(captain.team)
}

function isCurrentCaptainTransferLocked(): boolean {
	if (!captainPlayerKey) {
		return false
	}

	const captain = selectedPlayers.find((player) => playerKey(player) === captainPlayerKey)
	if (!captain) {
		return false
	}

	return isPlayerTransferLockedNow(captain)
}

function canSetCaptain(targetKey: string): boolean {
	const targetPlayer = selectedPlayers.find((player) => playerKey(player) === targetKey)
	if (!targetPlayer) {
		return false
	}

	if (isTeamLockedForGameweek() && hasCurrentCaptainPlayedThisGameweek()) {
		return false
	}

	if (isTeamLockedForGameweek() && captainPlayerKey && isCurrentCaptainTransferLocked()) {
		return false
	}

	if (isTeamLockedForGameweek() && isPlayerTransferLockedNow(targetPlayer)) {
		return false
	}

	if (captainPlayerKey === targetKey) {
		return false
	}

	return true
}

function canAcceptTransfer(request: TransferRequest): boolean {
	if (!request.position) {
		return false
	}

	const player = findPlayerByKey(request.playerKey)
	if (player && isPlayerTransferLockedNow(player)) {
		return false
	}

	const bucket = positionBucket(request.position)
	const currentCountInBucket = countByBucket(selectedPlayers, bucket)
	return currentCountInBucket < positionLimits[bucket]
}

function setCaptain(targetKey: string): void {
	if (!canSetCaptain(targetKey)) {
		return
	}

	captainPlayerKey = targetKey
	captainChangesThisGameweek += 1
	isCaptainSelectMode = false
	saveTeamState()
	renderSelectedTeam()
	renderSearchResults()
}

function renderSelectedTeam(): void {
	if (!selectedTeamList || !teamCount) {
		return
	}

	teamCount.textContent = `${selectedPlayers.length}/${maxTeamSize}`
	if (budgetCount) {
		const spent = Number((maxBudget - remainingBudget).toFixed(1))
		budgetCount.textContent = `Budget: £${spent.toFixed(1)} / £${maxBudget.toFixed(1)} (Remaining: £${remainingBudget.toFixed(1)})`
	}
	const teamLocked = isTeamLockedForGameweek()
	if (GameweekPointsDisplay) {
		GameweekPointsDisplay.textContent = `${teamLocked ? getGameweekPoints(selectedPlayers) : 0}`
	}
	if (totalPointsDisplay) {
		totalPointsDisplay.textContent = `${teamLocked ? getTotalPoints(selectedPlayers) : 0}`
	}
	
	// Clear captain if they've been transferred out
	if (captainPlayerKey && !selectedPlayers.some((player) => playerKey(player) === captainPlayerKey)) {
		captainPlayerKey = null
		saveTeamState()
	}
	
	if (transferStatus) {
		transferStatus.textContent = isUnlimitedTransferGameweek()
			? `Gameweek ${currentGameweek} Transfers: Unlimited`
			: `Gameweek ${currentGameweek} Transfers: ${transfersUsedThisGameweek}/${maxTransfersPerGameweek} used`
	}
	if (captainStatus) {
		const captain = captainPlayerKey ? selectedPlayers.find((player) => playerKey(player) === captainPlayerKey) : null
		const captainLockedBecausePlayed = teamLocked && hasCurrentCaptainPlayedThisGameweek()
		const captainLockedBecauseTransferWindow = teamLocked && isCurrentCaptainTransferLocked()
		const selectionLimitInfo = captainLockedBecausePlayed
			? ' | Captain locked (already played this Gameweek)'
			: captainLockedBecauseTransferWindow
				? ' | Captain locked (kickoff lock window active)'
				: ''
		if (!captain) {
			const modeHint = isCaptainSelectMode ? ' | Click a player card to assign captain' : ''
			captainStatus.textContent = `Captain: None${selectionLimitInfo}${modeHint}`
		} else {
			const modeHint = isCaptainSelectMode ? ' | Click a player card to assign captain' : ''
			captainStatus.textContent = `Captain: ${captain.name}${selectionLimitInfo}${modeHint}`
		}
	}
	if (selectCaptainBtn) {
		const captainLockedBecausePlayed = teamLocked && hasCurrentCaptainPlayedThisGameweek()
		const captainLockedBecauseTransferWindow = teamLocked && isCurrentCaptainTransferLocked()
		const canSelectCaptainThisGameweek =
			selectedPlayers.length > 0 && !captainLockedBecausePlayed && !captainLockedBecauseTransferWindow
		if (!canSelectCaptainThisGameweek) {
			isCaptainSelectMode = false
		}
		selectCaptainBtn.disabled = !canSelectCaptainThisGameweek
		selectCaptainBtn.textContent = isCaptainSelectMode ? 'Cancel Captain Select' : 'Select Captain'
	}
	if (transferRemainingBadge) {
		const transfersRemaining = getTransfersRemaining()
		transferRemainingBadge.textContent = Number.isFinite(transfersRemaining)
			? `Transfers Remaining: ${transfersRemaining}`
			: 'Transfers Remaining: Unlimited'
	}

	if (selectedPlayers.length === 0) {
		selectedTeamList.innerHTML = '<p class="empty-state">No players selected yet.</p>'
		return
	}

	const goalkeepers = selectedPlayers.filter((p) => positionBucket(p.position) === 'Goalkeeper')
	const defenders = selectedPlayers.filter((p) => positionBucket(p.position) === 'Defender')
	const midfielders = selectedPlayers.filter((p) => positionBucket(p.position) === 'Midfielder')
	const forwards = selectedPlayers.filter((p) => positionBucket(p.position) === 'Forward')

	const renderRow = (players: SelectablePlayer[]): string => {
		if (players.length === 0) return ''
		const selectedKeys = selectedPlayers.map(playerKey)
		const playerCards = players
			.map((player) => {
				const key = playerKey(player)
				const baseDisplayedPoints = teamLocked ? getDisplayedSelectedPlayerTotalPoints(player, selectedKeys) : 0
				const displayedPoints = captainPlayerKey === key
					? baseDisplayedPoints * 2
					: baseDisplayedPoints
				const kitColors = getTeamKitColors(player.team)
				const transferLocked = isPlayerTransferLockedNow(player)
				const canRemove = canRemovePlayer(player)
				let swapBtnMarkup = ''
				if (swapBenchKey) {
					const canSwap = canSwapWithBench(key, swapBenchKey)
					const btnClass = canSwap ? 'swap-here-btn swap-here-btn--ok' : 'swap-here-btn swap-here-btn--bad'
						swapBtnMarkup = `<button class="${btnClass}" type="button" data-pitch-key="${escapeHtml(key)}"${canSwap ? '' : ' disabled'}>${canSwap ? 'Swap Here' : "Can't Swap"}</button>`
				}
				const played = hasTeamPlayedThisGameweek(player.team)
			return `
					<div class="pitch-player">
						<div class="player-card ${isCaptainSelectMode && canSetCaptain(key) ? 'captain-selectable' : ''}${played ? ' team-has-played' : ''}" data-player-key="${escapeHtml(key)}" style="--kit-bg: ${kitColors.backgroundColor}; --kit-pattern: ${kitColors.backgroundPattern}; --kit-text: ${kitColors.textColor}; --kit-border: ${kitColors.borderColor};">
							${captainPlayerKey === key ? '<div class="captain-badge">C</div>' : ''}
							${played ? '<div class="team-played-badge">✓</div>' : ''}
							${transferLocked ? '<div class="player-lock-badge">Locked</div>' : ''}
							<div class="player-name">${renderPitchPlayerName(player.name)}</div>
							<div class="player-details">
								<div class="player-price">£${player.price.toFixed(1)}</div>
								${renderTeamIdentity(player)}
									<div class="player-points">${displayedPoints}pts</div>
							</div>
							<button class="remove-player-btn${transferLocked ? ' remove-player-btn--locked' : ''}" type="button" data-key="${escapeHtml(key)}" title="Remove player" ${canRemove ? '' : 'disabled'}>×</button>
							${swapBtnMarkup}
						</div>
					</div>
				`
			})
			.join('')

		return `
			<div class="pitch-row">
				<div class="pitch-row-players">${playerCards}</div>
			</div>
		`
	}

	selectedTeamList.innerHTML = `
		<div class="pitch">
			${renderRow(goalkeepers)}
			${renderRow(defenders)}
			${renderRow(midfielders)}
			${renderRow(forwards)}
		</div>
	`
}

function renderBench(): void {
	const benchSection = document.querySelector<HTMLDivElement>('#bench-section')
	const benchList = document.querySelector<HTMLDivElement>('#bench-players')
	const benchCountEl = document.querySelector<HTMLSpanElement>('#bench-count')

	if (!benchSection || !benchList || !benchCountEl) {
		return
	}

	if (!benchModeEnabled) {
		benchSection.hidden = true
		benchList.innerHTML = ''
		benchCountEl.textContent = `0/${benchSize}`
		return
	}

	benchSection.hidden = false
	const benchHelpCopy = document.querySelector<HTMLParagraphElement>('#bench-help-copy')
	if (benchHelpCopy) {
		benchHelpCopy.textContent = `Pick ${benchSize} bench players. Swap to/from active team for free.`
	}

	benchCountEl.textContent = `${benchPlayers.length}/${benchSize}`

	if (benchPlayers.length === 0) {
		benchList.innerHTML = '<p class="players-help">No bench players selected yet.</p>'
		return
	}

	const benchMarkup = benchPlayers
		.map(
			(player) => `
				<div class="bench-player-item">
					<div class="bench-player-card">
						<div class="player-name">${escapeHtml(player.name)}</div>
						<div class="player-details">
							<div class="player-price">£${player.price.toFixed(1)}</div>
							${renderTeamIdentity(player)}
							<div class="player-position">${player.position}</div>
							<div class="player-points">${isTeamLockedForGameweek() ? getDisplayedPlayerTotalPoints(player.name, player.team) : 0}pts</div>
						</div>
					</div>
					<button class="swap-player-btn" type="button" data-bench-key="${escapeHtml(playerKey(player))}" title="Swap with active player" ${swapBenchKey ? 'disabled' : ''}>⇄</button>
				</div>
			`,
		)
		.join('')

	benchList.innerHTML = benchMarkup
}

function getBestAutoDraftCandidate(): SelectablePlayer | null {
	if (!isDraftPhaseActive()) {
		return null
	}

	const selectedKeys = new Set(selectedPlayers.map(playerKey))
	const benchKeys = new Set(benchPlayers.map(playerKey))
	const candidates = allPlayers.filter((player) => {
		const key = playerKey(player)
		if (selectedKeys.has(key) || benchKeys.has(key)) {
			return false
		}
		if (claimedByOthers.has(key)) {
			return false
		}
		if (isPlayerTransferLockedNow(player)) {
			return false
		}

		if (selectedPlayers.length < maxTeamSize) {
			return canAddPlayer(player)
		}

		return canAddPlayerToBench(player)
	})

	if (candidates.length === 0) {
		return null
	}

	candidates.sort((a, b) => b.price - a.price || a.name.localeCompare(b.name))
	return candidates[0]
}

function renderAutoDraftPickButton(): void {
	if (!autoDraftPickBtn) {
		return
	}

	autoDraftPickBtn.hidden = !draftModeEnabled
	autoDraftPickBtn.textContent = 'Auto Pick Best Player'

	if (!draftModeEnabled) {
		autoDraftPickBtn.disabled = true
		autoDraftPickBtn.title = ''
		return
	}

	if (!isDraftPhaseActive()) {
		autoDraftPickBtn.disabled = true
		autoDraftPickBtn.title = 'Auto pick is only available during the active draft phase.'
		return
	}

	if (!draftCurrentTurn || draftCurrentTurn.toLowerCase() !== currentUsername.toLowerCase()) {
		autoDraftPickBtn.disabled = true
		autoDraftPickBtn.title = 'You can only auto pick on your draft turn.'
		return
	}

	const candidate = getBestAutoDraftCandidate()
	autoDraftPickBtn.disabled = !candidate
	autoDraftPickBtn.title = candidate ? `Pick ${candidate.name} (£${candidate.price.toFixed(1)})` : 'No valid player can be auto-picked right now.'
}

async function submitDraftPick(player: SelectablePlayer): Promise<void> {
	const key = playerKey(player)

	try {
		const res = await fetch('/api/draft-pick', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ user: currentUsername, playerKey: key }),
		})
		const payload = (await res.json()) as { error?: string; currentTurn?: string | null; complete?: boolean; slot?: 'selected' | 'bench' }
		if (!res.ok) {
			alert(payload.error ?? 'Unable to save draft pick.')
			await refreshDraftMode()
			await refreshClaimedPlayers()
			renderSearchResults()
			return
		}

		if (payload.slot === 'bench') {
			benchPlayers = [...benchPlayers, player]
		} else {
			selectedPlayers = [...selectedPlayers, player]
		}
		addTransferPointEvent('in', key)
		remainingBudget = Math.max(0, Number((remainingBudget - player.price).toFixed(1)))
		saveTeamState()
		draftCurrentTurn = typeof payload.currentTurn === 'string' ? payload.currentTurn : null
		draftComplete = payload.complete === true
		renderDraftStatus()
		await refreshClaimedPlayers()
		renderSelectedTeam()
		renderBench()
		renderSearchResults()
	} catch {
		alert('Unable to save draft pick.')
	}
}

function renderSearchResults(): void {
	if (!searchInput || !searchResults || !searchCount) {
		return
	}

	const query = searchInput.value.trim().toLowerCase()
	const selectedKeys = new Set(selectedPlayers.map(playerKey))
	const claimedKeys = claimedByOthers
	const notCurrentTurn =
		isDraftPhaseActive() &&
		draftCurrentTurn !== null &&
		draftCurrentTurn.toLowerCase() !== currentUsername.toLowerCase()

	// Get filter values
	const selectedPositionFilter = filterPosition?.value || null
	const minPriceFilter = filterMinPrice?.value ? parseFloat(filterMinPrice.value) : null
	const maxPriceFilter = filterMaxPrice?.value ? parseFloat(filterMaxPrice.value) : null
	const selectedCountryFilter = filterCountry?.value || null
	const sortMode = filterSort?.value ?? 'alphabetical'

	const filtered = allPlayers.filter((player) => {
		// Name filter
		if (query && !player.name.toLowerCase().includes(query)) {
			return false
		}

		// Position filter
		if (selectedPositionFilter && player.position !== selectedPositionFilter) {
			return false
		}

		// Price range filter
		if (minPriceFilter !== null && player.price < minPriceFilter) {
			return false
		}
		if (maxPriceFilter !== null && player.price > maxPriceFilter) {
			return false
		}

		// Country filter
		if (selectedCountryFilter && player.team !== selectedCountryFilter) {
			return false
		}

		return true
	})

	filtered.sort((a, b) => {
		if (sortMode === 'price-low-high' || sortMode === 'price-high-low') {
			const priceDiff = sortMode === 'price-low-high' ? a.price - b.price : b.price - a.price
			if (priceDiff !== 0) {
				return priceDiff
			}
		} else if (sortMode === 'points-low-high' || sortMode === 'points-high-low') {
			const aPoints = getSearchPlayerTotalPoints(a.name, a.team)
			const bPoints = getSearchPlayerTotalPoints(b.name, b.team)
			const pointsDiff = sortMode === 'points-low-high' ? aPoints - bPoints : bPoints - aPoints
			if (pointsDiff !== 0) {
				return pointsDiff
			}
		}

		return a.name.localeCompare(b.name)
	})

	searchCount.textContent = `${filtered.length} players found`
	renderAutoDraftPickButton()

	searchResults.innerHTML = filtered
		.slice(0, 150)
		.map((player) => {
			const key = playerKey(player)
			const teamIdentity = getTeamBadgeOrFlagHtml(player.team, 'search-team-icon')
			const kitColors = getTeamKitColors(player.team)
			const alreadySelected = selectedKeys.has(key)
			const benchKeys = new Set(benchPlayers.map(playerKey))
			const alreadyOnBench = benchKeys.has(key)
			const transferLocked = isPlayerTransferLockedNow(player)
			const takenByOther = !alreadySelected && !alreadyOnBench && claimedKeys.has(key)
			const owner = claimedKeys.get(key) ?? null
			const hasPendingRequest = outgoingTransferRequests.some((request) => request.status === 'pending' && request.playerKey === key)
			const blockedByTurn = !alreadySelected && !alreadyOnBench && notCurrentTurn
			
			// Check if we can add to bench
			const canAddToBench = !alreadyOnBench && !alreadySelected && !takenByOther && !transferLocked && canAddPlayerToBench(player)
			const teamIsFull = selectedPlayers.length >= maxTeamSize
			const benchIsFull = benchPlayers.length >= benchSize
			
			const lockedAndNoTransfersLeft =
				isTeamLockedForGameweek() &&
				!isUnlimitedTransferGameweek() &&
				!alreadySelected &&
				selectedPlayers.length >= maxTeamSize &&
				transfersUsedThisGameweek >= maxTransfersPerGameweek
			const isRequestMode = takenByOther && !isDraftPhaseActive() && owner !== null
			const canAddToActive = !alreadySelected && canAddPlayer(player)
			const disabled = alreadySelected || (!isRequestMode && (takenByOther || !canAddToActive))
			const isDisabled = disabled || lockedAndNoTransfersLeft || blockedByTurn
			
			const buttonLabel = alreadySelected
				? 'Added'
				: alreadyOnBench
					? 'On Bench'
					: transferLocked
						? 'Locked'
					: isRequestMode
						? hasPendingRequest
							? 'Requested'
							: 'Request'
						: takenByOther
							? 'Taken'
							: blockedByTurn
								? 'Wait Turn'
								: teamIsFull && canAddToBench && !benchIsFull
									? 'Add to Bench'
									: 'Add'
			
			const buttonClass = isRequestMode
				? `request-btn${hasPendingRequest ? ' request-btn--pending' : ''}`
				: teamIsFull && canAddToBench && !benchIsFull
					? 'add-bench-btn'
					: `add-btn${takenByOther ? ' add-btn--taken' : ''}`
			
			const buttonDataAttrs = isRequestMode
				? `data-key="${escapeHtml(key)}" data-owner="${escapeHtml(owner)}"`
				: `data-key="${escapeHtml(key)}"`
			
			const requestDisabled = isRequestMode && (hasPendingRequest || selectedPlayers.length >= maxTeamSize || transferLocked)
			const benchDisabled = canAddToBench && benchIsFull
			const finalDisabled = isRequestMode ? requestDisabled || blockedByTurn : (canAddToBench ? benchDisabled : isDisabled)

			const totalPts = getSearchPlayerTotalPoints(player.name, player.team)
			return `
				<li class="search-item${takenByOther ? ' player-taken' : ''}" style="background-color: ${kitColors.backgroundColor}; background-image: ${kitColors.backgroundPattern}; border-color: ${kitColors.borderColor}; color: ${kitColors.textColor};">
					<div>
						<strong style="color: ${kitColors.textColor};">${teamIdentity} ${escapeHtml(player.name)} <span class="player-price" style="color: ${kitColors.textColor};">(£${player.price.toFixed(1)})</span> <span class="player-total-pts" style="color: ${kitColors.textColor};">${totalPts} pts</span></strong>
						<div class="selected-meta" style="color: ${kitColors.textColor};">${escapeHtml(player.team)} (${escapeHtml(player.position)})</div>
					</div>
					<button class="${buttonClass}" type="button" ${buttonDataAttrs} ${finalDisabled ? 'disabled' : ''}>${buttonLabel}</button>
				</li>
			`
		})
		.join('')
}

function findPlayerByKey(key: string): SelectablePlayer | undefined {
	return allPlayers.find((player) => playerKey(player) === key)
}

function refreshLivePointsView(): void {
	renderSelectedTeam()
	renderBench()
	renderSearchResults()
}

if (searchInput && searchResults && selectedTeamList) {
	if (togglePlayerListBtn && searchPanelSection) {
		togglePlayerListBtn.addEventListener('click', () => {
			isPlayerListCollapsed = !isPlayerListCollapsed
			renderPlayerListVisibility()
		})
		renderPlayerListVisibility()
	}

	if (togglePitchViewBtn && pitchPanelSection) {
		togglePitchViewBtn.addEventListener('click', () => {
			isPitchViewCollapsed = !isPitchViewCollapsed
			renderPitchViewVisibility()
		})
		renderPitchViewVisibility()
	}

	searchInput.addEventListener('input', renderSearchResults)

	if (filterPosition) {
		filterPosition.addEventListener('change', renderSearchResults)
	}
	if (filterMinPrice) {
		filterMinPrice.addEventListener('input', renderSearchResults)
	}
	if (filterMaxPrice) {
		filterMaxPrice.addEventListener('input', renderSearchResults)
	}
	if (filterCountry) {
		filterCountry.addEventListener('change', renderSearchResults)
	}
	if (filterSort) {
		filterSort.addEventListener('change', renderSearchResults)
	}

	if (autoDraftPickBtn) {
		autoDraftPickBtn.addEventListener('click', async () => {
			if (!isDraftPhaseActive()) {
				return
			}

			if (!draftCurrentTurn || draftCurrentTurn.toLowerCase() !== currentUsername.toLowerCase()) {
				return
			}

			const candidate = getBestAutoDraftCandidate()
			if (!candidate) {
				alert('No valid player available for auto pick.')
				return
			}

			await submitDraftPick(candidate)
		})
	}

	searchResults.addEventListener('click', async (event) => {
		const target = event.target as HTMLElement
		const requestButton = target.closest<HTMLButtonElement>('button.request-btn')
		if (requestButton) {
			const requestedPlayerKey = requestButton.dataset.key
			if (!requestedPlayerKey) {
				return
			}
			const requestedPlayer = findPlayerByKey(requestedPlayerKey)
			if (requestedPlayer && isPlayerTransferLockedNow(requestedPlayer)) {
				alert(getTransferLockMessage(requestedPlayer))
				return
			}
			const offeredPriceText = window.prompt('Enter transfer offer price (£):')
			if (offeredPriceText === null) {
				return
			}
			const offeredPrice = Number.parseFloat(offeredPriceText)
			if (!Number.isFinite(offeredPrice) || offeredPrice < 0) {
				alert('Please enter a valid offer price.')
				return
			}
			if (offeredPrice > remainingBudget) {
				alert('You do not have enough remaining budget for that offer.')
				return
			}

			if (requestedPlayer) {
				const bucket = positionBucket(requestedPlayer.position)
				const countInBucket = countByBucket(selectedPlayers, bucket)
				if (countInBucket >= positionLimits[bucket]) {
					alert(`You already have the maximum number of ${bucket}s (${positionLimits[bucket]}). You cannot request this player.`)
					return
				}
			}

			try {
				const response = await fetch('/api/player-transfer-requests', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						user: currentUsername,
						playerKey: requestedPlayerKey,
						playerName: requestedPlayer?.name ?? requestedPlayerKey,
						marketPrice: requestedPlayer?.price ?? 0,
						position: requestedPlayer?.position ?? '',
						offeredPrice: Number(offeredPrice.toFixed(1)),
					}),
				})
				const data = (await response.json()) as { error?: string }
				if (!response.ok) {
					alert(data.error ?? 'Unable to send transfer request.')
					return
				}
				await refreshTransferRequests()
				renderSearchResults()
			} catch {
				alert('Unable to send transfer request.')
			}
			return
		}

		const button = target.closest<HTMLButtonElement>('button.add-bench-btn')
		if (button) {
			if (!benchModeEnabled) {
				return
			}

			const key = button.dataset.key
			if (!key) {
				return
			}

			const player = findPlayerByKey(key)
			const benchKeys = new Set(benchPlayers.map(playerKey))
			const selectedSet = new Set(selectedPlayers.map(playerKey))
			if (!player || benchKeys.has(key) || selectedSet.has(key)) {
				return
			}

			if (isPlayerTransferLockedNow(player)) {
				alert(getTransferLockMessage(player))
				return
			}

			if (!canAddPlayerToBench(player)) {
				alert(`Cannot add ${player.name}. Check position limits for bench.`)
				return
			}

			if (isDraftPhaseActive()) {
				await submitDraftPick(player)
				return
			}

			benchPlayers = [...benchPlayers, player]
			remainingBudget = Math.max(0, Number((remainingBudget - player.price).toFixed(1)))
			saveTeamState()
			void logTransferHistoryEvent({
				type: 'market-buy',
				playerKey: key,
				playerName: player.name,
				marketPrice: player.price,
				salePrice: player.price,
			})
			renderBench()
			renderSelectedTeam()
			renderSearchResults()
			return
		}

		const addButton = target.closest<HTMLButtonElement>('button.add-btn')
		if (!addButton) {
			return
		}

		const key = addButton.dataset.key
		if (!key) {
			return
		}

		const player = findPlayerByKey(key)
		if (!player || selectedPlayers.some((item) => playerKey(item) === key)) {
			return
		}

		if (isPlayerTransferLockedNow(player)) {
			alert(getTransferLockMessage(player))
			return
		}

		if (claimedByOthers.has(key)) {
			return
		}

		if (
			isDraftPhaseActive() &&
			draftCurrentTurn !== null &&
			draftCurrentTurn.toLowerCase() !== currentUsername.toLowerCase()
		) {
			return
		}

		if (!canAddPlayer(player)) {
			return
		}
		if (
			isTeamLockedForGameweek() &&
			!isUnlimitedTransferGameweek() &&
			selectedPlayers.length >= maxTeamSize &&
			transfersUsedThisGameweek >= maxTransfersPerGameweek
		) {
			return
		}

		if (isDraftPhaseActive()) {
			await submitDraftPick(player)
			return
		}

		selectedPlayers = [...selectedPlayers, player]
		addTransferPointEvent('in', key)
		remainingBudget = Math.max(0, Number((remainingBudget - player.price).toFixed(1)))
		saveTeamState()
		void logTransferHistoryEvent({
			type: 'market-buy',
			playerKey: key,
			playerName: player.name,
			marketPrice: player.price,
			salePrice: player.price,
		})
		renderSelectedTeam()
		renderSearchResults()
	})

	selectedTeamList.addEventListener('click', (event) => {
		const target = event.target as HTMLElement

		if (isCaptainSelectMode) {
			const card = target.closest<HTMLDivElement>('.player-card')
			const cardKey = card?.dataset.playerKey
			if (cardKey) {
				const targetPlayer = findPlayerByKey(cardKey)
				if (isTeamLockedForGameweek() && captainPlayerKey && isCurrentCaptainTransferLocked()) {
					alert('Captain cannot be changed while the current captain is in a kickoff lock window.')
					return
				}
				if (isTeamLockedForGameweek() && targetPlayer && isPlayerTransferLockedNow(targetPlayer)) {
					alert('Captain cannot be changed to a player in a kickoff lock window.')
					return
				}
				setCaptain(cardKey)
				return
			}
		}

		const button = target.closest<HTMLButtonElement>('button.remove-player-btn')
		if (!button) {
			return
		}

		const key = button.dataset.key
		if (!key) {
			return
		}

		const removedPlayer = findPlayerByKey(key)
		if (!removedPlayer) {
			return
		}

		if (!canRemovePlayer(removedPlayer)) {
			if (isPlayerTransferLockedNow(removedPlayer)) {
				alert(getTransferLockMessage(removedPlayer))
			}
			return
		}

		if (!confirmTransferOut(removedPlayer.name)) {
			return
		}

		addTransferPointEvent('out', key)
		selectedPlayers = selectedPlayers.filter((player) => playerKey(player) !== key)
		if (removedPlayer) {
			remainingBudget = Math.min(maxBudget, Number((remainingBudget + removedPlayer.price).toFixed(1)))
			void logTransferHistoryEvent({
				type: 'market-sell',
				playerKey: key,
				playerName: removedPlayer.name,
				marketPrice: removedPlayer.price,
				salePrice: removedPlayer.price,
			})
		}
		if (isTeamLockedForGameweek()) {
			transfersUsedThisGameweek += 1
		}
		saveTeamState()
		renderSelectedTeam()
		renderSearchResults()
	})

	const benchList = document.querySelector<HTMLDivElement>('#bench-players')
	if (benchList) {
				// Optional: clicking anywhere else on the pitch cancels swap mode
				selectedTeamList.addEventListener('click', (event) => {
					const target = event.target as HTMLElement
					if (swapBenchKey && !target.closest('button.swap-here-btn')) {
						swapBenchKey = null
						renderSelectedTeam()
						renderBench()
					}
				}, true)
			// Add event handler for swap-here buttons on pitch
			selectedTeamList.addEventListener('click', (event) => {
				const target = event.target as HTMLElement
				const swapHereBtn = target.closest<HTMLButtonElement>('button.swap-here-btn')
				if (swapHereBtn && swapBenchKey) {
					const pitchKey = swapHereBtn.dataset.pitchKey
					if (!pitchKey) return
					swapPlayerWithBench(pitchKey, swapBenchKey)
					swapBenchKey = null
					renderSelectedTeam()
					renderBench()
					return
				}
			})
		benchList.addEventListener('click', (event) => {
			if (!benchModeEnabled) {
				return
			}

			const target = event.target as HTMLElement
			const swapBtn = target.closest<HTMLButtonElement>('button.swap-player-btn')
			if (swapBtn) {
				const benchKey = swapBtn.dataset.benchKey
				if (!benchKey) return
				swapBenchKey = benchKey
				renderSelectedTeam()
				renderBench()
				return
			}
		})
	}

	if (selectCaptainBtn) {
		selectCaptainBtn.addEventListener('click', () => {
			if (selectedPlayers.length === 0) {
				return
			}

			if (isTeamLockedForGameweek() && hasCurrentCaptainPlayedThisGameweek()) {
				return
			}

			isCaptainSelectMode = !isCaptainSelectMode
			renderSelectedTeam()
		})
	}

	window.addEventListener('focus', refreshLivePointsView)
	window.addEventListener('storage', (event) => {
		if (
			event.key === 'fantasy-football-player-points' ||
			event.key === 'fantasy-football-total-points' ||
			event.key === globalGameweekStorageKey ||
			event.key === globalBudgetStorageKey
		) {
			if (event.key === globalBudgetStorageKey) {
				syncMaxBudget()
			}
			syncWithGlobalGameweek()
			refreshLivePointsView()
		}
	})
	window.addEventListener(sharedLeagueUpdatedEvent, () => {
		loadTeamState()
		syncWithGlobalGameweek()
		void refreshClaimedPlayers().then(async () => {
			await refreshTeamsPlayedThisGameweek()
			refreshLivePointsView()
		})
		void refreshDraftMode()
		void refreshBenchMode()
		void refreshTransferRequests()
	})
	const transferRequestsContainer = document.querySelector<HTMLDivElement>('#transfer-requests')
	if (transferRequestsContainer) {
		transferRequestsContainer.addEventListener('click', async (event) => {
			const target = event.target as HTMLElement
			const actionBtn = target.closest<HTMLButtonElement>('button.transfer-request-action')
			if (!actionBtn) {
				return
			}

			const requestId = actionBtn.dataset.requestId
			const decision = actionBtn.dataset.decision
			if (!requestId || (decision !== 'accept' && decision !== 'deny')) {
				return
			}

			if (decision === 'accept') {
				const targetRequest = incomingTransferRequests.find((r) => r.id === requestId)
				if (targetRequest && !canAcceptTransfer(targetRequest)) {
					const targetPlayer = findPlayerByKey(targetRequest.playerKey)
					if (targetPlayer && isPlayerTransferLockedNow(targetPlayer)) {
						alert(getTransferLockMessage(targetPlayer))
					} else {
						alert(`Cannot accept: accepting this player would exceed the position limit for ${targetRequest.position}.`)
					}
					return
				}
			}

			try {
				const response = await fetch('/api/player-transfer-requests/respond', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						user: currentUsername,
						requestId,
						decision,
						position: decision === 'accept' ? incomingTransferRequests.find((r) => r.id === requestId)?.position : undefined,
					}),
				})
				const data = (await response.json()) as { error?: string }
				if (!response.ok) {
					alert(data.error ?? 'Unable to process transfer request.')
					return
				}

				loadTeamState()
				await refreshClaimedPlayers()
				await refreshTransferRequests()
				renderSelectedTeam()
				renderSearchResults()
			} catch {
				alert('Unable to process transfer request.')
			}
		})
	}


	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') {
			loadTeamState()
			syncWithGlobalGameweek()
			void refreshTeamsPlayedThisGameweek().then(() => {
				refreshLivePointsView()
			})
			void refreshTransferRequests()
		}
	})

	loadTeamState()
	syncWithGlobalGameweek()
	void refreshFixtureGameweeks().then(() => {
		renderSelectedTeam()
		renderBench()
		renderSearchResults()
	})
	void refreshTeamsPlayedThisGameweek().then(() => {
		renderSelectedTeam()
		renderBench()
	})
	renderSelectedTeam()
	renderBench()
	void refreshBenchMode()
	void refreshDraftMode().then(() => {
		void refreshClaimedPlayers().then(() => {
			void refreshTransferRequests()
			renderSelectedTeam()
			renderSearchResults()
		})
	})
}
