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
  Algeria: '🇩🇿',
  Argentina: '🇦🇷',
  Austria: '🇦🇹',
  Australia: '🇦🇺',
  Belgium: '🇧🇪',
  'Bosnia and Herzegovina': '🇧🇦',
  Brazil: '🇧🇷',
  'Cabo Verde': '🇨🇻',
  'Cape Verde': '🇨🇻',
  Canada: '🇨🇦',
  Chile: '🇨🇱',
  China: '🇨🇳',
  Colombia: '🇨🇴',
  'Congo DR': '🇨🇩',
  'DR Congo': '🇨🇩',
  'Côte d\'Ivoire': '🇨🇮',
  Croatia: '🇭🇷',
  Curaçao: '🇨🇼',
  'Czech Republic': '🇨🇿',
  Czechia: '🇨🇿',
  Denmark: '🇩🇰',
  Ecuador: '🇪🇨',
  Egypt: '🇪🇬',
  England: '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
  Finland: '🇫🇮',
  France: '🇫🇷',
  Germany: '🇩🇪',
  Ghana: '🇬🇭',
  Greece: '🇬🇷',
  Haiti: '🇭🇹',
  Hungary: '🇭🇺',
  Iceland: '🇮🇸',
  India: '🇮🇳',
  Iran: '🇮🇷',
  'IR Iran': '🇮🇷',
  Iraq: '🇮🇶',
  Ireland: '🇮🇪',
  Israel: '🇮🇱',
  Italy: '🇮🇹',
  'Ivory Coast': '🇨🇮',
  Japan: '🇯🇵',
  Jordan: '🇯🇴',
  Korea: '🇰🇷',
  'Korea Republic': '🇰🇷',
  'South Korea': '🇰🇷',
  Mexico: '🇲🇽',
  Morocco: '🇲🇦',
  Netherlands: '🇳🇱',
  'New Zealand': '🇳🇿',
  Nigeria: '🇳🇬',
  'Northern Ireland': '🇬🇧',
  Norway: '🇳🇴',
  Panama: '🇵🇦',
  Paraguay: '🇵🇾',
  Peru: '🇵🇪',
  Poland: '🇵🇱',
  Portugal: '🇵🇹',
  Qatar: '🇶🇦',
  Romania: '🇷🇴',
  Russia: '🇷🇺',
  'Saudi Arabia': '🇸🇦',
  Scotland: '🏴󠁧󠁢󠁳󠁣󠁴󠁿',
  Senegal: '🇸🇳',
  Serbia: '🇷🇸',
  Spain: '🇪🇸',
  'South Africa': '🇿🇦',
  Sweden: '🇸🇪',
  Switzerland: '🇨🇭',
  Thailand: '🇹🇭',
  Tunisia: '🇹🇳',
  Turkey: '🇹🇷',
  Türkiye: '🇹🇷',
  Ukraine: '🇺🇦',
  'United States': '🇺🇸',
  Uruguay: '🇺🇾',
  USA: '🇺🇸',
  Uzbekistan: '🇺🇿',
  Vietnam: '🇻🇳',
  Wales: '🏴󠁧󠁢󠁷󠁬󠁳󠁿',
}

export function getCountryFlag(teamName: string): string {
  const normalized = teamName.trim()
  return countryFlagMap[normalized] ?? '🏳️'
}

type TeamKitColors = {
  backgroundColor: string
  textColor: string
  borderColor: string
}

