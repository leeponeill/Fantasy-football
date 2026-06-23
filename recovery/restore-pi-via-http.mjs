import { readFile, writeFile } from 'node:fs/promises'

const remoteBase = 'http://192.168.1.5:4173'
const localPath = new URL('../data/league-state.json', import.meta.url)
const backupPath = new URL('./pi-state-before-http-restore.json', import.meta.url)
const validationPath = new URL('./pi-state-after-http-restore.json', import.meta.url)

const localState = JSON.parse(await readFile(localPath, 'utf8'))
const remoteResponse = await fetch(`${remoteBase}/api/league-state`)
if (!remoteResponse.ok) {
  throw new Error(`Failed to fetch remote state: ${remoteResponse.status} ${remoteResponse.statusText}`)
}

const remoteState = await remoteResponse.json()
await writeFile(backupPath, `${JSON.stringify(remoteState, null, 2)}\n`, 'utf8')

const localStorage = localState?.storage ?? {}
const remoteStorage = remoteState?.storage ?? {}
const remove = Object.keys(remoteStorage).filter((key) => !(key in localStorage))

const postResponse = await fetch(`${remoteBase}/api/league-storage/batch`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ set: localStorage, remove }),
})
if (!postResponse.ok) {
  const text = await postResponse.text()
  throw new Error(`Failed to restore remote state: ${postResponse.status} ${postResponse.statusText} ${text}`)
}

const restoredState = await postResponse.json()
await writeFile(validationPath, `${JSON.stringify(restoredState, null, 2)}\n`, 'utf8')

const users = JSON.parse(restoredState.storage['fantasy-football-users'] ?? '[]').map((entry) => entry.username)
const profiles = JSON.parse(restoredState.storage['fantasy-football-user-profiles'] ?? '{}')
const team = JSON.parse(restoredState.storage['fantasy-football-my-team-state::lee'] ?? '{}')

console.log(JSON.stringify({
  updatedAt: restoredState.updatedAt,
  users,
  teamName: profiles.lee?.teamName ?? null,
  selectedCount: Array.isArray(team.selectedPlayerKeys) ? team.selectedPlayerKeys.length : 0,
  budget: team.remainingBudget ?? null,
}, null, 2))
