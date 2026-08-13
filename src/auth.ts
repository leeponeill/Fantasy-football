import {
  bootstrapSharedLeagueStorage,
  commitSharedStorageChanges,
  getSharedItem,
  removeSharedItem,
  setSharedItem,
  sharedLeagueUpdatedEvent,
} from './sharedLeague'
import { getCurrentGameweekPlayerPoints } from './teamsData'
import { getTransferAwareGameweekPoints, getTransferAwarePlayerCurrentPoints, parseTransferPointEvents } from './transferPoints'

await bootstrapSharedLeagueStorage()

window.addEventListener(sharedLeagueUpdatedEvent, () => {
  const currentUser = safeGetStorageItem(currentUserStorageKey)
  if (!currentUser) {
    return
  }

  if (isCurrentSessionForceSignedOut()) {
    signOut()
    redirectIfNeeded('/index.html')
  }
})

type StoredUser = {
  username: string
  password: string
}

type UserProfile = {
  teamName: string
  theme?: 'light' | 'dark'
  teamTileDisplayMode?: 'flag' | 'name'
}

type UserProfiles = Record<string, UserProfile>
type PasswordResetRequests = string[]
export type AdminNotification = {
  id: string
  message: string
  createdAt: string
  senderUsername: string
  seenBy: string[]
}
export const maxActiveAdminNotifications = 5

const usersStorageKey = 'fantasy-football-users'
const currentUserStorageKey = 'fantasy-football-current-user'
const forceSignOutVersionStorageKey = 'fantasy-football-force-signout-version'
const seenForceSignOutVersionStorageKey = 'fantasy-football-seen-force-signout-version'
const userProfilesStorageKey = 'fantasy-football-user-profiles'
const passwordResetRequestsStorageKey = 'fantasy-football-password-reset-requests'
const adminNotificationStorageKey = 'fantasy-football-admin-notification'
const globalBudgetStorageKey = 'fantasy-football-global-budget'
const maxBudget = 100
export const maxUsers = 50

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
          typeof (profile as UserProfile).teamName === 'string' &&
          (typeof (profile as UserProfile).theme === 'undefined' ||
            (profile as UserProfile).theme === 'light' ||
            (profile as UserProfile).theme === 'dark') &&
          (typeof (profile as UserProfile).teamTileDisplayMode === 'undefined' ||
            (profile as UserProfile).teamTileDisplayMode === 'flag' ||
            (profile as UserProfile).teamTileDisplayMode === 'name'),
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

function normalizeUniqueUsernames(usernames: string[]): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const username of usernames) {
    const trimmedUsername = username.trim()
    if (trimmedUsername.length === 0) {
      continue
    }

    const key = trimmedUsername.toLowerCase()
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    normalized.push(trimmedUsername)
  }

  return normalized
}

function parseAdminNotification(value: unknown): AdminNotification | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const parsed = value as Partial<AdminNotification>
  const id = typeof parsed.id === 'string' ? parsed.id.trim() : ''
  const message = typeof parsed.message === 'string' ? parsed.message.trim() : ''
  const createdAt = typeof parsed.createdAt === 'string' ? parsed.createdAt : ''
  const senderUsername = typeof parsed.senderUsername === 'string' ? parsed.senderUsername.trim() : ''
  const seenBy = Array.isArray(parsed.seenBy)
    ? normalizeUniqueUsernames(parsed.seenBy.filter((entry): entry is string => typeof entry === 'string'))
    : []

  if (id.length === 0 || message.length === 0 || senderUsername.length === 0) {
    return null
  }

  return {
    id,
    message,
    createdAt,
    senderUsername,
    seenBy,
  }
}

function readAdminNotifications(): AdminNotification[] {
  const raw = getSharedItem(adminNotificationStorageKey)
  if (!raw) {
    return []
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) {
      return parsed
        .map((entry) => parseAdminNotification(entry))
        .filter((entry): entry is AdminNotification => entry !== null)
        .slice(0, maxActiveAdminNotifications)
    }

    const singleNotification = parseAdminNotification(parsed)
    return singleNotification ? [singleNotification] : []
  } catch {
    return []
  }
}

