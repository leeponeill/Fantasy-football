const sharedStoragePrefix = 'fantasy-football-'
const localOnlyStorageKeys = new Set(['fantasy-football-current-user'])

export const sharedLeagueUpdatedEvent = 'fantasy-football-shared-state-updated'

type SharedStorageSnapshot = Record<string, string>
type SharedStorageChanges = {
  set?: Record<string, string>
  remove?: string[]
}

type LeagueStateResponse = {
  storage?: Record<string, unknown>
  updatedAt?: string
}

const syncDelayMs = 120
const pollIntervalMs = 3000

let bootstrapPromise: Promise<void> | null = null
let flushPromise: Promise<void> | null = null
let syncTimerId: number | null = null
let pollTimerId: number | null = null
let lastAppliedSignature = ''
const pendingSet = new Map<string, string>()
const pendingRemove = new Set<string>()

function isSharedStorageKey(key: string): boolean {
  return key.startsWith(sharedStoragePrefix) && !localOnlyStorageKeys.has(key)
}

function sanitizeSnapshot(snapshot: Record<string, unknown> | undefined): SharedStorageSnapshot {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return {}
  }

  const nextSnapshot: SharedStorageSnapshot = {}

  for (const [key, value] of Object.entries(snapshot)) {
    if (isSharedStorageKey(key) && typeof value === 'string') {
      nextSnapshot[key] = value
    }
  }

  return nextSnapshot
}

function getSnapshotSignature(snapshot: SharedStorageSnapshot): string {
  return JSON.stringify(
    Object.keys(snapshot)
      .sort()
      .map((key) => [key, snapshot[key]]),
  )
}

function notifySharedLeagueUpdated(): void {
  window.dispatchEvent(new CustomEvent(sharedLeagueUpdatedEvent))
}

function snapshotSharedStorage(): SharedStorageSnapshot {
  const snapshot: SharedStorageSnapshot = {}

  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (!key || !isSharedStorageKey(key)) {
        continue
      }

      const value = localStorage.getItem(key)
      if (typeof value === 'string') {
        snapshot[key] = value
      }
    }
  } catch {
    return {}
  }

  return snapshot
}

function applySharedStorageSnapshot(snapshot: SharedStorageSnapshot): boolean {
  let changed = false
  const existingSharedKeys: string[] = []

  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (key && isSharedStorageKey(key)) {
        existingSharedKeys.push(key)
      }
    }

    for (const key of existingSharedKeys) {
      if (!(key in snapshot)) {
        localStorage.removeItem(key)
        changed = true
      }
    }

    for (const [key, value] of Object.entries(snapshot)) {
      if (localStorage.getItem(key) !== value) {
        localStorage.setItem(key, value)
        changed = true
      }
    }
  } catch {
    return false
  }

  return changed
}

async function fetchLeagueState(): Promise<SharedStorageSnapshot> {
  const response = await fetch('/api/league-state', {
    headers: {
      Accept: 'application/json',
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`Unable to fetch shared league state (${response.status})`)
  }

  const data = (await response.json()) as LeagueStateResponse
  return sanitizeSnapshot(data.storage)
}

async function postSharedStorageChanges(changes: SharedStorageChanges): Promise<SharedStorageSnapshot> {
  const set = Object.fromEntries(
    Object.entries(changes.set ?? {}).filter(
      ([key, value]) => isSharedStorageKey(key) && typeof value === 'string',
    ),
  )
  const remove = (changes.remove ?? []).filter((key) => isSharedStorageKey(key))

  if (Object.keys(set).length === 0 && remove.length === 0) {
    return snapshotSharedStorage()
  }

  const response = await fetch('/api/league-storage/batch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ set, remove }),
    cache: 'no-store',
    keepalive: true,
  })

  if (!response.ok) {
    throw new Error(`Unable to save shared league state (${response.status})`)
  }

  const data = (await response.json()) as LeagueStateResponse
  return sanitizeSnapshot(data.storage)
}

function scheduleFlush(): void {
  if (syncTimerId !== null) {
    window.clearTimeout(syncTimerId)
  }

  syncTimerId = window.setTimeout(() => {
    syncTimerId = null
    void flushSharedLeagueStorage()
  }, syncDelayMs)
}

