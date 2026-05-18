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
const maxBudget = 100
const maxTransfersPerMatchday = 3
const currentUsername = requireAuth()
const isCurrentUserLee = currentUsername.toLowerCase() === 'lee'
const currentTeamName = getTeamNameForUser(currentUsername) ?? 'Unnamed Team'
const teamStateStorageKey = userScopedStorageKey('fantasy-football-my-team-state', currentUsername)
const globalMatchdayStorageKey = 'fantasy-football-global-matchday'
const positionLimits: Record<string, number> = {
	Goalkeeper: 1,
	Defender: 5,
	Midfielder: 5,
	Forward: 3,
}

const allPlayers = getAllPlayers()
const minimumPlayerPrice = allPlayers.reduce((min, player) => Math.min(min, player.price), Number.POSITIVE_INFINITY)
let selectedPlayers: SelectablePlayer[] = []
let isTeamLocked = false
let transfersUsedThisMatchday = 0
let currentMatchday = 1
let captainPlayerKey: string | null = null
let captainChangesThisMatchday = 0
let captainBonusTotal = 0
let manualPointsAdjustment = 0
let isCaptainSelectMode = false

// Extract unique positions and countries from all players
const uniquePositions = Array.from(new Set(allPlayers.map((p) => p.position))).sort()
const uniqueCountries = Array.from(new Set(allPlayers.map((p) => p.team))).sort()

