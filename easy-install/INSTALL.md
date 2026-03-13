# 🟢 Easy Install — No Coding Required

This folder has everything you need. One file, a few text edits, and you're done.

---

## ⚠️ Important — HTTPS & The Refresh Token Trick

Spotify's auth flow normally requires HTTPS to complete. But there's a workaround that lets you skip the whole HTTPS requirement for day-to-day use: **hardcoding your refresh token**.

Once you have a refresh token in the file, the app never needs to do the OAuth redirect again — it just silently refreshes your access token on load. No HTTPS needed after that.

**How to get your refresh token — pick one:**

### Option A — You have SpotifyPlus installed in Home Assistant
1. On your HA machine, open this file:
   `/config/.storage/core.config_entries`
2. Search for `spotifyplus` and find the `refresh_token` field
3. Copy that value

### Option B — Complete auth once, grab token from browser
1. Open the jukebox `index.html` directly in Chrome/Edge (not through HA) — e.g. `http://192.168.1.100:8123/local/jukebox/index.html`
2. Log in with Spotify when prompted
3. After login, press **F12** → go to **Application** tab → **Local Storage** → your HA URL
4. Find the key `jukebox_refresh` and copy its value

### Once you have the token
In your `index.html`, find this line (near the bottom):
```
const FALLBACK_REFRESH_TOKEN = '';
```
Replace the empty quotes with your token:
```
const FALLBACK_REFRESH_TOKEN = 'paste_your_token_here';
```
Save the file. Now it works over plain HTTP — no HTTPS setup required.

---

## What You Need

- A **Spotify account** (free or premium — playback requires Premium)
- **Home Assistant** accessible via **HTTPS**
- A text editor (**Notepad** on Windows, **TextEdit** on Mac)

---

## Step 1 — Create a Spotify App (5 minutes)

1. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) and log in
2. Click **Create app**
3. Fill in:
   - **App name:** `My Jukebox` (anything works)
   - **App description:** anything
   - **Redirect URIs:** `http://YOUR-HA-IP:8123/local/jukebox/index.html`
     *(Replace `YOUR-HA-IP` with your Home Assistant IP address, e.g. `192.168.1.100`)*
4. Check **Web API** and **Web Playback SDK**
5. Click **Save**
6. Click **Settings** on your new app
7. Copy your **Client ID** and **Client Secret** — you'll need them in Step 2

---

## Step 2 — Edit the File (2 minutes)

**Open `index.html` in a text editor:**
- 🪟 **Windows** — Right-click `index.html` → Open with → **Notepad**
- 🍎 **Mac** — Right-click → Open With → **TextEdit** *(make sure TextEdit is in plain text mode: Format → Make Plain Text)*
- 🐧 **Linux** — Open with **gedit**, **Kate**, or any text editor

**Then use Find & Replace:**
- Windows/Linux: **Ctrl+H**
- Mac: **Cmd+H** (or Edit → Find → Find and Replace)

3. Replace these three things:

| Find | Replace with |
|------|-------------|
| `YOUR_SPOTIFY_CLIENT_ID` | Your Client ID from Step 1 |
| `YOUR_SPOTIFY_CLIENT_SECRET` | Your Client Secret from Step 1 |
| `YOUR_REDIRECT_URI` | `http://YOUR-HA-IP:8123/local/jukebox/index.html` |
| `FALLBACK_REFRESH_TOKEN = ''` | `FALLBACK_REFRESH_TOKEN = 'your_token'` *(optional but recommended — see the HTTPS section above)* |

4. Save the file

---

## Step 3 — Copy to Home Assistant (2 minutes)

Copy `index.html` into this folder on your Home Assistant server:

```
/config/www/jukebox/index.html
```

Create the `jukebox` folder if it doesn't exist yet.

---

### 🪟 Windows

1. Open **File Explorer** and type this in the address bar (replace with your HA IP):
   ```
   \\192.168.1.100\config\www
   ```
2. If it asks for a username/password, try `homeassistant` / no password, or check your HA Samba add-on settings
3. Create a folder called `jukebox` inside `www`
4. Copy `index.html` into it

> **Don't see a `www` folder?** Create it too — HA won't show it until something is in it.

---

### 🍎 Mac

1. In **Finder**, press **Cmd+K** and enter:
   ```
   smb://192.168.1.100/config
   ```
2. Navigate to `www`, create a `jukebox` folder, and drop `index.html` in
3. If prompted for credentials, use your HA Samba add-on username/password

---

### 🐧 Linux / SSH

```bash
mkdir -p /config/www/jukebox
cp index.html /config/www/jukebox/index.html
```

---

### Via HA File Editor or Filebrowser add-on

Open the add-on, navigate to `/config/www/`, create a `jukebox` folder, and upload `index.html`.

---

## Step 4 — Add it to Home Assistant (2 minutes)

1. In HA, go to **Settings → Dashboards → Add Dashboard**
2. Give it a name (e.g. `Jukebox`) and an icon (`mdi:music-box`)
3. Open the new dashboard and click **Edit Dashboard**
4. Add a card → **Webpage** (or iframe card)
5. Set the URL to: `/local/jukebox/index.html`
6. Save

Done! 🎉

---

## Troubleshooting

**"INVALID_CLIENT: Invalid redirect URI"**
→ Double-check that the redirect URI in your Spotify app *exactly* matches what you put in the file (same IP, same port, same path).

**Blank screen / nothing loads**
→ Make sure the file is at `/config/www/jukebox/index.html` and not in a subfolder.

**Stuck on the redirect screen / auth doesn't complete**
→ Spotify's auth flow doesn't work inside the HA iframe over HTTP. Use the **refresh token trick** from the HTTPS section above — complete auth once by opening the file directly in your browser, grab the token from localStorage (F12 → Application → Local Storage → `jukebox_refresh`), paste it into the file as `FALLBACK_REFRESH_TOKEN`, and you're done.

**"INVALID_CLIENT: Invalid redirect URI"**
→ Double-check that the redirect URI in your Spotify app *exactly* matches what you put in the file (same IP, same port, same path). If it looks right but still fails — **clear your browser cache and cookies** and try again from scratch. Stale cached auth data is usually the real cause.

**"Premium required"**
→ Spotify playback in the browser requires a Spotify Premium subscription.

**Build error on Windows**
→ If you try to use the build script from the main README, add `encoding='utf-8'` to all `open()` calls. Or just use this pre-built file instead — that's what it's for!

---

> This pre-built file is from the latest release of [wikydtron/jukebox](https://github.com/wikydtron/jukebox).
> If you want the latest version, check the repo and grab a fresh build from the `easy-install/` folder.
