import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        fixtures: fileURLToPath(new URL('./fixtures.html', import.meta.url)),
        players: fileURLToPath(new URL('./players.html', import.meta.url)),
        myTeam: fileURLToPath(new URL('./my-team.html', import.meta.url)),
        transferHistory: fileURLToPath(new URL('./transfer-history.html', import.meta.url)),
        stats: fileURLToPath(new URL('./stats.html', import.meta.url)),
        table: fileURLToPath(new URL('./table.html', import.meta.url)),
        teamSetup: fileURLToPath(new URL('./team-setup.html', import.meta.url)),
        admin: fileURLToPath(new URL('./admin.html', import.meta.url)),
      },
    },
  },
  server: {
    allowedHosts: true,
  },
  preview: {
    allowedHosts: true,
  },
})