const myTeamMarkup = `
	<section class="my-team-grid">
		<div class="my-team-panel">
			<h2>Search Players</h2>
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

			<p class="players-help" id="search-count"></p>
			<ul class="search-results" id="search-results"></ul>
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
			<div class="football-pitch" id="selected-team"></div>
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

type SavedTeamState = {
	selectedPlayerKeys: string[]
	isTeamLocked: boolean
	transfersUsedThisMatchday: number
	currentMatchday: number
	captainPlayerKey?: string | null
	captainChangesThisMatchday?: number
	captainBonusTotal?: number
	manualPointsAdjustment?: number
}

function saveTeamState(): void {
	const state: SavedTeamState = {
		selectedPlayerKeys: selectedPlayers.map(playerKey),
		isTeamLocked,
		transfersUsedThisMatchday,
		currentMatchday,
		captainPlayerKey,
		captainChangesThisMatchday,
		captainBonusTotal,
		manualPointsAdjustment,
	}

	setSharedItem(teamStateStorageKey, JSON.stringify(state))
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
	const raw = getSharedItem(teamStateStorageKey)
	if (!raw) {
		selectedPlayers = []
		isTeamLocked = false
		transfersUsedThisMatchday = 0
		currentMatchday = 1
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

		isTeamLocked = Boolean(state.isTeamLocked)
		transfersUsedThisMatchday = Number.isFinite(state.transfersUsedThisMatchday)
			? Math.max(0, Math.min(maxTransfersPerMatchday, state.transfersUsedThisMatchday))
			: 0
		currentMatchday = Number.isFinite(state.currentMatchday) ? Math.max(1, state.currentMatchday) : 1
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
		isTeamLocked = false
		transfersUsedThisMatchday = 0
		currentMatchday = 1
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

	const totalAfterAdding = getTotalPrice(selectedPlayers) + player.price
	if (totalAfterAdding > maxBudget) {
		return false
	}

	// Avoid budget dead-ends where the team cannot be completed to 11 players.
	const remainingSlotsAfterAdding = maxTeamSize - (selectedPlayers.length + 1)
	const minimumBudgetNeededForRemainingSlots =
		remainingSlotsAfterAdding > 0 && Number.isFinite(minimumPlayerPrice)
			? remainingSlotsAfterAdding * minimumPlayerPrice
			: 0
	if (totalAfterAdding + minimumBudgetNeededForRemainingSlots > maxBudget) {
		return false
	}

	const bucket = positionBucket(player.position)
	return countByBucket(selectedPlayers, bucket) < positionLimits[bucket]
}

function canRemovePlayer(): boolean {
	if (!isTeamLocked) {
		return true
	}

	return transfersUsedThisMatchday < maxTransfersPerMatchday
}

function canLockTeam(): boolean {
	return !isTeamLocked && selectedPlayers.length === maxTeamSize
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
		budgetCount.textContent = `Budget: £${getTotalPrice(selectedPlayers).toFixed(1)} / £${maxBudget.toFixed(1)}`
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
		endMatchdayBtn.disabled = !isTeamLocked || !isCurrentUserLee
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
			.map(
				(player) => `
					<div class="pitch-player">
						<div class="player-card ${isCaptainSelectMode && canSetCaptain(playerKey(player)) ? 'captain-selectable' : ''}" data-player-key="${escapeHtml(playerKey(player))}">
							${captainPlayerKey === playerKey(player) ? '<div class="captain-badge">C</div>' : ''}
							<div class="player-name">${escapeHtml(player.name)}</div>
							<div class="player-details">
								<div class="player-price">£${player.price.toFixed(1)}</div>
								<div class="player-flag">${getCountryFlag(player.team)}</div>
								<div class="player-points">${isTeamLocked ? getPlayerPoints(player.name, player.team) : 0}pts</div>
							</div>
							<button class="remove-player-btn" type="button" data-key="${escapeHtml(playerKey(player))}" title="Remove player" ${canRemovePlayer() ? '' : 'disabled'}>×</button>
						</div>
					</div>
				`,
			)
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

function renderSearchResults(): void {
	if (!searchInput || !searchResults || !searchCount) {
		return
	}

	const query = searchInput.value.trim().toLowerCase()
	const selectedKeys = new Set(selectedPlayers.map(playerKey))

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
			// Only block adding when team is full AND no transfers remain.
			// If the team has a free slot (player was removed), adding is always allowed.
			const lockedAndNoTransfersLeft = isTeamLocked && !alreadySelected && selectedPlayers.length >= maxTeamSize && transfersUsedThisMatchday >= maxTransfersPerMatchday
			const disabled = alreadySelected || !canAddPlayer(player)
			const isDisabled = disabled || lockedAndNoTransfersLeft
			const buttonLabel = alreadySelected ? 'Added' : 'Add'

			return `
				<li class="search-item">
					<div>
						<strong>${escapeHtml(player.name)} <span class="player-price">(£${player.price.toFixed(1)})</span></strong>
						<div class="selected-meta">${escapeHtml(player.team)} (${escapeHtml(player.position)})</div>
					</div>
					<button class="add-btn" type="button" data-key="${escapeHtml(key)}" ${isDisabled ? 'disabled' : ''}>${buttonLabel}</button>
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
	renderSearchResults()
}

if (searchInput && searchResults && selectedTeamList) {
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

	searchResults.addEventListener('click', (event) => {
		const target = event.target as HTMLElement
		const button = target.closest<HTMLButtonElement>('button.add-btn')
		if (!button) {
			return
		}

		const key = button.dataset.key
		if (!key) {
			return
		}

		const player = findPlayerByKey(key)
		if (!player || selectedPlayers.some((item) => playerKey(item) === key)) {
			return
		}

		if (!canAddPlayer(player)) {
			return
		}
		if (isTeamLocked && selectedPlayers.length >= maxTeamSize && transfersUsedThisMatchday >= maxTransfersPerMatchday) {
			return
		}

		selectedPlayers = [...selectedPlayers, player]
		saveTeamState()
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
			event.key === globalMatchdayStorageKey
		) {
			syncWithGlobalMatchday()
			refreshLivePointsView()
		}
	})
	window.addEventListener(sharedLeagueUpdatedEvent, () => {
		loadTeamState()
		syncWithGlobalMatchday()
		refreshLivePointsView()
	})
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') {
			loadTeamState()
			syncWithGlobalMatchday()
			refreshLivePointsView()
		}
	})

	loadTeamState()
	setGlobalMatchday(getGlobalMatchday())
	syncWithGlobalMatchday()
	renderSelectedTeam()
	renderSearchResults()
}
