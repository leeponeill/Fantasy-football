import { getCurrentUsername, getThemePreferenceForUser, setCurrentUserThemePreference } from './auth'

const themeStorageKey = 'ff-theme'
const legacyThemeStorageKey = 'fantasy-football-theme'

export type ThemeMode = 'light' | 'dark'

export function getSavedTheme(): ThemeMode {
  const currentUsername = getCurrentUsername()
  if (currentUsername) {
    const sharedPreference = getThemePreferenceForUser(currentUsername)
    if (sharedPreference) {
      return sharedPreference
    }
  }

  try {
    const saved = localStorage.getItem(themeStorageKey)
    if (saved === 'dark' || saved === 'light') {
      return saved
    }

    const legacySaved = localStorage.getItem(legacyThemeStorageKey)
    return legacySaved === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export function applyTheme(theme: ThemeMode): void {
  document.body.classList.toggle('dark-mode', theme === 'dark')
}

export function saveTheme(theme: ThemeMode): void {
  if (getCurrentUsername()) {
    setCurrentUserThemePreference(theme)
  }

  try {
    localStorage.setItem(themeStorageKey, theme)
    localStorage.removeItem(legacyThemeStorageKey)
  } catch {
    // Ignore persistence failures and keep in-memory behavior.
  }
}

export function applyThemeFromStorage(): ThemeMode {
  const theme = getSavedTheme()
  applyTheme(theme)
  return theme
}
