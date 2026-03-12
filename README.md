# 🎵 Jukebox — Spotify Web App (AMI Style)

A retro-inspired Spotify jukebox web app with dynamic album art color extraction, animated EQ bars, and optional Home Assistant speaker integration.

![Jukebox Preview](preview.png)

## Features

- 🎨 Dynamic background color extracted from album art
- 📻 Animated EQ visualizer bars
- 🎵 Browse songs, playlists, recently played, top tracks
- 🔍 Search
- 📱 Now playing view with controls (play/pause, skip, shuffle, repeat, volume)
- 🔊 Speaker selector (Spotify Connect devices)
- 🏠 Optional Home Assistant integration for Cast & Sonos speakers

---

## Setup

### 1. Spotify App

Create a Spotify Developer app at [developer.spotify.com](https://developer.spotify.com/dashboard):

1. Create a new app
2. Set the **Redirect URI** to wherever you're hosting this (e.g. `http://localhost:8080/index.html`)
3. Copy your **Client ID** and **Client Secret**

Edit `app.js`:

```js
const CONFIG = {
  clientId: 'YOUR_CLIENT_ID',
  clientSecret: 'YOUR_CLIENT_SECRET',
  redirectUri: 'http://your-host/path/to/index.html',
  ...
}
```

### 2. Build

The app is split into `template.html` (markup + styles) and `app.js` (logic).

Build the combined `index.html`:

```bash
node build.js
# or manually:
cat template.html | sed "s|</body>|<script>$(cat app.js)</script></body>|" > index.html
```

Or just serve `template.html` and `app.js` separately — add `<script src="app.js"></script>` before `</body>`.

### 3. Host

Host anywhere — a local file server, Nginx, or inside Home Assistant as a local resource.

**Home Assistant example:**

Place `index.html` in `/config/www/jukebox/` and access via:
`http://your-ha-ip:8123/local/jukebox/index.html`

---

## Optional: Home Assistant Speaker Integration

By default the speaker button shows your active **Spotify Connect** devices. Google Cast and Sonos speakers only appear in Spotify when actively playing.

To unlock your full speaker list (including sleeping Cast/Sonos devices), connect to Home Assistant:

1. **Generate a Long-Lived Access Token** in HA:
   - Go to your HA Profile → Security → Long-Lived Access Tokens → Create Token

2. **Install SpotifyPlus** HACS integration (optional but recommended):
   - [SpotifyPlus on GitHub](https://github.com/thlucas1/homeassistantcomponent_spotifyplus)

3. **Click ⚙️** in the jukebox top bar and enter:
   - **HA URL** — e.g. `http://192.168.1.100:8123`
   - **Token** — your long-lived access token
   - **SpotifyPlus Entity ID** — e.g. `media_player.spotifyplus_yourname`

Settings are stored in **browser localStorage** — nothing is saved in the code.

Once configured, the speaker button shows your full source list and uses `media_player.select_source` to transfer playback.

---

## File Structure

```
jukebox/
├── template.html     # Markup, CSS, HTML structure (public)
├── app.js            # All JavaScript logic (public)
├── combined.html     # Built output (gitignored for local deployments)
├── index.html        # Your deployed version (gitignored)
└── README.md
```

Add to `.gitignore`:
```
combined.html
index.html
```

---

## Tech Stack

- Vanilla JS, no frameworks
- Spotify Web API (Authorization Code flow)
- CSS custom properties + animations
- Optional: Home Assistant REST API

---

## License

All Rights Reserved — © Frank Bossé
