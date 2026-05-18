import teamsText from '../teams.txt?raw'
import { bootstrapSharedLeagueStorage, getSharedItem, setSharedItem, sharedLeagueUpdatedEvent } from './sharedLeague'

await bootstrapSharedLeagueStorage()

export type SquadStatus = 'final' | 'preliminary'

export type PlayerEntry = {
  name: string
  position: string
  price: number
  points: number
}

export type TeamSquad = {
  name: string
  status: SquadStatus
  players: PlayerEntry[]
}

export type SelectablePlayer = PlayerEntry & {
  team: string
  status: SquadStatus
}

export const positionOrder: Record<string, number> = {
  Goalkeeper: 0,
  Defender: 1,
  Midfielder: 2,
  'Midfielder/Forward': 3,
  Forward: 4,
  Player: 5,
}

const countryFlagMap: Record<string, string> = {
  England: '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
  Scotland: '🏴󠁧󠁢󠁳󠁣󠁴󠁿',
  Wales: '🏴󠁧󠁢󠁷󠁬󠁳󠁿',
  'Northern Ireland': '🇬🇧',
  France: '🇫🇷',
  Spain: '🇪🇸',
  Germany: '🇩🇪',
  Italy: '🇮🇹',
  Netherlands: '🇳🇱',
  Portugal: '🇵🇹',
  Belgium: '🇧🇪',
  Brazil: '🇧🇷',
  Argentina: '🇦🇷',
  Uruguay: '🇺🇾',
  Mexico: '🇲🇽',
  Canada: '🇨🇦',
  USA: '🇺🇸',
  'United States': '🇺🇸',
  Australia: '🇦🇺',
  Japan: '🇯🇵',
  Korea: '🇰🇷',
  'South Korea': '🇰🇷',
  China: '🇨🇳',
  India: '🇮🇳',
  Egypt: '🇪🇬',
  Ghana: '🇬🇭',
  Nigeria: '🇳🇬',
  'South Africa': '🇿🇦',
  Senegal: '🇸🇳',
  Croatia: '🇭🇷',
  Serbia: '🇷🇸',
  Greece: '🇬🇷',
  Poland: '🇵🇱',
  Sweden: '🇸🇪',
  Norway: '🇳🇴',
  Denmark: '🇩🇰',
  Finland: '🇫🇮',
  Czechia: '🇨🇿',
  'Czech Republic': '🇨🇿',
  Hungary: '🇭🇺',
  Romania: '🇷🇴',
  Austria: '🇦🇹',
  Switzerland: '🇨🇭',
  Turkey: '🇹🇷',
  Russia: '🇷🇺',
  Ukraine: '🇺🇦',
  Iceland: '🇮🇸',
  Ireland: '🇮🇪',
  Israel: '🇮🇱',
  'Saudi Arabia': '🇸🇦',
  Iran: '🇮🇷',
  Thailand: '🇹🇭',
  Vietnam: '🇻🇳',
  'New Zealand': '🇳🇿',
  Peru: '🇵🇪',
  Chile: '🇨🇱',
  Colombia: '🇨🇴',
  Ecuador: '🇪🇨',
}

export function getCountryFlag(teamName: string): string {
  const normalized = teamName.trim()
  return countryFlagMap[normalized] ?? '🏳️'
}

const squadLineRegex =
  /^(Goalkeepers|Defenders|Midfielders|Forwards|Midfielders\s*&\s*forwards)\s*:/i

const playerPointsStorageKey = 'fantasy-football-player-points'
const totalPointsStorageKey = 'fantasy-football-total-points'

function normalizePlayerName(rawPlayer: string): string {
  const withoutClub = rawPlayer.replace(/\s*\([^)]*\)/g, '')
  return withoutClub.replace(/^[^A-Za-z0-9\u00C0-\u024F]+/, '').trim()
}

