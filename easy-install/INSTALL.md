# 🟢 Easy Install — No Coding Required

This folder has everything you need. One file, a few text edits, and you're done.

---

## ⚠️ Important — HTTPS Required

The Spotify Web Playback SDK **requires a secure connection (HTTPS)** to work. This is a Spotify/browser security requirement, not something we can work around.

**Your Home Assistant must be accessible via `https://`** — not `http://`.

Common ways to set this up:
- **Nabu Casa** (Home Assistant Cloud) — easiest, HTTPS built-in
- **NGINX Proxy Manager** or **Caddy** with a free Let's Encrypt certificate
- **Cloudflare Tunnel** — free, no port forwarding required
- **DuckDNS + Let's Encrypt** — free with a bit of setup

If you access HA at `http://192.168.x.x:8123`, playback will likely fail silently. Get HTTPS sorted first, then come back to this guide.

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

1. Open `index.html` (from this folder) in **Notepad** (right-click → Open with → Notepad)
2. Press **Ctrl+H** to open Find & Replace
3. Replace these three things:

| Find | Replace with |
|------|-------------|
| `YOUR_SPOTIFY_CLIENT_ID` | Your Client ID from Step 1 |
| `YOUR_SPOTIFY_CLIENT_SECRET` | Your Client Secret from Step 1 |
| `YOUR_REDIRECT_URI` | `http://YOUR-HA-IP:8123/local/jukebox/index.html` |

4. Save the file

---

## Step 3 — Copy to Home Assistant (2 minutes)

Copy `index.html` into this folder on your Home Assistant server:

```
/config/www/jukebox/index.html
```

**Via Samba/network share:**
> `\\YOUR-HA-IP\config\www\jukebox\` (create the `jukebox` folder if it doesn't exist)

**Via File Editor (HA add-on)** or **Filebrowser:**
> Upload to `/config/www/jukebox/`

**Via SSH:**
```bash
mkdir -p /config/www/jukebox
cp index.html /config/www/jukebox/index.html
```

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

**Playback doesn't start / silent failure**
→ You're likely on HTTP. The Spotify Web Playback SDK requires HTTPS. Set up a reverse proxy (NGINX Proxy Manager, Caddy, or Cloudflare Tunnel) and access HA via `https://` before trying again.

**"Premium required"**
→ Spotify playback in the browser requires a Spotify Premium subscription.

**Build error on Windows**
→ If you try to use the build script from the main README, add `encoding='utf-8'` to all `open()` calls. Or just use this pre-built file instead — that's what it's for!

---

> This pre-built file is from the latest release of [wikydtron/jukebox](https://github.com/wikydtron/jukebox).
> If you want the latest version, check the repo and grab a fresh build from the `easy-install/` folder.