const teamKitColorMap: Record<string, string> = {
  Algeria: '#ffffff',
  Argentina: '#7cc3f0',
  Austria: '#ffffff',
  Australia: '#f4c430',
  Belgium: '#b3121f',
  'Bosnia and Herzegovina': '#1d5fbf',
  Brazil: '#f4c430',
  'Cabo Verde': '#1d5fbf',
  'Cape Verde': '#1d5fbf',
  Canada: '#d71920',
  Chile: '#d71920',
  China: '#d71920',
  Colombia: '#f4c430',
  'Congo DR': '#1d5fbf',
  'DR Congo': '#1d5fbf',
  "Côte d'Ivoire": '#f58220',
  Croatia: '#ffffff',
  Curaçao: '#1d5fbf',
  'Czech Republic': '#d71920',
  Czechia: '#d71920',
  Denmark: '#d71920',
  Ecuador: '#f4c430',
  Egypt: '#d71920',
  England: '#ffffff',
  Finland: '#ffffff',
  France: '#1d5fbf',
  Germany: '#ffffff',
  Ghana: '#ffffff',
  Greece: '#ffffff',
  Haiti: '#1d5fbf',
  Hungary: '#d71920',
  Iceland: '#1d5fbf',
  India: '#1d5fbf',
  Iran: '#ffffff',
  'IR Iran': '#ffffff',
  Iraq: '#ffffff',
  Ireland: '#009a49',
  Israel: '#1d5fbf',
  Italy: '#1d5fbf',
  'Ivory Coast': '#f58220',
  Japan: '#1d5fbf',
  Jordan: '#ffffff',
  Korea: '#d71920',
  'Korea Republic': '#d71920',
  'South Korea': '#d71920',
  Mexico: '#009a49',
  Morocco: '#d71920',
  Netherlands: '#f58220',
  'New Zealand': '#ffffff',
  Nigeria: '#009a49',
  'Northern Ireland': '#009a49',
  Norway: '#d71920',
  Panama: '#d71920',
  Paraguay: '#d71920',
  Peru: '#ffffff',
  Poland: '#ffffff',
  Portugal: '#d71920',
  Qatar: '#7b133e',
  Romania: '#f4c430',
  Russia: '#d71920',
  'Saudi Arabia': '#009a49',
  Scotland: '#1d5fbf',
  Senegal: '#ffffff',
  Serbia: '#d71920',
  Spain: '#d71920',
  'South Africa': '#f4c430',
  Sweden: '#f4c430',
  Switzerland: '#d71920',
  Thailand: '#1d5fbf',
  Tunisia: '#ffffff',
  Turkey: '#d71920',
  Türkiye: '#d71920',
  Ukraine: '#f4c430',
  'United States': '#ffffff',
  Uruguay: '#7cc3f0',
  USA: '#ffffff',
  Uzbekistan: '#ffffff',
  Vietnam: '#d71920',
  Wales: '#d71920',
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace('#', '')
  const fullHex = normalized.length === 3
    ? normalized
        .split('')
        .map((value) => `${value}${value}`)
        .join('')
    : normalized

  const parsed = Number.parseInt(fullHex, 16)
  if (!Number.isFinite(parsed)) {
    return { r: 255, g: 255, b: 255 }
  }

  return {
    r: clampByte((parsed >> 16) & 0xff),
    g: clampByte((parsed >> 8) & 0xff),
    b: clampByte(parsed & 0xff),
  }
}

function rgbToHex(r: number, g: number, b: number): string {
  const value = (clampByte(r) << 16) | (clampByte(g) << 8) | clampByte(b)
  return `#${value.toString(16).padStart(6, '0')}`
}

function getPerceivedBrightness(hex: string): number {
  const { r, g, b } = hexToRgb(hex)
  return (r * 299 + g * 587 + b * 114) / 1000
}

function shadeHex(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex)
  return rgbToHex(r + amount, g + amount, b + amount)
}

export function getTeamKitColors(teamName: string): TeamKitColors {
  const base = teamKitColorMap[teamName.trim()] ?? '#2563eb'
  const brightness = getPerceivedBrightness(base)
  const textColor = brightness > 155 ? '#0f172a' : '#ffffff'
  const borderColor = brightness > 155 ? shadeHex(base, -55) : shadeHex(base, 45)

  return {
    backgroundColor: base,
    textColor,
    borderColor,
  }
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
        points: getCurrentMatchdayPlayerPoints(player.name, team.name),
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

function getCurrentMatchdayPlayedTeams(): Set<string> {
  const currentMatchdayRaw = getSharedItem('fantasy-football-global-matchday')
  const currentMatchday = currentMatchdayRaw ? Number.parseInt(currentMatchdayRaw, 10) : 1
  const raw = getSharedItem('fantasy-football-fixture-results')
  const results: Array<{ match: string; homeScore?: string; awayScore?: string }> = raw
    ? (() => {
      try {
        return JSON.parse(raw) as Array<{ match: string; homeScore?: string; awayScore?: string }>
      } catch {
        return []
      }
    })()
    : []

  const teamCount: Record<string, number> = {}
  for (const result of results) {
    if (result.homeScore === undefined || result.awayScore === undefined) {
      continue
    }

    const [home, away] = result.match.split(' vs ')
    if (home) {
      const trimmedHome = home.trim()
      teamCount[trimmedHome] = (teamCount[trimmedHome] ?? 0) + 1
    }
    if (away) {
      const trimmedAway = away.trim()
      teamCount[trimmedAway] = (teamCount[trimmedAway] ?? 0) + 1
    }
  }

  const playedTeams = new Set<string>()
  for (const [team, count] of Object.entries(teamCount)) {
    if (count >= currentMatchday) {
      playedTeams.add(team.toLowerCase())
    }
  }

  return playedTeams
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

export function getCurrentMatchdayPlayerPoints(playerName: string, teamName: string): number {
  const playedTeams = getCurrentMatchdayPlayedTeams()
  if (!playedTeams.has(teamName.trim().toLowerCase())) {
    return 0
  }

  return getPlayerPoints(playerName, teamName)
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
