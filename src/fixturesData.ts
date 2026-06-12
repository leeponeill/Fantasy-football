export type FixtureGame = {
  match: string
  time: string
  country?: 'Mexico' | 'USA' | 'Canada'
  date: string
}

export type FixtureMatchday = {
  matchday: number
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
  scorers?: Array<{
    team: string
    player: string
    minute: string
  }>
}

export type WCFixtureMatchday = {
  matchday: number
  round: string
  games: WCFixtureGame[]
}

export type FixtureResult = {
  matchday: number
  match: string
  time: string
  country?: FixtureGame['country']
  date: string
  homeScore: string
  awayScore: string
}

type FixturesApiResponse = {
  matchdays: FixtureMatchday[]
}

type FixtureResultsApiResponse = {
  results: FixtureResult[]
}

let fixtureMatchdaysPromise: Promise<FixtureMatchday[]> | null = null
let fixtureResultsPromise: Promise<FixtureResult[]> | null = null

let wcFixtureMatchdaysPromise: Promise<WCFixtureMatchday[]> | null = null

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
    hasValidScorers
  )
}

function isWCFixtureMatchday(value: unknown): value is WCFixtureMatchday {
  if (!value || typeof value !== 'object') return false
  const m = value as Record<string, unknown>
  return (
    typeof m.matchday === 'number' &&
    typeof m.round === 'string' &&
    Array.isArray(m.games) &&
    m.games.every(isWCFixtureGame)
  )
}

function isFixtureMatchday(value: unknown): value is FixtureMatchday {
  if (!value || typeof value !== 'object') {
    return false
  }

  const matchday = value as Record<string, unknown>
  return (
    typeof matchday.matchday === 'number' &&
    Array.isArray(matchday.games) &&
    matchday.games.every(isFixtureGame)
  )
}

function isFixtureResult(value: unknown): value is FixtureResult {
  if (!value || typeof value !== 'object') {
    return false
  }

  const result = value as Record<string, unknown>
  return (
    typeof result.matchday === 'number' &&
    typeof result.match === 'string' &&
    typeof result.time === 'string' &&
    typeof result.date === 'string' &&
    typeof result.homeScore === 'string' &&
    typeof result.awayScore === 'string' &&
    (typeof result.country === 'undefined' || result.country === '' || isFixtureCountry(result.country))
  )
}

export async function getFixtureMatchdays(): Promise<FixtureMatchday[]> {
  if (!fixtureMatchdaysPromise) {
    fixtureMatchdaysPromise = fetch('/api/fixtures')
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('Failed to load fixtures.')
        }

        const payload = (await response.json()) as FixturesApiResponse
        if (!Array.isArray(payload.matchdays) || !payload.matchdays.every(isFixtureMatchday)) {
          throw new Error('Fixture payload is invalid.')
        }

        return payload.matchdays
      })
      .catch((error: unknown) => {
        fixtureMatchdaysPromise = null
        throw error
      })
  }

  return fixtureMatchdaysPromise
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

export async function getWCFixtureMatchdays(): Promise<WCFixtureMatchday[]> {
  if (!wcFixtureMatchdaysPromise) {
    wcFixtureMatchdaysPromise = fetch('/api/wc-fixtures')
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('Failed to load WC fixtures.')
        }

        const payload = (await response.json()) as { matchdays: unknown[] }
        if (!Array.isArray(payload.matchdays) || !payload.matchdays.every(isWCFixtureMatchday)) {
          throw new Error('WC fixture payload is invalid.')
        }

        return payload.matchdays
      })
      .catch((error: unknown) => {
        wcFixtureMatchdaysPromise = null
        throw error
      })
  }

  return wcFixtureMatchdaysPromise
}
