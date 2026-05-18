import './style.css'
import {
	getCurrentUsername,
	getRegisteredUserCount,
	getTeamNameForUser,
	registerUser,
	requestPasswordReset,
	signIn,
} from './auth'
import { flushSharedLeagueStorage, sharedLeagueUpdatedEvent } from './sharedLeague'

function getPostLoginPath(username: string): string {
	const teamName = getTeamNameForUser(username)
	return teamName ? '/fixtures.html' : '/team-setup.html'
}

const existingSession = getCurrentUsername()
if (existingSession) {
	const destination = getPostLoginPath(existingSession)
	if (window.location.pathname !== destination) {
		window.location.replace(destination)
	}
}

const app = document.querySelector<HTMLDivElement>('#app')

if (app) {
	app.innerHTML = `
		<main class="auth-page">
			<section class="auth-card">
				<div class="auth-logo-wrap">
					<img src="/crest-logo.png" alt="League crest" class="auth-logo" />
				</div>
				<h1>Fantasy Football Login</h1>
				<p class="auth-help">Sign in to manage your personal team. Up to 10 users are supported.</p>
				<p class="auth-meta" id="user-count">Registered users: ${getRegisteredUserCount()}/10</p>

				<div class="auth-grid">
					<form id="signin-form" class="auth-form" autocomplete="on">
						<h2>Sign In</h2>
						<label for="signin-username">Username</label>
						<input id="signin-username" name="username" type="text" required />
						<label for="signin-password">Password</label>
						<input id="signin-password" name="password" type="password" required />
						<button type="submit">Sign In</button>
						<button id="forgot-password-btn" type="button" class="logout-btn">Forgot Password</button>
					</form>

					<section class="auth-form">
						<h2>Create User</h2>
						<button id="toggle-signup-btn" type="button" aria-expanded="false">Create User</button>
						<form id="signup-form" class="signup-collapsible is-collapsed" autocomplete="on">
							<label for="signup-username">Username</label>
							<input id="signup-username" name="username" type="text" required />
							<label for="signup-password">Password</label>
							<input id="signup-password" name="password" type="password" required />
							<button type="submit">Create User</button>
						</form>
					</section>
				</div>

				<p id="auth-message" class="auth-message" aria-live="polite"></p>
			</section>
		</main>
	`

	const message = document.querySelector<HTMLParagraphElement>('#auth-message')
	const userCount = document.querySelector<HTMLParagraphElement>('#user-count')
	const signinForm = document.querySelector<HTMLFormElement>('#signin-form')
	const signupForm = document.querySelector<HTMLFormElement>('#signup-form')
	const toggleSignupBtn = document.querySelector<HTMLButtonElement>('#toggle-signup-btn')
	const forgotPasswordBtn = document.querySelector<HTMLButtonElement>('#forgot-password-btn')

	const setMessage = (text: string, type: 'ok' | 'error'): void => {
		if (!message) {
			return
		}

		message.textContent = text
		message.classList.remove('ok', 'error')
		message.classList.add(type)
	}

	const refreshUserCount = (): void => {
		if (userCount) {
			userCount.textContent = `Registered users: ${getRegisteredUserCount()}/10`
		}
	}

	window.addEventListener(sharedLeagueUpdatedEvent, refreshUserCount)

	if (signinForm) {
		signinForm.addEventListener('submit', (event) => {
			event.preventDefault()
			const formData = new FormData(signinForm)
			const username = String(formData.get('username') ?? '')
			const password = String(formData.get('password') ?? '')
			const result = signIn(username, password)

			if (!result.ok) {
				setMessage(result.error ?? 'Unable to sign in.', 'error')
				return
			}

			const signedInUsername = getCurrentUsername() ?? username
			window.location.replace(getPostLoginPath(signedInUsername))
		})
	}

	if (forgotPasswordBtn) {
		forgotPasswordBtn.addEventListener('click', async () => {
			const usernameInput = document.querySelector<HTMLInputElement>('#signin-username')
			const username = usernameInput?.value?.trim() ?? ''

			if (!username) {
				setMessage('Enter your username first, then click Forgot Password.', 'error')
				return
			}

			const result = requestPasswordReset(username)
			if (!result.ok) {
				setMessage(result.error ?? 'Unable to submit password reset request.', 'error')
				return
			}

			await flushSharedLeagueStorage()

			setMessage('Password reset request sent. Ask admin user lee to reset your password.', 'ok')
		})
	}

	if (signupForm) {
		signupForm.addEventListener('submit', async (event) => {
			event.preventDefault()
			const formData = new FormData(signupForm)
			const username = String(formData.get('username') ?? '')
			const password = String(formData.get('password') ?? '')

			const registerResult = registerUser(username, password)
			if (!registerResult.ok) {
				setMessage(registerResult.error ?? 'Unable to create user.', 'error')
				refreshUserCount()
				return
			}

			await flushSharedLeagueStorage()

			const signInResult = signIn(username, password)
			if (!signInResult.ok) {
				setMessage(signInResult.error ?? 'User created, but sign-in failed.', 'error')
				refreshUserCount()
				return
			}

			const signedInUsername = getCurrentUsername() ?? username
			window.location.replace(getPostLoginPath(signedInUsername))
		})
	}

	if (signupForm && toggleSignupBtn) {
		toggleSignupBtn.addEventListener('click', () => {
			const isCollapsed = signupForm.classList.contains('is-collapsed')
			if (isCollapsed) {
				signupForm.classList.remove('is-collapsed')
				toggleSignupBtn.textContent = 'Hide Create User'
				toggleSignupBtn.setAttribute('aria-expanded', 'true')
				return
			}

			signupForm.classList.add('is-collapsed')
			toggleSignupBtn.textContent = 'Create User'
			toggleSignupBtn.setAttribute('aria-expanded', 'false')
		})
	}
}
