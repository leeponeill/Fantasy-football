import { bootstrapSharedLeagueStorage, commitSharedStorageChanges, getSharedItem, setSharedItem } from './sharedLeague'
import { getPlayerPoints, getTotalAccumulatedPoints } from './teamsData'
import { getTransferAwareMatchdayPoints, getTransferAwarePlayerCurrentPoints, parseTransferPointEvents } from './transferPoints'

await bootstrapSharedLeagueStorage()

type StoredUser = {
  username: string
  password: string
}

type UserProfile = {
  teamName: string
}

type UserProfiles = Record<string, UserProfile>
type PasswordResetRequests = string[]

const usersStorageKey = 'fantasy-football-users'
const currentUserStorageKey = 'fantasy-football-current-user'
const userProfilesStorageKey = 'fantasy-football-user-profiles'
const passwordResetRequestsStorageKey = 'fantasy-football-password-reset-requests'
const globalBudgetStorageKey = 'fantasy-football-global-budget'
const maxBudget = 100
const maxUsers = 10

function redirectIfNeeded(redirectPath: string): void {
  if (window.location.pathname === redirectPath) {
    return
  }

  window.location.replace(redirectPath)
}

function readUsers(): StoredUser[] {
  const raw = getSharedItem(usersStorageKey)
  if (!raw) {
    return []
  }

  try {
    const parsed = JSON.parse(raw) as StoredUser[]
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed
      .filter((user) => typeof user?.username === 'string' && typeof user?.password === 'string')
      .map((user) => ({ username: user.username, password: user.password }))
  } catch {
    return []
  }
}

function readProfiles(): UserProfiles {
  const raw = getSharedItem(userProfilesStorageKey)
  if (!raw) {
    return {}
  }

  try {
    const parsed = JSON.parse(raw) as UserProfiles
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }

    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([username, profile]) =>
          typeof username === 'string' &&
          !!profile &&
          typeof profile === 'object' &&
          typeof (profile as UserProfile).teamName === 'string',
      ),
    ) as UserProfiles
  } catch {
    return {}
  }
}

function readPasswordResetRequests(): PasswordResetRequests {
  const raw = getSharedItem(passwordResetRequestsStorageKey)
  if (!raw) {
    return []
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter((value): value is string => typeof value === 'string')
  } catch {
    return []
  }
}

