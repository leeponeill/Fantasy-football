export type FixtureGame = {
  match: string
  time: string
  country: 'Mexico' | 'USA' | 'Canada'
  date: string
}

export type FixtureMatchday = {
  matchday: number
  games: FixtureGame[]
}

type FixturesApiResponse = {
  matchdays: FixtureMatchday[]
}

let fixtureMatchdaysPromise: Promise<FixtureMatchday[]> | null = null

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
    isFixtureCountry(game.country)
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