function parsePlayerToken(rawToken: string): { name: string; price: number | undefined } {
  // Extract optional price in square brackets at the end: "Player Name [5.5]"
  const priceMatch = rawToken.match(/\[(\d+(?:\.\d+)?)\]\s*$/)
  let price: number | undefined
  if (priceMatch) {
    price = parseFloat(priceMatch[1])
    rawToken = rawToken.slice(0, rawToken.lastIndexOf('[')).trimEnd()
  }
  return { name: normalizePlayerName(rawToken), price }
}

function generatePriceSeed(input: string): number {
  let hash = 0
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0
  }

  return hash
}

function generatePlayerPrice(playerName: string, teamName: string): number {
  const seed = generatePriceSeed(`${teamName}::${playerName}`)
  // 121 values from 2.0 to 14.0 at 0.1 increments.
  const step = seed % 121
  return Number((2 + step / 10).toFixed(1))
}

function parseStatus(rawStatus: string | undefined): SquadStatus {
  if (!rawStatus) {
    return 'preliminary'
  }

  const normalized = rawStatus.trim().toLowerCase()
  if (normalized.includes('final') || normalized.includes('full')) {
    return 'final'
  }

  return 'preliminary'
}

function normalizePosition(position: string): string {
  const normalized = position.trim().toLowerCase()

  if (normalized.includes('goalkeeper')) {
    return 'Goalkeeper'
  }

  if (normalized.includes('defender')) {
    return 'Defender'
  }

  if (normalized.includes('forwards') || normalized.includes('forwad') || normalized.includes('forward')) {
    return 'Forward'
  }

  if (normalized.includes('midfielders') && normalized.includes('forwards')) {
    return 'Midfielder/Forward'
  }

  if (normalized.includes('midfielder')) {
    return 'Midfielder'
  }

  return 'Player'
}

function isLikelyTeamLine(line: string): boolean {
  if (!line || line.includes(':')) {
    return false
  }

  if (line.startsWith('FIFA World Cup')) {
    return false
  }

  const lower = line.toLowerCase()
  if (
    lower === 'all' ||
    lower === 'exclusive' ||
    lower === 'highlights' ||
    lower.includes('spain win gold in men') ||
    lower.includes('duration time')
  ) {
    return false
  }

  if (line.length > 70) {
    return false
  }

  return /^[A-Za-z0-9\u00C0-\u024F'’&.\-\s()]+$/.test(line)
}

function parseTeamLine(line: string): { name: string; status: SquadStatus } {
  const match = line.match(/^(.*?)\s*\(([^)]+)\)\s*$/)
  if (match) {
    return {
      name: match[1].trim(),
      status: parseStatus(match[2]),
    }
  }

  return {
    name: line.trim(),
    status: 'preliminary',
  }
}

function parseTeams(rawText: string): TeamSquad[] {
  const teams: TeamSquad[] = []
  const lines = rawText.split(/\r?\n/).map((line) => line.trim())
  let currentTeam: TeamSquad | null = null

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (!line) {
      continue
    }

    if (isLikelyTeamLine(line)) {
      const lookAhead = lines.slice(i + 1, i + 6).join(' ')
      if (!/Goalkeepers\s*:/.test(lookAhead)) {
        continue
      }

      const parsedTeam = parseTeamLine(line)
      currentTeam = {
        name: parsedTeam.name,
        status: parsedTeam.status,
        players: [],
      }
      teams.push(currentTeam)
      continue
    }

    if (!currentTeam || !squadLineRegex.test(line)) {
      continue
    }

    const positionPart = line.split(':')[0]?.trim() ?? ''
    const position = normalizePosition(positionPart)
    const playersPart = line.split(':').slice(1).join(':').trim()
    if (!playersPart) {
      continue
    }

    const playerTokens = playersPart
      .split(',')
      .map((token) => token.trim())
      .filter((token) => token.length > 0)

    for (const token of playerTokens) {
      const { name, price } = parsePlayerToken(token)
      if (name && !currentTeam.players.some((entry) => entry.name === name)) {
        currentTeam.players.push({
          name,
          position,
          price: price ?? generatePlayerPrice(name, currentTeam.name),
          points: 0,
        })
      }
    }
  }

  return teams
}

