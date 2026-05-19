import { renderPage } from './renderPage'
import { getAllPlayers, getPlayerPoints, getTotalAccumulatedPoints as getPlayerTotalPoints, addMatchdayPointsToTotal, type SelectablePlayer, getCountryFlag } from './teamsData'
import { getAllUsernames, getTeamNameForUser, requireAuth, userScopedStorageKey } from './auth'
import { commitSharedStorageChanges, getSharedItem, setSharedItem, sharedLeagueUpdatedEvent } from './sharedLeague'

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

const maxTeamSize = 11
const maxBenchSize = 4
const defaultBudget = 100
const maxTransfersPerMatchday = 3
const currentUsername = requireAuth()
const isCurrentUserLee = currentUsername.toLowerCase() === 'lee'
const currentTeamName = getTeamNameForUser(currentUsername) ?? 'Unnamed Team'
const teamStateStorageKey = userScopedStorageKey('fantasy-football-my-team-state', currentUsername)
const globalMatchdayStorageKey = 'fantasy-football-global-matchday'
const globalBudgetStorageKey = 'fantasy-football-global-budget'
const benchModeStorageKey = 'fantasy-football-bench-mode'
const positionLimits: Record<string, number> = {
	Goalkeeper: 1,
	Defender: 5,
	Midfielder: 5,
	Forward: 3,
}

const allPlayers = getAllPlayers()
const minimumPlayerPrice = allPlayers.reduce((min, player) => Math.min(min, player.price), Number.POSITIVE_INFINITY)
let maxBudget = defaultBudget
let selectedPlayers: SelectablePlayer[] = []
let benchPlayers: SelectablePlayer[] = []
let claimedByOthers: Map<string, string> = new Map()
let draftModeEnabled = false
let draftOrder: string[] = []
let draftCurrentTurn: string | null = null
let draftComplete = false
let benchModeEnabled = getSharedItem(benchModeStorageKey) !== 'false'
let remainingBudget = maxBudget
let incomingTransferRequests: TransferRequest[] = []
let outgoingTransferRequests: TransferRequest[] = []

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
	if (!draftModeEnabled) {
		return
	}

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
			complete?: boolean
		}
		draftModeEnabled = data.enabled === true
		draftOrder = Array.isArray(data.order) ? data.order.filter((value) => typeof value === 'string') : []
		draftCurrentTurn = typeof data.currentTurn === 'string' ? data.currentTurn : null
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
		}
		benchModeEnabled = data.enabled !== false
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

	if (!draftModeEnabled) {
		status.textContent = 'Draft Mode: Off'
		return
	}

	if (draftOrder.length === 0) {
		status.textContent = 'Draft Mode: On (waiting for order)'
		return
	}

	if (draftComplete) {
		status.textContent = `Draft Mode: Complete (${draftOrder.join(' -> ')})`
		return
	}

	const turnLabel = draftCurrentTurn ? draftCurrentTurn : 'Unknown'
	status.textContent = `Draft Mode: ${turnLabel}'s turn (${draftOrder.join(' -> ')})`
}

