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

function normalizeTeamKey(teamName: string): string {
  return teamName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

const clubBadgeIdByTeamKey: Record<string, number> = {
  arsenal: 3,
  astonvilla: 7,
  villa: 7,
  bournemouth: 91,
  brentford: 94,
  brighton: 36,
  brightonandhovealbion: 36,
  chelsea: 8,
  coventry: 9,
  coventrycity: 9,
  crystalpalace: 31,
  palace: 31,
  everton: 11,
  fulham: 54,
  hull: 88,
  hullcity: 88,
  ipswich: 40,
  ipswichtown: 40,
  leeds: 2,
  leedsunited: 2,
  liverpool: 14,
  mancity: 43,
  manchestercity: 43,
  manutd: 1,
  manchesterunited: 1,
  newcastle: 4,
  newcastleunited: 4,
  nottmforest: 17,
  nottinghamforest: 17,
  forest: 17,
  sunderland: 56,
  spurs: 6,
  tottenham: 6,
  tottenhamhotspur: 6,
  burnley: 90,
  westham: 21,
  westhamunited: 21,
  wolves: 39,
  wolverhampton: 39,
  wolverhamptonwanderers: 39,
}

const clubBadgeUrlByTeamKey: Record<string, string> = {
  // Use the full Liverpool crest with the "You'll Never Walk Alone" banner.
  liverpool: '/badges/liverpool-full-crest.svg',
  liverpoolfc: '/badges/liverpool-full-crest.svg',
  liverpoolfpl: '/badges/liverpool-full-crest.svg',
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function getTeamBadgeUrl(teamName: string): string | null {
  const teamKey = normalizeTeamKey(teamName)
  const customBadgeUrl = clubBadgeUrlByTeamKey[teamKey]
  if (customBadgeUrl) {
    return customBadgeUrl
  }

  const badgeId = clubBadgeIdByTeamKey[teamKey]
  if (!badgeId) {
    return null
  }

  return `https://resources.premierleague.com/premierleague/badges/70/t${badgeId}.png`
}

export function getTeamBadgeOrFlagHtml(teamName: string, className = 'team-icon'): string {
  const normalized = teamName.trim()
  const flag = countryFlagMap[normalized]
  if (flag) {
    return `<span class="${className} team-flag" aria-hidden="true">${flag}</span>`
  }

  const badgeUrl = getTeamBadgeUrl(normalized)
  if (badgeUrl) {
    const safeName = escapeHtml(normalized)
    return `<img class="${className} team-badge-icon" src="${badgeUrl}" alt="${safeName} badge" loading="lazy" decoding="async" />`
  }

  return `<span class="${className} team-flag" aria-hidden="true">🏳️</span>`
}

type TeamKitColors = {
  backgroundColor: string
  backgroundPattern: string
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
  Arsenal: '#ef0107',
  'Aston Villa': '#670e36',
  Bournemouth: '#da291c',
  Brentford: '#e30613',
  'Brighton and Hove Albion': '#0057b8',
  Brighton: '#0057b8',
  Chelsea: '#034694',
  'Coventry City': '#6cabdd',
  'Crystal Palace': '#1b458f',
  Everton: '#003399',
  Fulham: '#ffffff',
  'Hull City': '#f2a900',
  'Ipswich Town': '#0057b8',
  'Leeds United': '#ffffff',
  Leeds: '#ffffff',
  Liverpool: '#c8102e',
  'Manchester City': '#6cabdd',
  'Man City': '#6cabdd',
  'Manchester United': '#da291c',
  'Man Utd': '#da291c',
  'Newcastle United': '#ffffff',
  Newcastle: '#ffffff',
  'Nottingham Forest': '#dd0000',
  Forest: '#dd0000',
  Forrest: '#dd0000',
  Sunderland: '#eb172b',
  'Tottenham Hotspur': '#ffffff',
  Spurs: '#ffffff',
  Totenham: '#ffffff',
  Burnley: '#6c1d45',
  'West Ham': '#7a263a',
  'West Ham United': '#7a263a',
  Wolves: '#fdb913',
  'Wolverhampton Wanderers': '#fdb913',
}

const stripedKitMap: Record<string, { stripeColor: string }> = {
  // Classic black and white vertical stripes.
  newcastleunited: { stripeColor: '#241f20' },
  newcastle: { stripeColor: '#241f20' },

  // Red and white stripes.
  sunderland: { stripeColor: '#ffffff' },
  brentford: { stripeColor: '#ffffff' },

  // Claret and sky blue split for Villa.
  astonvilla: { stripeColor: '#95bfe5' },
  villa: { stripeColor: '#95bfe5' },

  // Blue and red split for Palace.
  crystalpalace: { stripeColor: '#c4122e' },
  palace: { stripeColor: '#c4122e' },

  // Bournemouth and Southampton both use red/white striped homes in many seasons.
  bournemouth: { stripeColor: '#111111' },
  southampton: { stripeColor: '#ffffff' },

  // Dark blue and white stripes.
  westbrom: { stripeColor: '#ffffff' },
  westbromwichalbion: { stripeColor: '#ffffff' },
}

const teamTextColorOverrideMap: Record<string, string> = {
  newcastleunited: '#0057b8',
  newcastle: '#0057b8',
  leedsunited: '#0057b8',
  leeds: '#0057b8',
  tottenhamhotspur: '#132257',
  spurs: '#132257',
  manchesterunited: '#000000',
  manutd: '#000000',
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

function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex)
  const srgb = [r, g, b].map((channel) => channel / 255)
  const linear = srgb.map((channel) => (
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ))

  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

function contrastRatio(colorA: string, colorB: string): number {
  const l1 = relativeLuminance(colorA)
  const l2 = relativeLuminance(colorB)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

function pickReadableTextColor(backgroundColors: string[]): string {
  const candidates = ['#0f172a', '#ffffff']
  let bestColor = candidates[0]
  let bestScore = -1

  for (const candidate of candidates) {
    const worstContrast = Math.min(...backgroundColors.map((bg) => contrastRatio(candidate, bg)))
    if (worstContrast > bestScore) {
      bestScore = worstContrast
      bestColor = candidate
    }
  }

  return bestColor
}

function shadeHex(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex)
  return rgbToHex(r + amount, g + amount, b + amount)
}

function buildStripePattern(baseHex: string, stripeHex: string): string {
  return `linear-gradient(90deg, ${baseHex} 0 50%, ${stripeHex} 50% 100%)`
}

export function getTeamKitColors(teamName: string): TeamKitColors {
  const normalizedName = teamName.trim()
  const base = teamKitColorMap[normalizedName] ?? '#2563eb'
  const teamKey = normalizeTeamKey(normalizedName)
  const stripe = stripedKitMap[teamKey]
  const backgroundPattern = stripe ? buildStripePattern(base, stripe.stripeColor) : 'none'
  const computedTextColor = pickReadableTextColor(stripe ? [base, stripe.stripeColor] : [base])
  const textColor = teamTextColorOverrideMap[teamKey] ?? computedTextColor
  const brightness = getPerceivedBrightness(base)
  const borderColor = brightness > 155 ? shadeHex(base, -55) : shadeHex(base, 45)

  return {
    backgroundColor: base,
    backgroundPattern,
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
        points: getCurrentGameweekPlayerPoints(player.name, team.name),
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

function getCurrentGameweekPlayedTeams(): Set<string> {
  const currentGameweekRaw = getSharedItem('fantasy-football-global-Gameweek')
  const parsedGameweek = currentGameweekRaw ? Number.parseInt(currentGameweekRaw, 10) : 1
  const currentGameweek = Number.isFinite(parsedGameweek) && parsedGameweek > 0 ? parsedGameweek : 1

  const raw = getSharedItem('fantasy-football-fixture-results')
  const results: Array<{ match: string; matchday?: number; homeScore?: string; awayScore?: string }> = raw
    ? (() => {
      try {
        return JSON.parse(raw) as Array<{ match: string; matchday?: number; homeScore?: string; awayScore?: string }>
      } catch {
        return []
      }
    })()
    : []

  const teamCount: Record<string, number> = {}
  for (const result of results) {
    if (!Number.isFinite(result.matchday) || Number(result.matchday) !== currentGameweek) {
      continue
    }

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

  const fixturePlayedTeams = new Set<string>()
  for (const [team, count] of Object.entries(teamCount)) {
    if (count >= currentGameweek) {
      fixturePlayedTeams.add(team.toLowerCase())
    }
  }

  return fixturePlayedTeams
}

export function hasTeamPlayedThisGameweek(teamName: string): boolean {
  return getCurrentGameweekPlayedTeams().has(teamName.trim().toLowerCase())
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

function getCurrentGameweekImportedPoints(_playerName: string, _teamName: string): number | null {
  // No maps—return null to use fixture-result logic only.
  return null
}

export function getCurrentGameweekPlayerPoints(playerName: string, teamName: string): number {
  const importedPoints = getCurrentGameweekImportedPoints(playerName, teamName)
  if (importedPoints !== null) {
    return importedPoints
  }

  const playedTeams = getCurrentGameweekPlayedTeams()
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

export function addGameweekPointsToTotal(): void {
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