function safeGetStorageItem(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSetStorageItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

function normalizeUsername(username: string): string {
  return username.trim()
}

export function getRegisteredUserCount(): number {
  return readUsers().length
}

export function getAllUsernames(): string[] {
  return readUsers().map((user) => user.username)
}

export function getCurrentUsername(): string | null {
  const username = safeGetStorageItem(currentUserStorageKey)
  return username ? username : null
}

export function signOut(): void {
  try {
    localStorage.removeItem(currentUserStorageKey)
  } catch {
    // Ignore storage failures on sign-out.
  }
}

export function signIn(username: string, password: string): { ok: boolean; error?: string } {
  const normalizedUsername = normalizeUsername(username)
  const users = readUsers()
  const user = users.find(
    (item) => item.username.toLowerCase() === normalizedUsername.toLowerCase(),
  )

  if (!user || user.password !== password) {
    return { ok: false, error: 'Invalid username or password.' }
  }

  if (!safeSetStorageItem(currentUserStorageKey, user.username)) {
    return { ok: false, error: 'Browser storage is blocked. Enable site data/cookies for this domain.' }
  }

  const persistedUsername = safeGetStorageItem(currentUserStorageKey)
  if (persistedUsername !== user.username) {
    return { ok: false, error: 'Sign-in session could not be saved for this domain.' }
  }

  return { ok: true }
}

export function registerUser(username: string, password: string): { ok: boolean; error?: string } {
  const normalizedUsername = normalizeUsername(username)
  const users = readUsers()

  if (normalizedUsername.length < 3) {
    return { ok: false, error: 'Username must be at least 3 characters.' }
  }

  if (password.length < 4) {
    return { ok: false, error: 'Password must be at least 4 characters.' }
  }

  if (users.length >= maxUsers) {
    return { ok: false, error: 'Maximum of 10 users reached.' }
  }

  const exists = users.some(
    (item) => item.username.toLowerCase() === normalizedUsername.toLowerCase(),
  )
  if (exists) {
    return { ok: false, error: 'That username is already taken.' }
  }

  users.push({ username: normalizedUsername, password })
  const didWriteUsers = setSharedItem(usersStorageKey, JSON.stringify(users))
  if (!didWriteUsers) {
    return { ok: false, error: 'Cannot save users. Browser storage is blocked for this site.' }
  }

  return { ok: true }
}

export function requireAuth(redirectPath = '/index.html'): string {
  const username = getCurrentUsername()
  if (!username) {
    redirectIfNeeded(redirectPath)
    throw new Error('Authentication required')
  }

  return username
}

export function userScopedStorageKey(baseKey: string, username?: string): string {
  const effectiveUsername = username ?? getCurrentUsername() ?? 'guest'
  return `${baseKey}::${effectiveUsername}`
}

export function getTeamNameForUser(username: string): string | null {
  const profiles = readProfiles()
  const profile = profiles[username]
  if (!profile) {
    return null
  }

  const name = profile.teamName.trim()
  return name.length > 0 ? name : null
}

export function getCurrentUserTeamName(): string | null {
  const username = getCurrentUsername()
  if (!username) {
    return null
  }

  return getTeamNameForUser(username)
}

export function setCurrentUserTeamName(teamName: string): { ok: boolean; error?: string } {
  const username = getCurrentUsername()
  if (!username) {
    return { ok: false, error: 'No signed in user.' }
  }

  const normalizedTeamName = teamName.trim()
  if (normalizedTeamName.length < 2) {
    return { ok: false, error: 'Team name must be at least 2 characters.' }
  }

  const existing = getTeamNameForUser(username)
  if (existing) {
    return { ok: false, error: 'Team name is already set and cannot be changed.' }
  }

  const profiles = readProfiles()
  profiles[username] = { teamName: normalizedTeamName }
  const didWriteProfiles = setSharedItem(userProfilesStorageKey, JSON.stringify(profiles))
  if (!didWriteProfiles) {
    return { ok: false, error: 'Cannot save team name. Browser storage is blocked for this site.' }
  }

  return { ok: true }
}

export function setTeamNameForUser(username: string, teamName: string): { ok: boolean; error?: string } {
  const normalizedUsername = username.trim()
  const normalizedTeamName = teamName.trim()

  if (normalizedUsername.length === 0) {
    return { ok: false, error: 'Username is required.' }
  }

  if (normalizedTeamName.length < 2) {
    return { ok: false, error: 'Team name must be at least 2 characters.' }
  }

  const users = readUsers()
  const existingUser = users.find(
    (user) => user.username.toLowerCase() === normalizedUsername.toLowerCase(),
  )

  if (!existingUser) {
    return { ok: false, error: 'User not found.' }
  }

  const profiles = readProfiles()
  profiles[existingUser.username] = { teamName: normalizedTeamName }
  const didWriteProfiles = setSharedItem(userProfilesStorageKey, JSON.stringify(profiles))
  if (!didWriteProfiles) {
    return { ok: false, error: 'Cannot save team name. Browser storage is blocked for this site.' }
  }

  return { ok: true }
}

export function requireCurrentUserTeamName(redirectPath = '/team-setup.html'): string {
  const username = requireAuth()
  const teamName = getTeamNameForUser(username)
  if (!teamName) {
    redirectIfNeeded(redirectPath)
    throw new Error('Team name required')
  }

  return teamName
}

export function clearAllUsersAndTeams(): void {
  const usernames = getAllUsernames()
  const removeKeys = [
    usersStorageKey,
    userProfilesStorageKey,
    passwordResetRequestsStorageKey,
    'fantasy-football-global-matchday',
    globalBudgetStorageKey,
    'fantasy-football-transfer-history',
  ]

  for (const username of usernames) {
    removeKeys.push(userScopedStorageKey('fantasy-football-my-team-state', username))
  }

  localStorage.removeItem(currentUserStorageKey)
  commitSharedStorageChanges({ remove: removeKeys })
}

export function requestPasswordReset(username: string): { ok: boolean; error?: string } {
  const normalizedUsername = username.trim()
  if (normalizedUsername.length === 0) {
    return { ok: false, error: 'Username is required.' }
  }

  const users = readUsers()
  const existingUser = users.find(
    (user) => user.username.toLowerCase() === normalizedUsername.toLowerCase(),
  )

  if (!existingUser) {
    return { ok: false, error: 'User not found.' }
  }

  const requests = readPasswordResetRequests()
  if (!requests.some((name) => name.toLowerCase() === existingUser.username.toLowerCase())) {
    requests.push(existingUser.username)
  }

  const didSave = setSharedItem(passwordResetRequestsStorageKey, JSON.stringify(requests))
  if (!didSave) {
    return { ok: false, error: 'Unable to save reset request.' }
  }

  return { ok: true }
}

export function getPasswordResetRequests(): string[] {
  return readPasswordResetRequests()
}

export function resetUserPassword(username: string, newPassword: string): { ok: boolean; error?: string } {
  const normalizedUsername = username.trim()
  const normalizedPassword = newPassword.trim()

  if (normalizedUsername.length === 0) {
    return { ok: false, error: 'Username is required.' }
  }

  if (normalizedPassword.length < 4) {
    return { ok: false, error: 'Password must be at least 4 characters.' }
  }

  const users = readUsers()
  const userIndex = users.findIndex(
    (user) => user.username.toLowerCase() === normalizedUsername.toLowerCase(),
  )

  if (userIndex === -1) {
    return { ok: false, error: 'User not found.' }
  }

  const canonicalUsername = users[userIndex].username
  users[userIndex] = {
    ...users[userIndex],
    password: normalizedPassword,
  }

  const didSaveUsers = setSharedItem(usersStorageKey, JSON.stringify(users))
  if (!didSaveUsers) {
    return { ok: false, error: 'Unable to save new password.' }
  }

  const remainingRequests = readPasswordResetRequests().filter(
    (name) => name.toLowerCase() !== canonicalUsername.toLowerCase(),
  )
  setSharedItem(passwordResetRequestsStorageKey, JSON.stringify(remainingRequests))

  return { ok: true }
}

export function adjustUserPoints(username: string, adjustment: number): { ok: boolean; error?: string } {
  const normalizedUsername = username.trim()
  if (normalizedUsername.length === 0) {
    return { ok: false, error: 'Username is required.' }
  }

  const users = readUsers()
  const existingUser = users.find(
    (user) => user.username.toLowerCase() === normalizedUsername.toLowerCase(),
  )

  if (!existingUser) {
    return { ok: false, error: 'User not found.' }
  }

  const storageKey = userScopedStorageKey('fantasy-football-my-team-state', existingUser.username)
  const raw = getSharedItem(storageKey)

  let currentAdjustment = 0
  if (raw) {
    try {
      const state = JSON.parse(raw) as Record<string, unknown>
      currentAdjustment = Number.isFinite(state.manualPointsAdjustment as number)
        ? (state.manualPointsAdjustment as number)
        : 0
    } catch {
      currentAdjustment = 0
    }
  }

  const newAdjustment = currentAdjustment + adjustment

  if (raw) {
    try {
      const state = JSON.parse(raw) as Record<string, unknown>
      state.manualPointsAdjustment = newAdjustment
      setSharedItem(storageKey, JSON.stringify(state))
      return { ok: true }
    } catch {
      return { ok: false, error: 'Unable to update user points.' }
    }
  }

  return { ok: true }
}

function readUserTeamPlayerCounts(username: string): { selected: number; bench: number } {
  const storageKey = userScopedStorageKey('fantasy-football-my-team-state', username)
  const raw = getSharedItem(storageKey)

  if (!raw) {
    return { selected: 0, bench: 0 }
  }

  try {
    const state = JSON.parse(raw) as Record<string, unknown>
    const selected = Array.isArray(state.selectedPlayerKeys)
      ? state.selectedPlayerKeys.filter((value) => typeof value === 'string').length
      : 0
    const bench = Array.isArray(state.benchPlayerKeys)
      ? state.benchPlayerKeys.filter((value) => typeof value === 'string').length
      : 0

    return { selected, bench }
  } catch {
    return { selected: 0, bench: 0 }
  }
}

export function canAdjustUserBudgets(): boolean {
  const usernames = getAllUsernames()
  return usernames.every((username) => {
    const counts = readUserTeamPlayerCounts(username)
    return counts.selected === 0 && counts.bench === 0
  })
}

export function getGlobalBudget(): number {
  const raw = getSharedItem(globalBudgetStorageKey)
  const parsed = raw ? Number.parseFloat(raw) : Number.NaN
  if (!Number.isFinite(parsed)) {
    return maxBudget
  }

  return Math.max(1, Number(parsed.toFixed(1)))
}

export function adjustGlobalBudget(adjustment: number): { ok: boolean; error?: string } {
  if (!canAdjustUserBudgets()) {
    return { ok: false, error: 'Budget can only be changed when all users have empty teams.' }
  }

  const currentBudget = getGlobalBudget()
  const nextBudget = Math.max(1, Number((currentBudget + adjustment).toFixed(1)))
  const didSave = setSharedItem(globalBudgetStorageKey, String(nextBudget))
  if (!didSave) {
    return { ok: false, error: 'Unable to update global budget.' }
  }

  return { ok: true }
}

export function getUserTotalPoints(username: string): number {
  const normalizedUsername = username.trim()
  const users = readUsers()
  const existingUser = users.find(
    (user) => user.username.toLowerCase() === normalizedUsername.toLowerCase(),
  )

  if (!existingUser) {
    return 0
  }

  const storageKey = userScopedStorageKey('fantasy-football-my-team-state', existingUser.username)
  const raw = getSharedItem(storageKey)

  if (!raw) {
    return 0
  }

  try {
    const state = JSON.parse(raw) as Record<string, unknown>
    const manualAdjustment = Number.isFinite(state.manualPointsAdjustment as number)
      ? (state.manualPointsAdjustment as number)
      : 0
    const captainBonusTotal = Number.isFinite(state.captainBonusTotal as number)
      ? (state.captainBonusTotal as number)
      : 0
    const currentMatchday = Number.isFinite(state.currentMatchday as number)
      ? Math.max(1, Number(state.currentMatchday as number))
      : 1
    const transferPointEvents = parseTransferPointEvents(state.transferPointEvents)
    const selectedPlayerKeys = Array.isArray(state.selectedPlayerKeys)
      ? state.selectedPlayerKeys.filter((value): value is string => typeof value === 'string')
      : []

    const getCurrentPointsByPlayerKey = (playerKey: string): number => {
      const parts = playerKey.split('::')
      if (parts.length < 2) {
        return 0
      }

      const teamName = parts[0]
      const playerName = parts.slice(1).join('::')
      return getPlayerPoints(playerName, teamName)
    }

    let playerPointsTotal = 0
    let currentSelectedRawPoints = 0
    for (const playerKey of selectedPlayerKeys) {
      const parts = playerKey.split('::')
      if (parts.length < 2) {
        continue
      }

      const teamName = parts[0]
      const playerName = parts.slice(1).join('::')
      playerPointsTotal += getTotalAccumulatedPoints(playerName, teamName)
      const currentPoints = getPlayerPoints(playerName, teamName)
      playerPointsTotal += currentPoints
      currentSelectedRawPoints += currentPoints
    }

    const transferAwareCurrentPoints = getTransferAwareMatchdayPoints(
      selectedPlayerKeys,
      currentMatchday,
      transferPointEvents,
      getCurrentPointsByPlayerKey,
    )
    playerPointsTotal = playerPointsTotal - currentSelectedRawPoints + transferAwareCurrentPoints

    let captainCurrentBonus = 0
    const captainPlayerKey = typeof state.captainPlayerKey === 'string' ? state.captainPlayerKey : null
    const isTeamLocked = state.isTeamLocked === true
    if (isTeamLocked && captainPlayerKey && selectedPlayerKeys.includes(captainPlayerKey)) {
      const captainParts = captainPlayerKey.split('::')
      if (captainParts.length >= 2) {
        captainCurrentBonus = getTransferAwarePlayerCurrentPoints(
          captainPlayerKey,
          selectedPlayerKeys,
          currentMatchday,
          transferPointEvents,
          getCurrentPointsByPlayerKey,
        )
      }
    }

    return playerPointsTotal + captainBonusTotal + captainCurrentBonus + manualAdjustment
  } catch {
    return 0
  }
}