function isDraftPhaseActive(): boolean {
	return draftModeEnabled && !draftComplete && currentMatchday === 1
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

let isTeamLocked = false
let transfersUsedThisMatchday = 0
let currentMatchday = 1
let captainPlayerKey: string | null = null
let captainChangesThisMatchday = 0
let captainBonusTotal = 0
let manualPointsAdjustment = 0
let isCaptainSelectMode = false
let swapBenchKey: string | null = null

// Extract unique positions and countries from all players
const uniquePositions = Array.from(new Set(allPlayers.map((p) => p.position))).sort()
const uniqueCountries = Array.from(new Set(allPlayers.map((p) => p.team))).sort()

const myTeamMarkup = `
	<section class="my-team-grid">
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
				<p class="players-help" id="search-count"></p>
				<ul class="search-results" id="search-results"></ul>
			</div>
		</div>

		<div class="my-team-panel pitch-container">
			<h2>My Team <span id="team-count">0/11</span></h2>
			<p class="my-team-name">${escapeHtml(currentTeamName)}</p>
			<p class="players-help">Pick up to 11 players. Limits: 1 GK, 5 DEF, 5 MID, 3 FWD.</p>
			<p class="players-help" id="team-lock-status">Status: Building</p>
			<button id="lock-team-btn" type="button" class="lock-team-btn">Lock In Team</button>
			<p class="players-help" id="transfer-status">Matchday 1 Transfers: 0/3 used</p>
			<p class="players-help" id="captain-status">Captain: None</p>
			<button id="select-captain-btn" type="button" class="lock-team-btn">Select Captain</button>
			<p class="players-help" id="budget-count">Budget: £0.0 / £100.0</p>
			<div class="pitch-info-row">
				<div>
					<p class="players-help">Matchday Points: <span id="matchday-points" style="font-weight: 700; color: #059669;">0</span></p>
					<p class="players-help">Total Points: <span id="total-points" style="font-weight: 700; color: #0f172a;">0</span></p>
				</div>
				<button id="end-matchday-btn" type="button" class="end-matchday-btn" title="End matchday and accumulate points">End Matchday</button>
			</div>
			<div class="transfer-requests-section" id="transfer-requests-section" hidden><h3>Transfer Requests</h3><div id="transfer-requests"></div></div>
			<div class="football-pitch" id="selected-team"></div>
			<div class="bench-section" id="bench-section" hidden>
				<h3>Bench <span id="bench-count">0/4</span></h3>
				<p class="players-help">Pick 4 bench players. Swap to/from active team for free.</p>
				<div class="bench-players" id="bench-players"></div>
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
const matchdayPointsDisplay = document.querySelector<HTMLSpanElement>('#matchday-points')
const totalPointsDisplay = document.querySelector<HTMLSpanElement>('#total-points')
const endMatchdayBtn = document.querySelector<HTMLButtonElement>('#end-matchday-btn')
const lockTeamBtn = document.querySelector<HTMLButtonElement>('#lock-team-btn')
const selectCaptainBtn = document.querySelector<HTMLButtonElement>('#select-captain-btn')
const teamLockStatus = document.querySelector<HTMLParagraphElement>('#team-lock-status')
const transferStatus = document.querySelector<HTMLParagraphElement>('#transfer-status')
const captainStatus = document.querySelector<HTMLParagraphElement>('#captain-status')
const transferRemainingBadge = document.querySelector<HTMLParagraphElement>('#transfer-remaining-badge')

const filterPosition = document.querySelector<HTMLSelectElement>('#filter-position')
const filterMinPrice = document.querySelector<HTMLInputElement>('#filter-min-price')
const filterMaxPrice = document.querySelector<HTMLInputElement>('#filter-max-price')
const filterCountry = document.querySelector<HTMLSelectElement>('#filter-country')
const togglePlayerListBtn = document.querySelector<HTMLButtonElement>('#toggle-player-list-btn')
const searchPanelSection = document.querySelector<HTMLDivElement>('#search-panel-section')

let isPlayerListCollapsed = false

function renderPlayerListVisibility(): void {
	if (!togglePlayerListBtn || !searchPanelSection) {
		return
	}

	searchPanelSection.hidden = isPlayerListCollapsed
	togglePlayerListBtn.textContent = isPlayerListCollapsed ? 'Expand Search' : 'Collapse Search'
	togglePlayerListBtn.setAttribute('aria-expanded', String(!isPlayerListCollapsed))
}

type SavedTeamState = {
	selectedPlayerKeys: string[]
	benchPlayerKeys?: string[]
	isTeamLocked: boolean
	transfersUsedThisMatchday: number
	currentMatchday: number
	remainingBudget?: number
	captainPlayerKey?: string | null
	captainChangesThisMatchday?: number
	captainBonusTotal?: number
	manualPointsAdjustment?: number
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
	const state: SavedTeamState = {
		selectedPlayerKeys: selectedPlayers.map(playerKey),
		benchPlayerKeys: benchPlayers.map(playerKey),
		isTeamLocked,
		transfersUsedThisMatchday,
		currentMatchday,
		remainingBudget: Number(remainingBudget.toFixed(1)),
		captainPlayerKey,
		captainChangesThisMatchday,
		captainBonusTotal,
		manualPointsAdjustment,
	}

	setSharedItem(teamStateStorageKey, JSON.stringify(state))
	void refreshClaimedPlayers().then(() => { renderSearchResults() })
}

function getGlobalMatchday(): number {
	const raw = getSharedItem(globalMatchdayStorageKey)
	const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
	if (Number.isFinite(parsed) && parsed >= 1) {
		return parsed
	}

	return 1
}

function setGlobalMatchday(matchday: number): void {
	const safeMatchday = Math.max(1, Math.floor(matchday))
	setSharedItem(globalMatchdayStorageKey, String(safeMatchday))
}

function syncWithGlobalMatchday(): void {
	const globalMatchday = getGlobalMatchday()
	if (currentMatchday < globalMatchday) {
		currentMatchday = globalMatchday
		transfersUsedThisMatchday = 0
		captainChangesThisMatchday = 0
		saveTeamState()
	}
}

function loadTeamState(): void {
	syncMaxBudget()
	const raw = getSharedItem(teamStateStorageKey)
	if (!raw) {
		selectedPlayers = []
		benchPlayers = []
		isTeamLocked = false
		transfersUsedThisMatchday = 0
		currentMatchday = 1
		remainingBudget = maxBudget
		captainPlayerKey = null
		captainChangesThisMatchday = 0
		captainBonusTotal = 0
		manualPointsAdjustment = 0
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

		isTeamLocked = Boolean(state.isTeamLocked)
		transfersUsedThisMatchday = Number.isFinite(state.transfersUsedThisMatchday)
			? Math.max(0, Math.min(maxTransfersPerMatchday, state.transfersUsedThisMatchday))
			: 0
		currentMatchday = Number.isFinite(state.currentMatchday) ? Math.max(1, state.currentMatchday) : 1
		
		const allTeamPlayers = benchModeEnabled ? [...selectedPlayers, ...benchPlayers] : [...selectedPlayers]
		const playersAreEmpty = allTeamPlayers.length === 0
		remainingBudget = playersAreEmpty
			? maxBudget
			: Number.isFinite(state.remainingBudget)
				? Math.max(0, Math.min(maxBudget, Number(state.remainingBudget)))
				: Math.max(0, Number((maxBudget - getTotalPrice(allTeamPlayers)).toFixed(1)))

		normalizeBenchStateForMode()
		
		captainPlayerKey = typeof state.captainPlayerKey === 'string' ? state.captainPlayerKey : null
		captainChangesThisMatchday = Number.isFinite(state.captainChangesThisMatchday)
			? Math.max(0, Math.min(1, state.captainChangesThisMatchday ?? 0))
			: 0
		captainBonusTotal = Number.isFinite(state.captainBonusTotal) ? Math.max(0, state.captainBonusTotal ?? 0) : 0
		manualPointsAdjustment = Number.isFinite(state.manualPointsAdjustment) ? state.manualPointsAdjustment ?? 0 : 0

		if (captainPlayerKey && !selectedPlayers.some((player) => playerKey(player) === captainPlayerKey)) {
			captainPlayerKey = null
		}
	} catch {
		selectedPlayers = []
		benchPlayers = []
		isTeamLocked = false
		transfersUsedThisMatchday = 0
		currentMatchday = 1
		remainingBudget = maxBudget
		captainPlayerKey = null
		captainChangesThisMatchday = 0
		captainBonusTotal = 0
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

function getTotalPrice(players: SelectablePlayer[]): number {
	const total = players.reduce((sum, player) => sum + player.price, 0)
	return Number(total.toFixed(1))
}

function getMatchdayPoints(players: SelectablePlayer[]): number {
	const basePoints = players.reduce((sum, player) => sum + getPlayerPoints(player.name, player.team), 0)
	if (!captainPlayerKey || !players.some((player) => playerKey(player) === captainPlayerKey)) {
		return basePoints
	}

	const captain = players.find((player) => playerKey(player) === captainPlayerKey)
	if (!captain) {
		return basePoints
	}

	return basePoints + getPlayerPoints(captain.name, captain.team)
}

function getTotalPoints(players: SelectablePlayer[]): number {
	return players.reduce((sum, player) => sum + getPlayerTotalPoints(player.name, player.team), 0) + captainBonusTotal + manualPointsAdjustment
}

function canAddPlayer(player: SelectablePlayer): boolean {
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
	return countByBucket(selectedPlayers, bucket) < positionLimits[bucket]
}

function canRemovePlayer(): boolean {
	if (isDraftPhaseActive()) {
		return false
	}

	if (!isTeamLocked) {
		return true
	}

	return transfersUsedThisMatchday < maxTransfersPerMatchday
}

function canLockTeam(): boolean {
	if (isDraftPhaseActive()) {
		return false
	}

	if (benchModeEnabled) {
		return !isTeamLocked && selectedPlayers.length === maxTeamSize && benchPlayers.length === maxBenchSize
	}

	return !isTeamLocked && selectedPlayers.length === maxTeamSize
}

function canAddPlayerToBench(player: SelectablePlayer): boolean {
	if (!benchModeEnabled) {
		return false
	}

	if (benchPlayers.length >= maxBenchSize) {
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
	if (!isTeamLocked) {
		return maxTransfersPerMatchday
	}

	return Math.max(0, maxTransfersPerMatchday - transfersUsedThisMatchday)
}

function canSetCaptain(targetKey: string): boolean {
	if (!isTeamLocked) {
		return false
	}

	if (captainChangesThisMatchday >= 1) {
		return false
	}

	if (captainPlayerKey === targetKey) {
		return false
	}

	return selectedPlayers.some((player) => playerKey(player) === targetKey)
}

function canAcceptTransfer(request: TransferRequest): boolean {
	if (!request.position) {
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
	captainChangesThisMatchday = 1
	isCaptainSelectMode = false
	saveTeamState()
	renderSelectedTeam()
	renderSearchResults()
}

function applyCaptainBonusesForAllUsers(): void {
	const usernames = getAllUsernames()
	const nextStates: Record<string, string> = {}

	for (const username of usernames) {
		const storageKey = userScopedStorageKey('fantasy-football-my-team-state', username)
		const raw = getSharedItem(storageKey)
		if (!raw) {
			continue
		}

		try {
			const state = JSON.parse(raw) as SavedTeamState
			const selectedKeys = Array.isArray(state.selectedPlayerKeys) ? state.selectedPlayerKeys : []
			const locked = Boolean(state.isTeamLocked)
			const savedCaptainKey = typeof state.captainPlayerKey === 'string' ? state.captainPlayerKey : null
			const existingCaptainBonus = Number.isFinite(state.captainBonusTotal)
				? Math.max(0, state.captainBonusTotal ?? 0)
				: 0

			let captainBonusThisMatchday = 0
			if (locked && savedCaptainKey && selectedKeys.includes(savedCaptainKey)) {
				const captain = findPlayerByKey(savedCaptainKey)
				if (captain) {
					captainBonusThisMatchday = getPlayerPoints(captain.name, captain.team)
				}
			}

			const nextState: SavedTeamState = {
				...state,
				captainBonusTotal: existingCaptainBonus + captainBonusThisMatchday,
				captainChangesThisMatchday: 0,
			}

			nextStates[storageKey] = JSON.stringify(nextState)
		} catch {
			continue
		}
	}

	commitSharedStorageChanges({ set: nextStates })
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
	if (matchdayPointsDisplay) {
		matchdayPointsDisplay.textContent = `${isTeamLocked ? getMatchdayPoints(selectedPlayers) : 0}`
	}
	if (totalPointsDisplay) {
		totalPointsDisplay.textContent = `${isTeamLocked ? getTotalPoints(selectedPlayers) : 0}`
	}
	if (teamLockStatus) {
		if (isTeamLocked) {
			teamLockStatus.textContent = 'Status: Locked'
		} else if (selectedPlayers.length === maxTeamSize) {
			teamLockStatus.textContent = 'Status: Ready to lock'
		} else {
			teamLockStatus.textContent = 'Status: Building'
		}
	}
	if (lockTeamBtn) {
		lockTeamBtn.disabled = !canLockTeam()
	}
	if (transferStatus) {
		transferStatus.textContent = `Matchday ${currentMatchday} Transfers: ${transfersUsedThisMatchday}/${maxTransfersPerMatchday} used`
	}
	if (captainStatus) {
		const captain = captainPlayerKey ? selectedPlayers.find((player) => playerKey(player) === captainPlayerKey) : null
		const captainSelectedThisMatchday = isTeamLocked && captainChangesThisMatchday >= 1
		const selectionLimitInfo = captainSelectedThisMatchday ? ' | Captain already selected this matchday' : ''
		if (!captain) {
			const modeHint = isCaptainSelectMode ? ' | Click a player card to assign captain' : ''
			captainStatus.textContent = `Captain: None${isTeamLocked ? '' : ' (available after lock in)'}${selectionLimitInfo}${modeHint}`
		} else {
			const captainChangeInfo = isTeamLocked
				? ` | Captain changes this matchday: ${captainChangesThisMatchday}/1 used`
				: ''
			const modeHint = isCaptainSelectMode ? ' | Click a player card to assign captain' : ''
			captainStatus.textContent = `Captain: ${captain.name}${captainChangeInfo}${selectionLimitInfo}${modeHint}`
		}
	}
	if (selectCaptainBtn) {
		const canSelectCaptainThisMatchday = isTeamLocked && selectedPlayers.length > 0 && captainChangesThisMatchday < 1
		if (!canSelectCaptainThisMatchday) {
			isCaptainSelectMode = false
		}
		selectCaptainBtn.disabled = !canSelectCaptainThisMatchday
		selectCaptainBtn.textContent = isCaptainSelectMode ? 'Cancel Captain Select' : 'Select Captain'
	}
	if (transferRemainingBadge) {
		transferRemainingBadge.textContent = `Transfers Remaining: ${getTransfersRemaining()}`
	}
	if (endMatchdayBtn) {
		if (!isCurrentUserLee) {
			endMatchdayBtn.textContent = 'Only lee can end matchday'
			endMatchdayBtn.title = 'Only user lee can end the matchday for everyone'
		}
		endMatchdayBtn.disabled = !isTeamLocked || !isCurrentUserLee || isDraftPhaseActive()
	}

	if (selectedPlayers.length === 0) {
		selectedTeamList.innerHTML = '<p class="empty-state">No players selected yet.</p>'
		return
	}

	const goalkeepers = selectedPlayers.filter((p) => positionBucket(p.position) === 'Goalkeeper')
	const defenders = selectedPlayers.filter((p) => positionBucket(p.position) === 'Defender')
	const midfielders = selectedPlayers.filter((p) => positionBucket(p.position) === 'Midfielder')
	const forwards = selectedPlayers.filter((p) => positionBucket(p.position) === 'Forward')

	const renderRow = (label: string, players: SelectablePlayer[]): string => {
		if (players.length === 0) return ''
		const playerCards = players
			.map((player) => {
				const key = playerKey(player)
				let swapBtnMarkup = ''
				if (swapBenchKey) {
					const canSwap = canSwapWithBench(key, swapBenchKey)
					const btnClass = canSwap ? 'swap-here-btn swap-here-btn--ok' : 'swap-here-btn swap-here-btn--bad'
						swapBtnMarkup = `<button class="${btnClass}" type="button" data-pitch-key="${escapeHtml(key)}"${canSwap ? '' : ' disabled'}>${canSwap ? 'Swap Here' : "Can't Swap"}</button>`
				}
				return `
					<div class="pitch-player">
						<div class="player-card ${isCaptainSelectMode && canSetCaptain(key) ? 'captain-selectable' : ''}" data-player-key="${escapeHtml(key)}">
							${captainPlayerKey === key ? '<div class="captain-badge">C</div>' : ''}
							<div class="player-name">${escapeHtml(player.name)}</div>
							<div class="player-details">
								<div class="player-price">£${player.price.toFixed(1)}</div>
								<div class="player-flag">${getCountryFlag(player.team)}</div>
								<div class="player-points">${isTeamLocked ? getPlayerPoints(player.name, player.team) : 0}pts</div>
							</div>
							<button class="remove-player-btn" type="button" data-key="${escapeHtml(key)}" title="Remove player" ${canRemovePlayer() ? '' : 'disabled'}>×</button>
							${swapBtnMarkup}
						</div>
					</div>
				`
			})
			.join('')

		return `
			<div class="pitch-row">
				<div class="pitch-label">${label}</div>
				<div class="pitch-row-players">${playerCards}</div>
			</div>
		`
	}

	selectedTeamList.innerHTML = `
		<div class="pitch">
			${renderRow('GK', goalkeepers)}
			${renderRow('DEF', defenders)}
			${renderRow('MID', midfielders)}
			${renderRow('FWD', forwards)}
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
		benchCountEl.textContent = `0/${maxBenchSize}`
		return
	}

	benchSection.hidden = false

	benchCountEl.textContent = `${benchPlayers.length}/${maxBenchSize}`

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
							<div class="player-flag">${getCountryFlag(player.team)}</div>
							<div class="player-position">${player.position}</div>
							<div class="player-points">${isTeamLocked ? getPlayerPoints(player.name, player.team) : 0}pts</div>
						</div>
					</div>
					<button class="swap-player-btn" type="button" data-bench-key="${escapeHtml(playerKey(player))}" title="Swap with active player" ${swapBenchKey ? 'disabled' : ''}>⇄</button>
				</div>
			`,
		)
		.join('')

	benchList.innerHTML = benchMarkup
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

	searchCount.textContent = `${filtered.length} players found`

	searchResults.innerHTML = filtered
		.slice(0, 150)
		.map((player) => {
			const key = playerKey(player)
			const alreadySelected = selectedKeys.has(key)
			const benchKeys = new Set(benchPlayers.map(playerKey))
			const alreadyOnBench = benchKeys.has(key)
			const takenByOther = !alreadySelected && !alreadyOnBench && claimedKeys.has(key)
			const owner = claimedKeys.get(key) ?? null
			const hasPendingRequest = outgoingTransferRequests.some((request) => request.status === 'pending' && request.playerKey === key)
			const blockedByTurn = !alreadySelected && !alreadyOnBench && notCurrentTurn
			
			// Check if we can add to bench
			const canAddToBench = !alreadyOnBench && !alreadySelected && !takenByOther && canAddPlayerToBench(player)
			const teamIsFull = selectedPlayers.length >= maxTeamSize
			const benchIsFull = benchPlayers.length >= maxBenchSize
			
			const lockedAndNoTransfersLeft = isTeamLocked && !alreadySelected && selectedPlayers.length >= maxTeamSize && transfersUsedThisMatchday >= maxTransfersPerMatchday
			const isRequestMode = takenByOther && !isDraftPhaseActive() && owner !== null
			const canAddToActive = !alreadySelected && canAddPlayer(player)
			const disabled = alreadySelected || (!isRequestMode && (takenByOther || !canAddToActive))
			const isDisabled = disabled || lockedAndNoTransfersLeft || blockedByTurn
			
			const buttonLabel = alreadySelected
				? 'Added'
				: alreadyOnBench
					? 'On Bench'
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
			
			const requestDisabled = isRequestMode && (hasPendingRequest || selectedPlayers.length >= maxTeamSize)
			const benchDisabled = canAddToBench && benchIsFull
			const finalDisabled = isRequestMode ? requestDisabled || blockedByTurn : (canAddToBench ? benchDisabled : isDisabled)

			const totalPts = getPlayerTotalPoints(player.name, player.team)
			return `
				<li class="search-item${takenByOther ? ' player-taken' : ''}">
					<div>
						<strong>${escapeHtml(player.name)} <span class="player-price">(£${player.price.toFixed(1)})</span> <span class="player-total-pts">${totalPts} pts</span></strong>
						<div class="selected-meta">${escapeHtml(player.team)} (${escapeHtml(player.position)})</div>
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

	searchResults.addEventListener('click', async (event) => {
		const target = event.target as HTMLElement
		const requestButton = target.closest<HTMLButtonElement>('button.request-btn')
		if (requestButton) {
			const requestedPlayerKey = requestButton.dataset.key
			if (!requestedPlayerKey) {
				return
			}
			const requestedPlayer = findPlayerByKey(requestedPlayerKey)
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

			if (!canAddPlayerToBench(player)) {
				alert(`Cannot add ${player.name}. Check position limits for bench.`)
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
		if (isTeamLocked && selectedPlayers.length >= maxTeamSize && transfersUsedThisMatchday >= maxTransfersPerMatchday) {
			return
		}

		if (isDraftPhaseActive()) {
			try {
				const res = await fetch('/api/draft-pick', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ user: currentUsername, playerKey: key }),
				})
				const payload = (await res.json()) as { error?: string; currentTurn?: string | null; complete?: boolean }
				if (!res.ok) {
					alert(payload.error ?? 'Unable to save draft pick.')
					await refreshDraftMode()
					await refreshClaimedPlayers()
					renderSearchResults()
					return
				}

				selectedPlayers = [...selectedPlayers, player]
				remainingBudget = Math.max(0, Number((remainingBudget - player.price).toFixed(1)))
				saveTeamState()
				draftCurrentTurn = typeof payload.currentTurn === 'string' ? payload.currentTurn : null
				draftComplete = payload.complete === true
				renderDraftStatus()
				await refreshClaimedPlayers()
				renderSelectedTeam()
				renderSearchResults()
			} catch {
				alert('Unable to save draft pick.')
			}
			return
		}

		selectedPlayers = [...selectedPlayers, player]
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
		if (!canRemovePlayer()) {
			return
		}

		selectedPlayers = selectedPlayers.filter((player) => playerKey(player) !== key)
		const removedPlayer = findPlayerByKey(key)
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
		if (captainPlayerKey === key) {
			captainPlayerKey = null
		}
		if (isTeamLocked) {
			transfersUsedThisMatchday += 1
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

	if (endMatchdayBtn) {
		endMatchdayBtn.addEventListener('click', () => {
			if (!isTeamLocked || !isCurrentUserLee) {
				return
			}
			if (captainPlayerKey) {
				const captain = selectedPlayers.find((player) => playerKey(player) === captainPlayerKey)
				if (captain) {
					captainBonusTotal += getPlayerPoints(captain.name, captain.team)
				}
			}
			applyCaptainBonusesForAllUsers()
			addMatchdayPointsToTotal()
			const nextMatchday = getGlobalMatchday() + 1
			setGlobalMatchday(nextMatchday)
			currentMatchday = nextMatchday
			transfersUsedThisMatchday = 0
			captainChangesThisMatchday = 0
			saveTeamState()
			renderSelectedTeam()
			renderSearchResults()
		})
	}

	if (lockTeamBtn) {
		lockTeamBtn.addEventListener('click', () => {
			if (!canLockTeam()) {
				return
			}

			isTeamLocked = true
			saveTeamState()
			renderSelectedTeam()
			renderSearchResults()
		})
	}

	if (selectCaptainBtn) {
		selectCaptainBtn.addEventListener('click', () => {
			if (!isTeamLocked || selectedPlayers.length === 0 || captainChangesThisMatchday >= 1) {
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
			event.key === globalMatchdayStorageKey ||
			event.key === globalBudgetStorageKey
		) {
			if (event.key === globalBudgetStorageKey) {
				syncMaxBudget()
			}
			syncWithGlobalMatchday()
			refreshLivePointsView()
		}
	})
	window.addEventListener(sharedLeagueUpdatedEvent, () => {
		loadTeamState()
		syncWithGlobalMatchday()
		void refreshClaimedPlayers().then(() => refreshLivePointsView())
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
					alert(`Cannot accept: accepting this player would exceed the position limit for ${targetRequest.position}.`)
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
			syncWithGlobalMatchday()
			refreshLivePointsView()
			void refreshTransferRequests()
		}
	})

	loadTeamState()
	setGlobalMatchday(getGlobalMatchday())
	syncWithGlobalMatchday()
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