function writeAdminNotifications(notifications: AdminNotification[]): boolean {
  if (notifications.length === 0) {
    return removeSharedItem(adminNotificationStorageKey)
  }

  return setSharedItem(
    adminNotificationStorageKey,
    JSON.stringify(
      notifications.slice(0, maxActiveAdminNotifications).map((notification) => ({
        ...notification,
        seenBy: normalizeUniqueUsernames(notification.seenBy),
      })),
    ),
  )
}

function hasUsernameSeenNotification(notification: AdminNotification, username: string): boolean {
  return notification.seenBy.some((seenUsername) => seenUsername.toLowerCase() === username.toLowerCase())
}

function renameNotificationUser(
  notification: AdminNotification,
  currentUsername: string,
  nextUsername: string,
): AdminNotification {
  const nextSeenBy = notification.seenBy.map((seenUsername) => (
    seenUsername.toLowerCase() === currentUsername.toLowerCase() ? nextUsername : seenUsername
  ))

  return {
    ...notification,
    senderUsername: notification.senderUsername.toLowerCase() === currentUsername.toLowerCase()
      ? nextUsername
      : notification.senderUsername,
    seenBy: normalizeUniqueUsernames(nextSeenBy),
  }
}

function removeNotificationUser(notification: AdminNotification, username: string): AdminNotification {
  return {
    ...notification,
    seenBy: notification.seenBy.filter((seenUsername) => seenUsername.toLowerCase() !== username.toLowerCase()),
  }
}

function renameNotificationUsers(
  notifications: AdminNotification[],
  currentUsername: string,
  nextUsername: string,
): AdminNotification[] {
  return notifications.map((notification) => renameNotificationUser(notification, currentUsername, nextUsername))
}