export function getTeamsSorted(): TeamSquad[] {
  return parseTeams(teamsText).sort((a, b) => a.name.localeCompare(b.name))
}

export function getAllPlayers(): SelectablePlayer[] {
  const teams = getTeamsSorted()
  return teams
    .flatMap((team) =>
      team.players.map((player) => ({
        ...player,
        team: team.name,
        status: team.status,
        points: getPlayerPoints(player.name, team.name),
      })),
    )
    .sort((a, b) => {
      const aRank = positionOrder[a.position] ?? 99
      const bRank = positionOrder[b.position] ?? 99
      if (aRank !== bRank) {
        return aRank - bRank
      }
      return a.name.localeCompare(b.name)
    })
}

// Global points storage: maps "team::playerName" to points
const playerPointsMap: Record<string, number> = {}
const totalPointsMap: Record<string, number> = {}

function loadStoredMap(storageKey: string): Record<string, number> {
  const raw = getSharedItem(storageKey)
  if (!raw) {
    return {}
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, number>
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }

    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([key, value]) => typeof key === 'string' && typeof value === 'number' && Number.isFinite(value),
      ),
    )
  } catch {
    return {}
  }
}

function replaceMapContents(target: Record<string, number>, nextValues: Record<string, number>): void {
  for (const key of Object.keys(target)) {
    delete target[key]
  }

  Object.assign(target, nextValues)
}

function syncStoredPointMaps(): void {
  replaceMapContents(playerPointsMap, loadStoredMap(playerPointsStorageKey))
  replaceMapContents(totalPointsMap, loadStoredMap(totalPointsStorageKey))
}

function savePlayerPointsMap(): void {
  setSharedItem(playerPointsStorageKey, JSON.stringify(playerPointsMap))
}

function saveTotalPointsMap(): void {
  setSharedItem(totalPointsStorageKey, JSON.stringify(totalPointsMap))
}

syncStoredPointMaps()
window.addEventListener(sharedLeagueUpdatedEvent, syncStoredPointMaps)

export function getPlayerPoints(playerName: string, teamName: string): number {
  const key = `${teamName}::${playerName}`
  return playerPointsMap[key] ?? 0
}

export function updatePlayerPoints(playerName: string, teamName: string, points: number): void {
  const key = `${teamName}::${playerName}`
  playerPointsMap[key] = points
  savePlayerPointsMap()
}

export function updatePlayerPointsBy(playerName: string, teamName: string, pointsToAdd: number): void {
  const key = `${teamName}::${playerName}`
  playerPointsMap[key] = (playerPointsMap[key] ?? 0) + pointsToAdd
  savePlayerPointsMap()
}

export function getAllPlayerPoints(): Record<string, number> {
  return { ...playerPointsMap }
}

export function resetAllPlayerPoints(): void {
  for (const key in playerPointsMap) {
    playerPointsMap[key] = 0
  }
  savePlayerPointsMap()
}

export function getTotalAccumulatedPoints(playerName: string, teamName: string): number {
  const key = `${teamName}::${playerName}`
  return totalPointsMap[key] ?? 0
}

export function addMatchdayPointsToTotal(): void {
  for (const key in playerPointsMap) {
    totalPointsMap[key] = (totalPointsMap[key] ?? 0) + playerPointsMap[key]
  }
  saveTotalPointsMap()
  resetAllPlayerPoints()
}

export function getAllTotalPoints(): Record<string, number> {
  return { ...totalPointsMap }
}

export function resetAllTotalPoints(): void {
  for (const key in totalPointsMap) {
    totalPointsMap[key] = 0
  }
  saveTotalPointsMap()
}

export function clearAllPoints(): void {
  for (const key in playerPointsMap) {
    delete playerPointsMap[key]
  }

  for (const key in totalPointsMap) {
    delete totalPointsMap[key]
  }

  savePlayerPointsMap()
  saveTotalPointsMap()
}