export function getSharedItem(key: string): string | null {
  if (!isSharedStorageKey(key)) {
    return null
  }

  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function setSharedItem(key: string, value: string): boolean {
  if (!isSharedStorageKey(key)) {
    return false
  }

  try {
    localStorage.setItem(key, value)
    pendingSet.set(key, value)
    pendingRemove.delete(key)
    scheduleFlush()
    return true
  } catch {
    return false
  }
}

export function removeSharedItem(key: string): boolean {
  if (!isSharedStorageKey(key)) {
    return false
  }

  try {
    localStorage.removeItem(key)
    pendingSet.delete(key)
    pendingRemove.add(key)
    scheduleFlush()
    return true
  } catch {
    return false
  }
}

export function commitSharedStorageChanges(changes: SharedStorageChanges): boolean {
  const setEntries = Object.entries(changes.set ?? {}).filter(
    ([key, value]) => isSharedStorageKey(key) && typeof value === 'string',
  )
  const removeKeys = (changes.remove ?? []).filter((key) => isSharedStorageKey(key))

  try {
    for (const key of removeKeys) {
      localStorage.removeItem(key)
      pendingSet.delete(key)
      pendingRemove.add(key)
    }

    for (const [key, value] of setEntries) {
      localStorage.setItem(key, value)
      pendingSet.set(key, value)
      pendingRemove.delete(key)
    }

    if (setEntries.length > 0 || removeKeys.length > 0) {
      scheduleFlush()
    }

    return true
  } catch {
    return false
  }
}

export async function flushSharedLeagueStorage(): Promise<void> {
  if (flushPromise) {
    return flushPromise
  }

  if (syncTimerId !== null) {
    window.clearTimeout(syncTimerId)
    syncTimerId = null
  }

  const changes: SharedStorageChanges = {
    set: Object.fromEntries(pendingSet.entries()),
    remove: Array.from(pendingRemove),
  }

  pendingSet.clear()
  pendingRemove.clear()

  flushPromise = (async () => {
    try {
      const snapshot = await postSharedStorageChanges(changes)
      const changed = applySharedStorageSnapshot(snapshot)
      const nextSignature = getSnapshotSignature(snapshot)
      const shouldNotify = changed || nextSignature !== lastAppliedSignature
      lastAppliedSignature = nextSignature
      if (shouldNotify) {
        notifySharedLeagueUpdated()
      }
    } catch {
      for (const [key, value] of Object.entries(changes.set ?? {})) {
        pendingSet.set(key, value)
        pendingRemove.delete(key)
      }

      for (const key of changes.remove ?? []) {
        pendingSet.delete(key)
        pendingRemove.add(key)
      }
    } finally {
      flushPromise = null
    }
  })()

  return flushPromise
}

export async function refreshSharedLeagueStorage(): Promise<void> {
  try {
    const snapshot = await fetchLeagueState()
    const changed = applySharedStorageSnapshot(snapshot)
    const nextSignature = getSnapshotSignature(snapshot)
    const shouldNotify = changed || nextSignature !== lastAppliedSignature
    lastAppliedSignature = nextSignature

    if (shouldNotify) {
      notifySharedLeagueUpdated()
    }
  } catch {
    // Ignore transient network failures and keep local state available.
  }
}

export function startSharedLeaguePolling(): void {
  if (pollTimerId !== null) {
    return
  }

  pollTimerId = window.setInterval(() => {
    void refreshSharedLeagueStorage()
  }, pollIntervalMs)

  window.addEventListener('focus', () => {
    void refreshSharedLeagueStorage()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void refreshSharedLeagueStorage()
    }
  })
}

export async function bootstrapSharedLeagueStorage(): Promise<void> {
  if (bootstrapPromise) {
    return bootstrapPromise
  }

  bootstrapPromise = (async () => {
    try {
      const remoteSnapshot = await fetchLeagueState()
      const localSnapshot = snapshotSharedStorage()

      if (Object.keys(remoteSnapshot).length === 0 && Object.keys(localSnapshot).length > 0) {
        const mergedSnapshot = await postSharedStorageChanges({ set: localSnapshot })
        applySharedStorageSnapshot(mergedSnapshot)
        lastAppliedSignature = getSnapshotSignature(mergedSnapshot)
      } else {
        applySharedStorageSnapshot(remoteSnapshot)
        lastAppliedSignature = getSnapshotSignature(remoteSnapshot)
      }
    } catch {
      lastAppliedSignature = getSnapshotSignature(snapshotSharedStorage())
    }

    startSharedLeaguePolling()
  })()

  return bootstrapPromise
}