function removeNotificationUsers(notifications: AdminNotification[], username: string): AdminNotification[] {
  return notifications.map((notification) => removeNotificationUser(notification, username))
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

function isCurrentSessionForceSignedOut(): boolean {
  const currentUsername = safeGetStorageItem(currentUserStorageKey)
  if (!currentUsername) {
    return false
  }

  const forceSignOutVersion = getSharedItem(forceSignOutVersionStorageKey)
  if (typeof forceSignOutVersion !== 'string' || forceSignOutVersion.length === 0) {
    return false
  }

  const seenForceSignOutVersion = safeGetStorageItem(seenForceSignOutVersionStorageKey)
  if (seenForceSignOutVersion === forceSignOutVersion) {
    return false
  }

  const userStillExists = readUsers().some(
    (user) => user.username.toLowerCase() === currentUsername.toLowerCase(),
  )
  if (userStillExists) {
    // This is a valid current user (for example, newly created after reset).
    safeSetStorageItem(seenForceSignOutVersionStorageKey, forceSignOutVersion)
    return false
  }

  return true
}

export function getRegisteredUserCount(): number {
  return readUsers().length
}

export function getAllUsernames(): string[] {
  return readUsers().map((user) => user.username)
}

export function getCurrentUsername(): string | null {
  const username = safeGetStorageItem(currentUserStorageKey)
  if (!username) {
    return null
  }

  if (isCurrentSessionForceSignedOut()) {
    signOut()
    return null
  }

  return username ? username : null
}

export function signOut(): void {
  try {
    localStorage.removeItem(currentUserStorageKey)
    const forceSignOutVersion = getSharedItem(forceSignOutVersionStorageKey)
    if (typeof forceSignOutVersion === 'string' && forceSignOutVersion.length > 0) {
      localStorage.setItem(seenForceSignOutVersionStorageKey, forceSignOutVersion)
    }
  } catch {
    // Ignore storage failures on sign-out.
  }
}

export function signIn(username: string, password: string): { ok: boolean; error?: string; username?: string } {
  const normalizedUsername = normalizeUsername(username)
  const trimmedPassword = password.trim()
  const users = readUsers()
  const user = users.find(
    (item) => item.username.toLowerCase() === normalizedUsername.toLowerCase(),
  )

  if (!user || (user.password !== password && user.password !== trimmedPassword)) {
    return { ok: false, error: 'Invalid username or password.' }
  }

  if (!safeSetStorageItem(currentUserStorageKey, user.username)) {
    return { ok: false, error: 'Browser storage is blocked. Enable site data/cookies for this domain.' }
  }

  const persistedUsername = safeGetStorageItem(currentUserStorageKey)
  if (persistedUsername !== user.username) {
    return { ok: false, error: 'Sign-in session could not be saved for this domain.' }
  }

  const forceSignOutVersion = getSharedItem(forceSignOutVersionStorageKey)
  if (typeof forceSignOutVersion === 'string' && forceSignOutVersion.length > 0) {
    safeSetStorageItem(seenForceSignOutVersionStorageKey, forceSignOutVersion)
  }

  return { ok: true, username: user.username }
}

export function registerUser(username: string, password: string): { ok: boolean; error?: string } {
  const normalizedUsername = normalizeUsername(username)
  const normalizedPassword = password.trim()
  const users = readUsers()

  if (normalizedUsername.length < 3) {
    return { ok: false, error: 'Username must be at least 3 characters.' }
  }

  if (normalizedPassword.length < 4) {
    return { ok: false, error: 'Password must be at least 4 characters.' }
  }

  if (users.length >= maxUsers) {
    return { ok: false, error: `Maximum of ${maxUsers} users reached.` }
  }

  const exists = users.some(
    (item) => item.username.toLowerCase() === normalizedUsername.toLowerCase(),
  )
  if (exists) {
    return { ok: false, error: 'That username is already taken.' }
  }

  users.push({ username: normalizedUsername, password: normalizedPassword })
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
  const existingProfile = profiles[username]
  profiles[username] = {
    ...existingProfile,
    teamName: normalizedTeamName,
  }
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
  const existingProfile = profiles[existingUser.username]
  profiles[existingUser.username] = {
    ...existingProfile,
    teamName: normalizedTeamName,
  }
  const didWriteProfiles = setSharedItem(userProfilesStorageKey, JSON.stringify(profiles))
  if (!didWriteProfiles) {
    return { ok: false, error: 'Cannot save team name. Browser storage is blocked for this site.' }
  }

  return { ok: true }
}

export function getThemePreferenceForUser(username: string): 'light' | 'dark' | null {
  const profiles = readProfiles()
  const profile = profiles[username]
  if (!profile) {
    return null
  }

  if (profile.theme === 'light' || profile.theme === 'dark') {
    return profile.theme
  }

  return null
}

export function setCurrentUserThemePreference(theme: 'light' | 'dark'): { ok: boolean; error?: string } {
  const username = getCurrentUsername()
  if (!username) {
    return { ok: false, error: 'No signed in user.' }
  }

  const profiles = readProfiles()
  const existingProfile = profiles[username]
  profiles[username] = {
    ...existingProfile,
    teamName: existingProfile?.teamName ?? '',
    theme,
  }

  const didWriteProfiles = setSharedItem(userProfilesStorageKey, JSON.stringify(profiles))
  if (!didWriteProfiles) {
    return { ok: false, error: 'Cannot save theme preference. Browser storage is blocked for this site.' }
  }

  return { ok: true }
}

export function getTeamTileDisplayPreferenceForUser(username: string): 'flag' | 'name' | null {
  const profiles = readProfiles()
  const profile = profiles[username]
  if (!profile) {
    return null
  }

  if (profile.teamTileDisplayMode === 'flag' || profile.teamTileDisplayMode === 'name') {
    return profile.teamTileDisplayMode
  }

  return null
}

export function setCurrentUserTeamTileDisplayPreference(mode: 'flag' | 'name'): { ok: boolean; error?: string } {
  const username = getCurrentUsername()
  if (!username) {
    return { ok: false, error: 'No signed in user.' }
  }

  const profiles = readProfiles()
  const existingProfile = profiles[username]
  profiles[username] = {
    ...existingProfile,
    teamName: existingProfile?.teamName ?? '',
    teamTileDisplayMode: mode,
  }

  const didWriteProfiles = setSharedItem(userProfilesStorageKey, JSON.stringify(profiles))
  if (!didWriteProfiles) {
    return { ok: false, error: 'Cannot save tile display preference. Browser storage is blocked for this site.' }
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
  const forceSignOutVersion = String(Date.now())
  const removeKeys = [
    usersStorageKey,
    userProfilesStorageKey,
    passwordResetRequestsStorageKey,
    adminNotificationStorageKey,
    'fantasy-football-global-Gameweek',
    globalBudgetStorageKey,
    'fantasy-football-transfer-history',
  ]

  for (const username of usernames) {
    removeKeys.push(userScopedStorageKey('fantasy-football-my-team-state', username))
  }

  localStorage.removeItem(currentUserStorageKey)
  safeSetStorageItem(seenForceSignOutVersionStorageKey, forceSignOutVersion)
  commitSharedStorageChanges({
    set: {
      [forceSignOutVersionStorageKey]: forceSignOutVersion,
    },
    remove: removeKeys,
  })
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

export function getAdminNotifications(): AdminNotification[] {
  return readAdminNotifications()
}

export function getAdminNotification(): AdminNotification | null {
  return readAdminNotifications()[0] ?? null
}

export function sendAdminNotification(message: string): { ok: boolean; error?: string } {
  const currentUsername = getCurrentUsername()
  if (!currentUsername) {
    return { ok: false, error: 'No signed in user.' }
  }

  const normalizedMessage = message.trim()
  if (normalizedMessage.length === 0) {
    return { ok: false, error: 'Message is required.' }
  }

  const notification: AdminNotification = {
    id: String(Date.now()),
    message: normalizedMessage,
    createdAt: new Date().toISOString(),
    senderUsername: currentUsername,
    seenBy: [currentUsername],
  }

  const nextNotifications = [notification, ...readAdminNotifications()].slice(0, maxActiveAdminNotifications)
  if (!writeAdminNotifications(nextNotifications)) {
    return { ok: false, error: 'Unable to save admin message.' }
  }

  return { ok: true }
}

export function clearAdminNotification(notificationId?: string): { ok: boolean; error?: string } {
  const notifications = readAdminNotifications()
  if (notifications.length === 0) {
    return { ok: true }
  }

  const nextNotifications = notificationId
    ? notifications.filter((notification) => notification.id !== notificationId)
    : []

  if (!writeAdminNotifications(nextNotifications)) {
    return { ok: false, error: 'Unable to clear admin message.' }
  }

  return { ok: true }
}

export function hasUnreadAdminNotification(username = getCurrentUsername() ?? ''): boolean {
  const normalizedUsername = username.trim()
  if (normalizedUsername.length === 0) {
    return false
  }

  const notifications = readAdminNotifications()
  if (notifications.length === 0) {
    return false
  }

  return notifications.some((notification) => !hasUsernameSeenNotification(notification, normalizedUsername))
}

export function markAdminNotificationSeen(
  username = getCurrentUsername() ?? '',
  notificationId?: string,
): { ok: boolean; error?: string } {
  const normalizedUsername = username.trim()
  if (normalizedUsername.length === 0) {
    return { ok: false, error: 'Username is required.' }
  }

  const allNotifications = readAdminNotifications()
  if (allNotifications.length === 0) {
    return { ok: true }
  }

  const notifications = notificationId
    ? allNotifications.filter((notification) => notification.id === notificationId)
    : allNotifications
  if (notifications.length === 0) {
    return { ok: true }
  }

  const needsUpdate = notifications.some(
    (notification) => !hasUsernameSeenNotification(notification, normalizedUsername),
  )
  if (!needsUpdate) {
    return { ok: true }
  }

  const targetIds = new Set(notifications.map((notification) => notification.id))
  const nextNotifications = allNotifications.map((notification) => {
    if (!targetIds.has(notification.id)) {
      return notification
    }

    return hasUsernameSeenNotification(notification, normalizedUsername)
      ? notification
      : {
          ...notification,
          seenBy: normalizeUniqueUsernames([...notification.seenBy, normalizedUsername]),
        }
  })

  if (!writeAdminNotifications(nextNotifications)) {
    return { ok: false, error: 'Unable to update notification status.' }
  }

  return { ok: true }
}

export function getUnreadAdminNotificationUsernames(notificationId?: string): string[] {
  const notifications = readAdminNotifications()
  const notification = notificationId
    ? notifications.find((entry) => entry.id === notificationId)
    : notifications[0]
  if (!notification) {
    return []
  }

  return getAllUsernames().filter((username) => !hasUsernameSeenNotification(notification, username))
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

export function renameUser(
  username: string,
  nextUsername: string,
): { ok: boolean; error?: string; username?: string } {
  const normalizedUsername = username.trim()
  const normalizedNextUsername = nextUsername.trim()

  if (normalizedUsername.length === 0 || normalizedNextUsername.length === 0) {
    return { ok: false, error: 'Username is required.' }
  }

  if (normalizedNextUsername.length < 3) {
    return { ok: false, error: 'Username must be at least 3 characters.' }
  }

  const users = readUsers()
  const userIndex = users.findIndex(
    (user) => user.username.toLowerCase() === normalizedUsername.toLowerCase(),
  )

  if (userIndex === -1) {
    return { ok: false, error: 'User not found.' }
  }

  const existingByNextUsername = users.find(
    (user) => user.username.toLowerCase() === normalizedNextUsername.toLowerCase(),
  )
  if (existingByNextUsername && existingByNextUsername.username.toLowerCase() !== users[userIndex].username.toLowerCase()) {
    return { ok: false, error: 'That username is already taken.' }
  }

  const canonicalOldUsername = users[userIndex].username
  users[userIndex] = {
    ...users[userIndex],
    username: normalizedNextUsername,
  }

  const profiles = readProfiles()
  const existingProfile = profiles[canonicalOldUsername]
  if (existingProfile) {
    profiles[normalizedNextUsername] = existingProfile
    delete profiles[canonicalOldUsername]
  }

  const renamedRequests = Array.from(
    new Map(
      readPasswordResetRequests().map((requestUsername) => {
        if (requestUsername.toLowerCase() === canonicalOldUsername.toLowerCase()) {
          return [normalizedNextUsername.toLowerCase(), normalizedNextUsername]
        }

        return [requestUsername.toLowerCase(), requestUsername]
      }),
    ).values(),
  )

  const oldTeamStateStorageKey = userScopedStorageKey('fantasy-football-my-team-state', canonicalOldUsername)
  const newTeamStateStorageKey = userScopedStorageKey('fantasy-football-my-team-state', normalizedNextUsername)
  const oldTeamState = getSharedItem(oldTeamStateStorageKey)
  const currentNotifications = readAdminNotifications()

  const nextSetValues: Record<string, string> = {
    [usersStorageKey]: JSON.stringify(users),
    [userProfilesStorageKey]: JSON.stringify(profiles),
    [passwordResetRequestsStorageKey]: JSON.stringify(renamedRequests),
  }
  if (currentNotifications.length > 0) {
    nextSetValues[adminNotificationStorageKey] = JSON.stringify(
      renameNotificationUsers(currentNotifications, canonicalOldUsername, normalizedNextUsername),
    )
  }
  if (typeof oldTeamState === 'string') {
    nextSetValues[newTeamStateStorageKey] = oldTeamState
  }

  const didCommit = commitSharedStorageChanges({
    set: nextSetValues,
    remove: [oldTeamStateStorageKey],
  })

  if (!didCommit) {
    return { ok: false, error: 'Unable to rename user right now.' }
  }

  const currentUsername = getCurrentUsername()
  if (currentUsername && currentUsername.toLowerCase() === canonicalOldUsername.toLowerCase()) {
    if (!safeSetStorageItem(currentUserStorageKey, normalizedNextUsername)) {
      return { ok: false, error: 'Username was updated but session could not be refreshed.' }
    }
  }

  return { ok: true, username: normalizedNextUsername }
}

export function deleteUser(username: string): { ok: boolean; error?: string; deletedUsername?: string } {
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

  const nextUsers = users.filter(
    (user) => user.username.toLowerCase() !== existingUser.username.toLowerCase(),
  )

  const profiles = readProfiles()
  delete profiles[existingUser.username]

  const remainingRequests = readPasswordResetRequests().filter(
    (name) => name.toLowerCase() !== existingUser.username.toLowerCase(),
  )
  const currentNotifications = readAdminNotifications()

  const nextSetValues: Record<string, string> = {
    [usersStorageKey]: JSON.stringify(nextUsers),
    [userProfilesStorageKey]: JSON.stringify(profiles),
    [passwordResetRequestsStorageKey]: JSON.stringify(remainingRequests),
  }
  if (currentNotifications.length > 0) {
    nextSetValues[adminNotificationStorageKey] = JSON.stringify(
      removeNotificationUsers(currentNotifications, existingUser.username),
    )
  }

  const didCommit = commitSharedStorageChanges({
    set: nextSetValues,
    remove: [
      userScopedStorageKey('fantasy-football-my-team-state', existingUser.username),
    ],
  })

  if (!didCommit) {
    return { ok: false, error: 'Unable to delete user right now.' }
  }

  const currentUsername = getCurrentUsername()
  if (currentUsername && currentUsername.toLowerCase() === existingUser.username.toLowerCase()) {
    signOut()
  }

  return { ok: true, deletedUsername: existingUser.username }
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
  const currentBudget = getGlobalBudget()
  const nextBudget = Math.max(1, Number((currentBudget + adjustment).toFixed(1)))
  const budgetDelta = Number((nextBudget - currentBudget).toFixed(1))
  const setUpdates: Record<string, string> = {
    [globalBudgetStorageKey]: String(nextBudget),
  }

  if (budgetDelta !== 0) {
    for (const user of readUsers()) {
      const teamStateKey = userScopedStorageKey('fantasy-football-my-team-state', user.username)
      const rawState = getSharedItem(teamStateKey)
      if (!rawState) {
        continue
      }

      try {
        const state = JSON.parse(rawState) as Record<string, unknown>
        const currentRemainingBudget = Number(state.remainingBudget)
        if (!Number.isFinite(currentRemainingBudget)) {
          continue
        }

        const updatedRemainingBudget = Math.max(
          0,
          Math.min(nextBudget, Number((currentRemainingBudget + budgetDelta).toFixed(1))),
        )
        state.remainingBudget = updatedRemainingBudget
        setUpdates[teamStateKey] = JSON.stringify(state)
      } catch {
        continue
      }
    }
  }

  const didSave = commitSharedStorageChanges({ set: setUpdates })
  if (!didSave) {
    return { ok: false, error: 'Unable to update global budget and user budgets.' }
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
    const captainBonusTotalRaw = Number.isFinite(state.captainBonusTotal as number)
      ? (state.captainBonusTotal as number)
      : 0
    const currentGameweek = Number.isFinite(state.currentGameweek as number)
      ? Math.max(0, Number(state.currentGameweek as number))
      : 1
    const captainBonusTotal = captainBonusTotalRaw
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
      return getCurrentGameweekPlayerPoints(playerName, teamName)
    }

    const transferAwareCurrentPoints = getTransferAwareGameweekPoints(
      selectedPlayerKeys,
      currentGameweek,
      transferPointEvents,
      getCurrentPointsByPlayerKey,
    )

    const ownedPointsTotalRaw = Number.isFinite(state.ownedPointsTotal as number)
      ? Math.max(0, state.ownedPointsTotal as number)
      : null
    const ownedPointsTotal = ownedPointsTotalRaw

    // Fallback for legacy/missing owned totals: use only current Gameweek points.
    // This keeps table totals aligned with the pitch view and avoids re-adding
    // previously accumulated points from stale storage.
    const playerPointsTotal = ownedPointsTotal === null
      ? transferAwareCurrentPoints
      : ownedPointsTotal + transferAwareCurrentPoints

    let captainCurrentBonus = 0
    const captainPlayerKey = typeof state.captainPlayerKey === 'string' ? state.captainPlayerKey : null
    if (captainPlayerKey && selectedPlayerKeys.includes(captainPlayerKey)) {
      const captainParts = captainPlayerKey.split('::')
      if (captainParts.length >= 2) {
        captainCurrentBonus = getTransferAwarePlayerCurrentPoints(
          captainPlayerKey,
          selectedPlayerKeys,
          currentGameweek,
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
