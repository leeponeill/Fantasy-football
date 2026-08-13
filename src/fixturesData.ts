export type FixtureGame = {
  match: string
  time: string
  country?: 'Mexico' | 'USA' | 'Canada'
  date: string
}

export type FixtureGameweek = {
  Gameweek: number
  games: FixtureGame[]
}

export type WCFixtureGame = {
  match: string
  time: string
  date: string
  stadium: string
  group: string
  round: string
  homeScore?: string
  awayScore?: string
  homeYellowCards?: number
  awayYellowCards?: number
  homeRedCards?: number
  awayRedCards?: number
  scorers?: Array<{
    team: string
    player: string
    minute: string
  }>
}

export type WCFixtureGameweek = {
  Gameweek: number
  round: string
  games: WCFixtureGame[]
}

export type FixtureResult = {
  Gameweek: number
  match: string
  time: string
  country?: FixtureGame['country']
  date: string
  homeScore: string
  awayScore: string
}

type FixturesApiResponse = {
  Gameweeks: FixtureGameweek[]
}

type FixtureResultsApiResponse = {
  results: FixtureResult[]
}

let fixtureGameweeksPromise: Promise<FixtureGameweek[]> | null = null
let fixtureResultsPromise: Promise<FixtureResult[]> | null = null

let wcFixtureGameweeksPromise: Promise<WCFixtureGameweek[]> | null = null

function isFixtureCountry(value: unknown): value is FixtureGame['country'] {
  return value === 'Mexico' || value === 'USA' || value === 'Canada'
}

function isFixtureGame(value: unknown): value is FixtureGame {
  if (!value || typeof value !== 'object') {
    return false
  }

  const game = value as Record<string, unknown>
  return (
    typeof game.match === 'string' &&
    typeof game.time === 'string' &&
    typeof game.date === 'string' &&
    (typeof game.country === 'undefined' || isFixtureCountry(game.country))
  )
}

function isWCFixtureGame(value: unknown): value is WCFixtureGame {
  if (!value || typeof value !== 'object') return false
  const g = value as Record<string, unknown>
  const hasValidConduct =
    (typeof g.homeYellowCards === 'undefined' || (typeof g.homeYellowCards === 'number' && Number.isFinite(g.homeYellowCards) && g.homeYellowCards >= 0)) &&
    (typeof g.awayYellowCards === 'undefined' || (typeof g.awayYellowCards === 'number' && Number.isFinite(g.awayYellowCards) && g.awayYellowCards >= 0)) &&
    (typeof g.homeRedCards === 'undefined' || (typeof g.homeRedCards === 'number' && Number.isFinite(g.homeRedCards) && g.homeRedCards >= 0)) &&
    (typeof g.awayRedCards === 'undefined' || (typeof g.awayRedCards === 'number' && Number.isFinite(g.awayRedCards) && g.awayRedCards >= 0))
  const hasValidScorers =
    typeof g.scorers === 'undefined' ||
    (Array.isArray(g.scorers) &&
      g.scorers.every(
        (entry) =>
          entry &&
          typeof entry === 'object' &&
          typeof (entry as Record<string, unknown>).team === 'string' &&
          typeof (entry as Record<string, unknown>).player === 'string' &&
          typeof (entry as Record<string, unknown>).minute === 'string',
      ))

  return (
    typeof g.match === 'string' &&
    typeof g.time === 'string' &&
    typeof g.date === 'string' &&
    typeof g.stadium === 'string' &&
    typeof g.group === 'string' &&
    typeof g.round === 'string' &&
    (typeof g.homeScore === 'undefined' || typeof g.homeScore === 'string') &&
    (typeof g.awayScore === 'undefined' || typeof g.awayScore === 'string') &&
    hasValidConduct &&
    hasValidScorers
  )
}

function isWCFixtureGameweek(value: unknown): value is WCFixtureGameweek {
  if (!value || typeof value !== 'object') return false
  const m = value as Record<string, unknown>
  return (
    (typeof m.Gameweek === 'undefined' || typeof m.Gameweek === 'number') &&
    typeof m.round === 'string' &&
    Array.isArray(m.games) &&
    m.games.every(isWCFixtureGame)
  )
}

function isFixtureGameweek(value: unknown): value is FixtureGameweek {
  if (!value || typeof value !== 'object') {
    return false
  }

  const Gameweek = value as Record<string, unknown>
  return (
    typeof Gameweek.Gameweek === 'number' &&
    Array.isArray(Gameweek.games) &&
    Gameweek.games.every(isFixtureGame)
  )
}

function isFixtureResult(value: unknown): value is FixtureResult {
  if (!value || typeof value !== 'object') {
    return false
  }

  const result = value as Record<string, unknown>
  return (
    typeof result.Gameweek === 'number' &&
    typeof result.match === 'string' &&
    typeof result.time === 'string' &&
    typeof result.date === 'string' &&
    typeof result.homeScore === 'string' &&
    typeof result.awayScore === 'string' &&
    (typeof result.country === 'undefined' || result.country === '' || isFixtureCountry(result.country))
  )
}

export async function getFixtureGameweeks(): Promise<FixtureGameweek[]> {
  if (!fixtureGameweeksPromise) {
    fixtureGameweeksPromise = fetch('/api/fixtures')
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('Failed to load fixtures.')
        }

        const payload = (await response.json()) as FixturesApiResponse
        if (!Array.isArray(payload.Gameweeks) || !payload.Gameweeks.every(isFixtureGameweek)) {
          throw new Error('Fixture payload is invalid.')
        }

        return payload.Gameweeks
      })
      .catch((error: unknown) => {
        fixtureGameweeksPromise = null
        throw error
      })
  }

  return fixtureGameweeksPromise
}

export async function getFixtureResults(): Promise<FixtureResult[]> {
  if (!fixtureResultsPromise) {
    fixtureResultsPromise = fetch('/api/fixtures/results')
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('Failed to load fixture results.')
        }

        const payload = (await response.json()) as FixtureResultsApiResponse
        if (!Array.isArray(payload.results) || !payload.results.every(isFixtureResult)) {
          throw new Error('Fixture results payload is invalid.')
        }

        return payload.results
      })
      .catch((error: unknown) => {
        fixtureResultsPromise = null
        throw error
      })
  }

  return fixtureResultsPromise
}

export async function getWCFixtureGameweeks(): Promise<WCFixtureGameweek[]> {
  if (!wcFixtureGameweeksPromise) {
    wcFixtureGameweeksPromise = fetch('/api/wc-fixtures')
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('Failed to load WC fixtures.')
        }

        const payload = (await response.json()) as { Gameweeks: unknown[] }
        if (!Array.isArray(payload.Gameweeks) || !payload.Gameweeks.every(isWCFixtureGameweek)) {
          throw new Error('WC fixture payload is invalid.')
        }

        return payload.Gameweeks.map((entry, index) => {
          const candidate = entry as Record<string, unknown>
          const parsedGameweek = Number.parseInt(String(candidate.Gameweek ?? ''), 10)
          return {
            ...(entry as WCFixtureGameweek),
            Gameweek: Number.isFinite(parsedGameweek) ? parsedGameweek : index + 1,
          }
        })
      })
      .catch((error: unknown) => {
        wcFixtureGameweeksPromise = null
        throw error
      })
  }

  return wcFixtureGameweeksPromise
}
