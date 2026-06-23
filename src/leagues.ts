import { getAllUsernames } from './auth'
import { getSharedItem, removeSharedItem, setSharedItem } from './sharedLeague'

export type LeagueRecord = {
  id: string
  name: string
  createdBy: string
  createdAt: string
  members: string[]
}

const leaguesStorageKey = 'fantasy-football-leagues'
const minLeagueNameLength = 2
const maxLeagueNameLength = 60
const leagueIdLength = 6

function normalizeLeagueId(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function getCanonicalUsernamesByLower(): Map<string, string> {
  return new Map(getAllUsernames().map((username) => [username.toLowerCase(), username]))
}

function sanitizeLeague(rawLeague: unknown, canonicalUsernamesByLower: Map<string, string>): LeagueRecord | null {
  if (!rawLeague || typeof rawLeague !== 'object' || Array.isArray(rawLeague)) {
    return null
  }

  const league = rawLeague as Record<string, unknown>

  const id = normalizeLeagueId(typeof league.id === 'string' ? league.id : '')
  const name = typeof league.name === 'string' ? league.name.trim().slice(0, maxLeagueNameLength) : ''
  if (id.length !== leagueIdLength || name.length < minLeagueNameLength) {
    return null
  }

  const createdByRaw = typeof league.createdBy === 'string' ? league.createdBy.trim() : ''
  const createdBy = canonicalUsernamesByLower.get(createdByRaw.toLowerCase()) ?? createdByRaw
  const createdAt = typeof league.createdAt === 'string' ? league.createdAt : ''

  const seenMembers = new Set<string>()
  const members = Array.isArray(league.members)
    ? league.members
        .filter((member): member is string => typeof member === 'string')
        .map((member) => canonicalUsernamesByLower.get(member.trim().toLowerCase()) ?? '')
        .filter((member) => {
          if (!member) {
            return false
          }

          const normalizedMember = member.toLowerCase()
          if (seenMembers.has(normalizedMember)) {
            return false
          }

          seenMembers.add(normalizedMember)
          return true
        })
    : []

  return {
    id,
    name,
    createdBy,
    createdAt,
    members,
  }
}

function readLeagues(): LeagueRecord[] {
  const raw = getSharedItem(leaguesStorageKey)
  if (!raw) {
    return []
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }

    const canonicalUsernamesByLower = getCanonicalUsernamesByLower()
    return parsed
      .map((league) => sanitizeLeague(league, canonicalUsernamesByLower))
      .filter((league): league is LeagueRecord => Boolean(league))
  } catch {
    return []
  }
}

function writeLeagues(leagues: LeagueRecord[]): boolean {
  if (leagues.length === 0) {
    return removeSharedItem(leaguesStorageKey)
  }

  return setSharedItem(leaguesStorageKey, JSON.stringify(leagues))
}

function generateLeagueId(existingIds: Set<string>): string {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidate = Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, leagueIdLength)
    if (candidate.length === leagueIdLength && !existingIds.has(candidate)) {
      return candidate
    }
  }

  const fallback = `${Date.now().toString(36)}AAAAAA`.toUpperCase().slice(-leagueIdLength)
  if (!existingIds.has(fallback)) {
    return fallback
  }

  let suffix = 0
  while (suffix < 1000) {
    const candidate = `${fallback.slice(0, leagueIdLength - 1)}${suffix % 10}`
    if (!existingIds.has(candidate)) {
      return candidate
    }
    suffix += 1
  }

  return fallback
}

export function getAllLeagues(): LeagueRecord[] {
  return readLeagues()
}

export function getLeagueById(leagueId: string): LeagueRecord | null {
  const normalizedLeagueId = normalizeLeagueId(leagueId)
  return readLeagues().find((league) => league.id === normalizedLeagueId) ?? null
}

export function getLeaguesForUser(username: string): LeagueRecord[] {
  const normalizedUsername = username.trim().toLowerCase()
  if (!normalizedUsername) {
    return []
  }

  return readLeagues().filter((league) =>
    league.members.some((member) => member.toLowerCase() === normalizedUsername),
  )
}

export function createLeague(name: string, createdBy: string): { ok: boolean; error?: string; league?: LeagueRecord } {
  const normalizedName = name.trim().slice(0, maxLeagueNameLength)
  if (normalizedName.length < minLeagueNameLength) {
    return { ok: false, error: 'League name must be at least 2 characters.' }
  }

  const canonicalUsernamesByLower = getCanonicalUsernamesByLower()
  const canonicalCreator = canonicalUsernamesByLower.get(createdBy.trim().toLowerCase())
  if (!canonicalCreator) {
    return { ok: false, error: 'League creator must be a registered user.' }
  }

  const leagues = readLeagues()
  const nextLeague: LeagueRecord = {
    id: generateLeagueId(new Set(leagues.map((league) => league.id))),
    name: normalizedName,
    createdBy: canonicalCreator,
    createdAt: new Date().toISOString(),
    members: [],
  }

  if (!writeLeagues([...leagues, nextLeague])) {
    return { ok: false, error: 'Unable to save the new league.' }
  }

  return { ok: true, league: nextLeague }
}

