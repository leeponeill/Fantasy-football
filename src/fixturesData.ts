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
