export type TransferPointEventDirection = 'in' | 'out'

export type TransferPointEvent = {
  playerKey: string
  direction: TransferPointEventDirection
  Gameweek: number
  at: string
  points: number
}

function toTimestamp(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function recordTransferPointEvent(
  events: TransferPointEvent[],
  playerKey: string,
  direction: TransferPointEventDirection,
  Gameweek: number,
  getCurrentPointsByKey: (playerKey: string) => number,
): TransferPointEvent[] {
  const nextEvent: TransferPointEvent = {
    playerKey,
    direction,
    Gameweek,
    at: new Date().toISOString(),
    points: getCurrentPointsByKey(playerKey),
  }

  const nextEvents = [...events, nextEvent]
  return pruneTransferPointEvents(nextEvents, Gameweek)
}

export function pruneTransferPointEvents(events: TransferPointEvent[], currentGameweek: number): TransferPointEvent[] {
  const minGameweekToKeep = Math.max(0, currentGameweek - 1)
  return events.filter((event) => Number.isFinite(event.Gameweek) && event.Gameweek >= minGameweekToKeep)
}

export function parseTransferPointEvents(value: unknown): TransferPointEvent[] {
  if (!Array.isArray(value)) {
    return []
  }

  const parsed = value
    .filter((item): item is TransferPointEvent => {
      if (!item || typeof item !== 'object') {
        return false
      }

      const candidate = item as Record<string, unknown>
      return (
        typeof candidate.playerKey === 'string' &&
        (candidate.direction === 'in' || candidate.direction === 'out') &&
        typeof candidate.Gameweek === 'number' &&
        typeof candidate.at === 'string' &&
        typeof candidate.points === 'number'
      )
    })
    .map((event) => ({
      playerKey: event.playerKey,
      direction: event.direction,
      Gameweek: event.Gameweek,
      at: event.at,
      points: event.points,
    }))

  return parsed
}

function getPlayerCurrentGameweekPoints(
  playerKey: string,
  currentlyOwnedKeys: Set<string>,
  currentGameweek: number,
  events: TransferPointEvent[],
  getCurrentPointsByKey: (playerKey: string) => number,
): number {
  const currentPoints = getCurrentPointsByKey(playerKey)
  const playerEvents = events
    .filter((event) => event.Gameweek === currentGameweek && event.playerKey === playerKey)
    .sort((a, b) => {
      const timestampDelta = toTimestamp(a.at) - toTimestamp(b.at)
      if (timestampDelta !== 0) {
        return timestampDelta
      }
      if (a.direction === b.direction) {
        return 0
      }
      return a.direction === 'in' ? -1 : 1
    })

  const isCurrentlyOwned = currentlyOwnedKeys.has(playerKey)
  if (playerEvents.length === 0) {
    return isCurrentlyOwned ? currentPoints : 0
  }

  let owned = playerEvents[0].direction === 'out'
  let baseline = 0
  let earned = 0

  for (const event of playerEvents) {
    if (event.direction === 'in') {
      owned = true
      baseline = event.points
      continue
    }

    if (owned) {
      earned += event.points - baseline
    }
    owned = false
  }

  if (owned && isCurrentlyOwned) {
    earned += currentPoints - baseline
  }

  return earned
}

export function getTransferAwareGameweekPoints(
  selectedPlayerKeys: string[],
  currentGameweek: number,
  events: TransferPointEvent[],
  getCurrentPointsByKey: (playerKey: string) => number,
): number {
  const currentlyOwnedKeys = new Set(selectedPlayerKeys)
  const relevantPlayerKeys = new Set<string>(selectedPlayerKeys)

  for (const event of events) {
    if (event.Gameweek === currentGameweek) {
      relevantPlayerKeys.add(event.playerKey)
    }
  }

  let points = 0
  for (const playerKey of relevantPlayerKeys) {
    points += getPlayerCurrentGameweekPoints(playerKey, currentlyOwnedKeys, currentGameweek, events, getCurrentPointsByKey)
  }

  return points
}

export function getTransferAwarePlayerCurrentPoints(
  playerKey: string,
  selectedPlayerKeys: string[],
  currentGameweek: number,
  events: TransferPointEvent[],
  getCurrentPointsByKey: (playerKey: string) => number,
): number {
  return getPlayerCurrentGameweekPoints(playerKey, new Set(selectedPlayerKeys), currentGameweek, events, getCurrentPointsByKey)
}