export function renameLeague(
  leagueId: string,
  name: string,
): { ok: boolean; error?: string; league?: LeagueRecord } {
  const normalizedLeagueId = normalizeLeagueId(leagueId)
  const normalizedName = name.trim().slice(0, maxLeagueNameLength)
  if (normalizedLeagueId.length !== leagueIdLength) {
    return { ok: false, error: 'League not found.' }
  }

  if (normalizedName.length < minLeagueNameLength) {
    return { ok: false, error: 'League name must be at least 2 characters.' }
  }

  const leagues = readLeagues()
  const leagueIndex = leagues.findIndex((league) => league.id === normalizedLeagueId)
  if (leagueIndex < 0) {
    return { ok: false, error: 'League not found.' }
  }

  const nextLeague: LeagueRecord = {
    ...leagues[leagueIndex],
    name: normalizedName,
  }
  const nextLeagues = [...leagues]
  nextLeagues[leagueIndex] = nextLeague
  if (!writeLeagues(nextLeagues)) {
    return { ok: false, error: 'Unable to rename league.' }
  }

  return { ok: true, league: nextLeague }
}

export function joinLeague(leagueId: string, username: string): { ok: boolean; error?: string; league?: LeagueRecord } {
  const normalizedLeagueId = normalizeLeagueId(leagueId)
  if (normalizedLeagueId.length !== leagueIdLength) {
    return { ok: false, error: 'Enter a valid league ID.' }
  }

  const canonicalUsernamesByLower = getCanonicalUsernamesByLower()
  const canonicalUsername = canonicalUsernamesByLower.get(username.trim().toLowerCase())
  if (!canonicalUsername) {
    return { ok: false, error: 'You must be a registered user to join a league.' }
  }

  const leagues = readLeagues()
  const leagueIndex = leagues.findIndex((league) => league.id === normalizedLeagueId)
  if (leagueIndex < 0) {
    return { ok: false, error: 'League ID not found.' }
  }

  const currentLeague = leagues[leagueIndex]
  if (currentLeague.members.some((member) => member.toLowerCase() === canonicalUsername.toLowerCase())) {
    return { ok: false, error: 'You are already in this league.' }
  }

  const nextLeague: LeagueRecord = {
    ...currentLeague,
    members: [...currentLeague.members, canonicalUsername],
  }
  const nextLeagues = [...leagues]
  nextLeagues[leagueIndex] = nextLeague

  if (!writeLeagues(nextLeagues)) {
    return { ok: false, error: 'Unable to join the league right now.' }
  }

  return { ok: true, league: nextLeague }
}

export function removeUserFromLeague(
  leagueId: string,
  username: string,
): { ok: boolean; error?: string; league?: LeagueRecord } {
  const normalizedLeagueId = normalizeLeagueId(leagueId)
  const normalizedUsername = username.trim().toLowerCase()
  if (normalizedLeagueId.length !== leagueIdLength) {
    return { ok: false, error: 'League not found.' }
  }

  if (!normalizedUsername) {
    return { ok: false, error: 'Username is required.' }
  }

  const leagues = readLeagues()
  const leagueIndex = leagues.findIndex((league) => league.id === normalizedLeagueId)
  if (leagueIndex < 0) {
    return { ok: false, error: 'League not found.' }
  }

  const currentLeague = leagues[leagueIndex]
  const nextMembers = currentLeague.members.filter((member) => member.toLowerCase() !== normalizedUsername)
  if (nextMembers.length === currentLeague.members.length) {
    return { ok: false, error: 'User is not in that league.' }
  }

  const nextLeague: LeagueRecord = {
    ...currentLeague,
    members: nextMembers,
  }
  const nextLeagues = [...leagues]
  nextLeagues[leagueIndex] = nextLeague
  if (!writeLeagues(nextLeagues)) {
    return { ok: false, error: 'Unable to update league membership.' }
  }

  return { ok: true, league: nextLeague }
}

export function renameUserInLeagues(
  previousUsername: string,
  nextUsername: string,
): { ok: boolean; error?: string; updatedCount?: number } {
  const normalizedPreviousUsername = previousUsername.trim().toLowerCase()
  const normalizedNextUsername = nextUsername.trim()
  if (!normalizedPreviousUsername || normalizedNextUsername.length === 0) {
    return { ok: false, error: 'Username is required.' }
  }

  const leagues = readLeagues()
  let updatedCount = 0
  const nextLeagues = leagues.map((league) => {
    let changed = false

    const nextCreatedBy = league.createdBy.toLowerCase() === normalizedPreviousUsername
      ? normalizedNextUsername
      : league.createdBy
    if (nextCreatedBy !== league.createdBy) {
      changed = true
    }

    const nextMembers = league.members.map((member) => {
      if (member.toLowerCase() !== normalizedPreviousUsername) {
        return member
      }

      changed = true
      return normalizedNextUsername
    })

    if (!changed) {
      return league
    }

    updatedCount += 1
    return {
      ...league,
      createdBy: nextCreatedBy,
      members: nextMembers,
    }
  })

  if (updatedCount === 0) {
    return { ok: true, updatedCount: 0 }
  }

  if (!writeLeagues(nextLeagues)) {
    return { ok: false, error: 'Unable to update league memberships for renamed user.' }
  }

  return { ok: true, updatedCount }
}

export function deleteLeague(leagueId: string): { ok: boolean; error?: string } {
  const normalizedLeagueId = normalizeLeagueId(leagueId)
  if (normalizedLeagueId.length !== leagueIdLength) {
    return { ok: false, error: 'League not found.' }
  }

  const leagues = readLeagues()
  const nextLeagues = leagues.filter((league) => league.id !== normalizedLeagueId)
  if (nextLeagues.length === leagues.length) {
    return { ok: false, error: 'League not found.' }
  }

  if (!writeLeagues(nextLeagues)) {
    return { ok: false, error: 'Unable to delete league.' }
  }

  return { ok: true }
}

export function clearAllLeagues(): void {
  removeSharedItem(leaguesStorageKey)
}