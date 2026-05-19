export type TransferPointEventDirection = 'in' | 'out'

export type TransferPointEvent = {
  playerKey: string
  direction: TransferPointEventDirection
  matchday: number
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
  matchday: number,
  getCurrentPointsByKey: (playerKey: string) => number,
): TransferPointEvent[] {
  const nextEvent: TransferPointEvent = {
    playerKey,
    direction,
    matchday,
    at: new Date().toISOString(),
    points: getCurrentPointsByKey(playerKey),
  }

  const nextEvents = [...events, nextEvent]
  return pruneTransferPointEvents(nextEvents, matchday)
}

export function pruneTransferPointEvents(events: TransferPointEvent[], currentMatchday: number): TransferPointEvent[] {
  const minMatchdayToKeep = Math.max(1, currentMatchday - 1)
  return events.filter((event) => Number.isFinite(event.matchday) && event.matchday >= minMatchdayToKeep)
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
        typeof candidate.matchday === 'number' &&
        typeof candidate.at === 'string' &&
        typeof candidate.points === 'number'
      )
    })
    .map((event) => ({
      playerKey: event.playerKey,
      direction: event.direction,
      matchday: event.matchday,
      at: event.at,
      points: event.points,
    }))

  return parsed
}

function getPlayerCurrentMatchdayPoints(
  playerKey: string,
  currentlyOwnedKeys: Set<string>,
  currentMatchday: number,
  events: TransferPointEvent[],
  getCurrentPointsByKey: (playerKey: string) => number,
): number {
  const currentPoints = getCurrentPointsByKey(playerKey)
  const playerEvents = events
    .filter((event) => event.matchday === currentMatchday && event.playerKey === playerKey)
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

export function getTransferAwareMatchdayPoints(
  selectedPlayerKeys: string[],
  currentMatchday: number,
  events: TransferPointEvent[],
  getCurrentPointsByKey: (playerKey: string) => number,
): number {
  const currentlyOwnedKeys = new Set(selectedPlayerKeys)
  const relevantPlayerKeys = new Set<string>(selectedPlayerKeys)

  for (const event of events) {
    if (event.matchday === currentMatchday) {
      relevantPlayerKeys.add(event.playerKey)
    }
  }

  let points = 0
  for (const playerKey of relevantPlayerKeys) {
    points += getPlayerCurrentMatchdayPoints(playerKey, currentlyOwnedKeys, currentMatchday, events, getCurrentPointsByKey)
  }

  return points
}

export function getTransferAwarePlayerCurrentPoints(
  playerKey: string,
  selectedPlayerKeys: string[],
  currentMatchday: number,
  events: TransferPointEvent[],
  getCurrentPointsByKey: (playerKey: string) => number,
): number {
  return getPlayerCurrentMatchdayPoints(playerKey, new Set(selectedPlayerKeys), currentMatchday, events, getCurrentPointsByKey)
}