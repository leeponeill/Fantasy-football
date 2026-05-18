# Hello World TypeScript Web Page

A minimal TypeScript web page powered by Vite.

## Shared League Storage

League data is now shared across all devices that open the same hosted app URL.

- Users, team names, saved squads, player points, matchday state, and admin changes are stored centrally on the host machine.
- Signed-in browser session still stays local per device, so each phone/laptop can stay logged in as a different user.
- Shared league data is stored in `data/league-state.json`.

If two devices open the same hosted app, they are now in the same league instead of each browser having its own local-only users.

## Automatic Match Stat Import

The Award Points page now supports automatic point calculation from finished matches:

1. Go to Award Points (admin user `lee`).
2. Search a finished game (for example: `England vs France`).
3. Select a match and click `Auto Calculate And Apply Points`.

The app fetches available player stats for that game and calculates fantasy points using your existing points rules, then applies them to matching players.

### Required API key for player-level import

Match search works without configuration, but player-level stat import requires an API-Football key.

Set one of these environment variables before starting the app server:

- `APIFOOTBALL_API_KEY`
- `API_FOOTBALL_KEY`
- `APISPORTS_KEY`

Example:

```bash
export APIFOOTBALL_API_KEY="your_api_football_key_here"
npm run dev:lan
```

Without a key, the UI shows a clear message and does not apply stats.

## Prerequisites

- Node.js and npm

This environment used `nvm` to install Node.js. If `npm` is not available in your shell, run:

```bash
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
```

## Install dependencies

From the project root:

```bash
npm install
```

## Run locally (localhost)

```bash
npm run dev
```

Then open:

- http://localhost:5173

## Host on your local network (LAN)

Use this when you want to open the site from another phone, tablet, or laptop on the same network.

### Development mode (hot reload)

```bash
npm run dev:lan
```

This starts the app server on all interfaces (`0.0.0.0`) at port `5173`, with Vite running in middleware mode so shared league data and hot reload both work.

### Production preview mode

```bash
npm run host:lan
```

This runs a build and hosts the production output plus the shared league API on port `4173`.

### Find your host machine IP

On Linux, run:

```bash
hostname -I
```

Use the IPv4 address (for example: `192.168.1.108`).

On macOS, run:

```bash
ipconfig getifaddr en0
```

If you are on Ethernet instead of Wi-Fi, use:

```bash
ipconfig getifaddr en1
```

On Windows (PowerShell), run:

```powershell
ipconfig
```

Then find the `IPv4 Address` for your active network adapter.

### Open from another device

From a device on the same Wi-Fi/LAN, open one of:

- `http://YOUR_IP:5173` for development mode
- `http://YOUR_IP:4173` for production preview mode

Example:

- `http://192.168.1.108:5173`
- `http://192.168.1.108:4173`

### If another device cannot connect

- Ensure both devices are on the same network.
- Ensure the terminal is still running the host command.
- Allow the chosen port (`5173` or `4173`) through your firewall.
- If your router blocks client-to-client traffic (AP isolation), disable it or use another network.

## Host on the internet (from home computer)

Access your app from anywhere via your own domain using Cloudflare Tunnel.

### Prerequisites

- A domain on Cloudflare DNS (e.g., `example.com`)
- `cloudflared` installed (binary download or package manager)

### Install cloudflared

**Binary (no package manager issues):**

```bash
cd /tmp
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -O cloudflared
chmod +x cloudflared
sudo mv cloudflared /usr/local/bin/
cloudflared --version
```

### Setup Steps

#### 1. Log in to Cloudflare

```bash
cloudflared tunnel login
```

- A browser window opens.
- Log in with your Cloudflare account.
- Authorize the tunnel.
- A cert file saves to `~/.cloudflared/cert.pem`.

#### 2. Create a tunnel

```bash
cloudflared tunnel create fantasy-football
```

- Save the Tunnel ID printed (e.g., `002d2310-c300-44fa-934e-90fd28693d99`).

#### 3. Check your tunnel

```bash
cloudflared tunnel list
```

#### 4. Create config file

Edit `~/.cloudflared/config.yml`:

```bash
nano ~/.cloudflared/config.yml
```

Paste this (replace `TUNNEL_ID` and `your-domain.com`):

```yaml
tunnel: fantasy-football
credentials-file: /home/lee/.cloudflared/TUNNEL_ID.json

ingress:
  - hostname: your-domain.com
    service: http://localhost:4173
  - service: http_status:404
```

Save: `Ctrl+O`, Enter, `Ctrl+X`.

#### 5. Route your domain

```bash
cloudflared tunnel route dns fantasy-football your-domain.com
```

This adds a CNAME record in Cloudflare DNS pointing to the tunnel.

#### 6. Start your app

```bash
npm run host:lan
```

This builds and serves your app on `http://localhost:4173`.

#### 7. Start the tunnel (new terminal)

```bash
cloudflared tunnel run fantasy-football
```

#### 8. Access your domain

Open `https://your-domain.com` from any device, anywhere.

### Make tunnel start automatically (optional)

For a system service that starts on boot:

```bash
sudo cloudflared service install
sudo systemctl start cloudflared
sudo systemctl enable cloudflared
```

Check status:

```bash
sudo systemctl status cloudflared
```

### Troubleshooting

**Domain shows "Server not found":**
- Wait 2–5 minutes for DNS to propagate.
- Hard refresh browser: `Ctrl+Shift+R` (Windows/Linux) or `Cmd+Shift+R` (macOS).
- Verify tunnel is running: `cloudflared tunnel list`
- Check active connections: `cloudflared tunnel info fantasy-football`

**App runs but tunnel shows no connections:**
- Ensure app is running on `http://localhost:4173`.
- Check config.yml has correct port and domain.
- Restart tunnel: stop with `Ctrl+C`, then re-run `cloudflared tunnel run fantasy-football`.

**"Permission denied" on systemctl:**
- Use `sudo` for service commands.

### Notes

- Your computer must stay powered on and connected to the internet while hosting.
- Disable sleep/hibernate in system settings.
- Cloudflare Tunnel is more secure than port forwarding (no router config needed).
- League data is now stored on the host machine, but authentication is still simple app-level auth and is not suitable for internet-exposed production security.

## Build for production

```bash
npm run build
```

## Preview production build locally

```bash
npm run preview
```

This uses the same host process as LAN mode, including the shared league API.
