/* ============================================
   JUKEBOX — Spotify Web App (AMI Style)
   ============================================ */

// === CONFIG ===
const CONFIG = {
  clientId: 'YOUR_SPOTIFY_CLIENT_ID',
  clientSecret: 'YOUR_SPOTIFY_CLIENT_SECRET',
  redirectUri: 'YOUR_REDIRECT_URI',
  scopes: [
    'user-read-playback-state',
    'user-modify-playback-state',
    'user-read-currently-playing',
    'user-read-recently-played',
    'user-library-read',
    'user-top-read',
    'playlist-read-private',
    'playlist-read-collaborative',
    'streaming'
  ].join(' ')
};

// === STATE ===
let state = {
  token: null,
  tokenExpiry: 0,
  refreshToken: null,
  currentView: 'home',
  player: null,
  devices: [],
  activeDevice: null,
  playlists: [],
  nowPlaying: null,
  pollInterval: null,
  searchTimeout: null,
  cachedViews: {}
};

// === SPOTIFY AUTH (Authorization Code + Client Secret) ===
function spotifyAuth() {
  const params = new URLSearchParams({
    client_id: CONFIG.clientId,
    response_type: 'code',
    redirect_uri: CONFIG.redirectUri,
    scope: CONFIG.scopes,
    show_dialog: 'false'
  });

  // Direct redirect — simplest, most reliable
  window.location.href = 'https://accounts.spotify.com/authorize?' + params;
}

async function handleAuthCallback(code) {
  const basicAuth = btoa(CONFIG.clientId + ':' + CONFIG.clientSecret);

  const resp = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + basicAuth
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: CONFIG.redirectUri
    })
  });

  const data = await resp.json();
  if (data.access_token) {
    state.token = data.access_token;
    state.tokenExpiry = Date.now() + (data.expires_in * 1000);
    state.refreshToken = data.refresh_token;
    localStorage.setItem('jukebox_token', data.access_token);
    localStorage.setItem('jukebox_refresh', data.refresh_token);
    localStorage.setItem('jukebox_expiry', state.tokenExpiry.toString());
    try { window.history.replaceState({}, '', CONFIG.redirectUri); } catch(e) {}
    initApp();
  } else {
    console.error('Token exchange failed:', data);
    document.getElementById('auth-screen').innerHTML += '<div style="color:red;margin-top:20px">Auth error: ' + (data.error_description || data.error || 'unknown') + '</div>';
    showAuth();
  }
}

async function refreshAccessToken() {
  if (!state.refreshToken) return false;
  try {
    const basicAuth = btoa(CONFIG.clientId + ':' + CONFIG.clientSecret);
    const resp = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + basicAuth
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: state.refreshToken
      })
    });
    const data = await resp.json();
    if (data.access_token) {
      state.token = data.access_token;
      state.tokenExpiry = Date.now() + (data.expires_in * 1000);
      if (data.refresh_token) state.refreshToken = data.refresh_token;
      localStorage.setItem('jukebox_token', data.access_token);
      localStorage.setItem('jukebox_expiry', state.tokenExpiry.toString());
      if (data.refresh_token) localStorage.setItem('jukebox_refresh', data.refresh_token);
      return true;
    }
  } catch (e) { console.error('Token refresh failed:', e); }
  return false;
}

// === SPOTIFY API ===
async function api(endpoint, method = 'GET', body = null) {
  // Auto-refresh if token expiring soon
  if (Date.now() > state.tokenExpiry - 60000) {
    const ok = await refreshAccessToken();
    if (!ok) { showAuth(); return null; }
  }

  const opts = {
    method,
    headers: { 'Authorization': 'Bearer ' + state.token }
  };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  try {
    const resp = await fetch('https://api.spotify.com/v1' + endpoint, opts);
    if (resp.status === 401) {
      const ok = await refreshAccessToken();
      if (ok) return api(endpoint, method, body);
      showAuth(); return null;
    }
    if (resp.status === 204) return {};
    if (resp.ok) return await resp.json();
    console.warn('API error:', resp.status, await resp.text());
    return null;
  } catch (e) {
    console.error('API fetch error:', e);
    return null;
  }
}

// === PLAYBACK HELPERS ===
async function play(uri, context_uri = null, offset = null) {
  const body = {};
  if (context_uri) {
    body.context_uri = context_uri;
    if (offset !== null) body.offset = { position: offset };
  } else if (uri) {
    body.uris = [uri];
  }
  await api('/me/player/play', 'PUT', body);
  setTimeout(pollNowPlaying, 500);
}

async function pause() { await api('/me/player/pause', 'PUT'); pollNowPlaying(); }
async function next() { await api('/me/player/next', 'POST'); setTimeout(pollNowPlaying, 500); }
async function prev() { await api('/me/player/previous', 'POST'); setTimeout(pollNowPlaying, 500); }

async function toggleShuffle() {
  if (!state.nowPlaying) return;
  const val = !state.nowPlaying.shuffle_state;
  await api('/me/player/shuffle?state=' + val, 'PUT');
  setTimeout(pollNowPlaying, 300);
}

async function toggleRepeat() {
  if (!state.nowPlaying) return;
  const modes = ['off', 'context', 'track'];
  const curr = modes.indexOf(state.nowPlaying.repeat_state);
  const next_mode = modes[(curr + 1) % 3];
  await api('/me/player/repeat?state=' + next_mode, 'PUT');
  setTimeout(pollNowPlaying, 300);
}

async function setVolume(vol) {
  await api('/me/player/volume?volume_percent=' + Math.round(vol), 'PUT');
}

async function seekTo(posMs) {
  await api('/me/player/seek?position_ms=' + Math.round(posMs), 'PUT');
}

async function transferPlayback(deviceId) {
  await api('/me/player', 'PUT', { device_ids: [deviceId], play: true });
  setTimeout(pollNowPlaying, 1000);
  hideDevices();
}

// === NOW PLAYING POLL ===
async function pollNowPlaying() {
  const data = await api('/me/player');
  state.nowPlaying = data;
  updateNowPlaying(data);
}

function updateNowPlaying(data) {
  const art = document.getElementById('np-art');
  const track = document.getElementById('np-track');
  const artist = document.getElementById('np-artist');
  const speaker = document.getElementById('speaker-name');

  if (data && data.item) {
    const img = data.item.album?.images?.[0]?.url || '';
    art.src = img;
    art.style.display = img ? 'block' : 'none';
    track.textContent = data.item.name || 'Unknown';
    artist.textContent = data.item.artists?.map(a => a.name).join(', ') || '—';
    if (data.device) {
      speaker.textContent = data.device.name || 'Unknown';
      state.activeDevice = data.device;
    }
  } else {
    art.style.display = 'none';
    track.textContent = 'Not Playing';
    artist.textContent = '—';
  }
}

// === DEVICE PICKER ===
async function showDevices() {
  const data = await api('/me/player/devices');
  if (!data || !data.devices) return;
  state.devices = data.devices;

  const list = document.getElementById('device-list');
  list.innerHTML = data.devices.map(d => `
    <div class="device-item ${d.is_active ? 'active' : ''}" onclick="transferPlayback('${d.id}')">
      <svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
      <div>
        <div class="device-name">${d.name}</div>
        <div class="device-type">${d.type}${d.is_active ? ' • Active' : ''}</div>
      </div>
    </div>
  `).join('');

  document.getElementById('device-modal').classList.remove('hidden');
}

function hideDevices() {
  document.getElementById('device-modal').classList.add('hidden');
}

// === NAVIGATION ===
function navigate(view) {
  state.currentView = view;

  // Update sidebar
  document.querySelectorAll('.sidebar-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.view === view);
  });

  // Update bottom bar
  document.querySelectorAll('.bottom-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.view === view);
  });

  renderView(view);
}

async function renderView(view) {
  const main = document.getElementById('main');
  main.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  switch (view) {
    case 'home': await renderHome(main); break;
    case 'search': renderSearch(main); break;
    case 'genres': await renderGenres(main); break;
    case 'newreleases': await renderNewReleases(main); break;
    case 'playlists': await renderPlaylists(main); break;
    case 'topartists': await renderTopArtists(main); break;
    case 'nowplaying': renderNowPlaying(main); break;
    default: main.innerHTML = '<div class="loading">Unknown view</div>';
  }
}

// === VIEWS ===

// HOME
async function renderHome(container) {
  // Fetch data in parallel
  const [recentData, topData, topArtistsData] = await Promise.all([
    api('/me/player/recently-played?limit=6'),
    api('/me/top/tracks?limit=6&time_range=short_term'),
    api('/me/top/artists?limit=6&time_range=medium_term')
  ]);

  let html = '';

  const recentTracks = recentData?.items || [];
  const topTracks = topData?.items || [];
  const topArtists = topArtistsData?.items || [];

  // 3-column AMI layout
  html += '<div class="columns-grid">';

  // Column 1: Hot Songs (top tracks)
  html += '<div class="column-card">';
  html += '<div class="column-header"><div class="column-title" style="color:var(--orange)">Top Plays</div><div class="column-sub">Your most played</div></div>';
  html += '<div class="track-list">';
  topTracks.forEach((t, i) => {
    const art = t.album?.images?.[t.album.images.length - 1]?.url || '';
    html += trackRow(i + 1, t.name, t.artists?.[0]?.name, art, t.uri, t.album?.uri, '--orange');
  });
  html += '</div>';
  html += '<button class="view-all-btn" onclick="navigate(\'search\')">View All</button>';
  html += '</div>';

  // Column 2: Recently Played
  html += '<div class="column-card">';
  html += '<div class="column-header"><div class="column-title" style="color:var(--pink)">Recently Played</div><div class="column-sub">What you\'ve been listening to</div></div>';
  html += '<div class="track-list">';
  recentTracks.forEach((item, i) => {
    const t = item.track;
    const art = t.album?.images?.[t.album.images.length - 1]?.url || '';
    html += trackRow(i + 1, t.name, t.artists?.[0]?.name, art, t.uri, t.album?.uri, '--pink');
  });
  html += '</div>';
  html += '<button class="view-all-btn" onclick="navigate(\'playlists\')">View All</button>';
  html += '</div>';

  // Column 3: Your Top Artists
  html += '<div class="column-card">';
  html += '<div class="column-header"><div class="column-title" style="color:var(--cyan)">Top Artists</div><div class="column-sub">Your most played</div></div>';
  html += '<div class="track-list">';
  topArtists.forEach((a, i) => {
    const art = a.images?.[a.images.length - 1]?.url || '';
    html += `<div class="track-row" onclick="openArtist('${a.id}')">
      <div class="track-num" style="color:var(--cyan)">${String(i + 1).padStart(2, '0')}</div>
      <div class="track-info">
        <div class="track-name">${esc(a.name)}</div>
        <div class="track-artist">${esc(a.genres?.slice(0, 2).join(', ') || '')}</div>
      </div>
      <img class="track-art" src="${art}" alt="" style="border-radius:50%" loading="lazy">
    </div>`;
  });
  html += '</div>';
  html += '<button class="view-all-btn" onclick="navigate(\'search\')">Discover More</button>';
  html += '</div>';

  html += '</div>'; // end columns-grid

  // User playlists as cards below
  if (state.playlists.length) {
    html += '<div class="section-block">';
    html += '<div class="section-header"><div><div class="section-title">Your Playlists</div></div>';
    html += '<button class="section-viewall" onclick="navigate(\'playlists\')">View All</button></div>';
    html += '<div class="card-grid">';
    state.playlists.slice(0, 12).forEach(p => {
      const art = p.images?.[0]?.url || '';
      html += `<div class="card-item" onclick="openPlaylist('${p.id}')">
        <img class="card-art" src="${art}" alt="" loading="lazy">
        <div class="card-name">${esc(p.name)}</div>
        <div class="card-desc">${p.tracks?.total || 0} tracks</div>
      </div>`;
    });
    html += '</div></div>';
  }

  container.innerHTML = html;
}

// SEARCH — uses window-level handler to guarantee it works
function renderSearch(container) {
  container.innerHTML = `
    <div style="display:flex;gap:8px;max-width:520px;margin-bottom:20px">
      <div style="position:relative;flex:1">
        <svg class="search-icon" viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 0 0 1.48-5.34c-.47-2.78-2.79-5-5.59-5.34a6.505 6.505 0 0 0-7.27 7.27c.34 2.8 2.56 5.12 5.34 5.59a6.5 6.5 0 0 0 5.34-1.48l.27.28v.79l4.25 4.25c.41.41 1.08.41 1.49 0 .41-.41.41-1.08 0-1.49L15.5 14zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
        <input class="search-input" id="search-input" type="text" placeholder="Search songs, artists, albums...">
      </div>
      <button id="search-go-btn" style="background:var(--pink);color:white;border:none;padding:0 20px;border-radius:24px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit;letter-spacing:1px">GO</button>
    </div>
    <div id="search-results"></div>
  `;
  setTimeout(wireSearch, 50);
}

function wireSearch() {
  const inp = document.getElementById('search-input');
  const btn = document.getElementById('search-go-btn');
  if (!inp || !btn) { console.error('Search elements not found'); return; }

  window._searchGo = function() {
    const q = inp.value.trim();
    if (!q) return;
    document.getElementById('search-results').innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    doSearch(q);
  };

  btn.onclick = window._searchGo;
  inp.onkeydown = function(e) { if (e.key === 'Enter') window._searchGo(); };
  
  let timer = null;
  inp.oninput = function() {
    clearTimeout(timer);
    const q = inp.value.trim();
    if (q.length < 2) { document.getElementById('search-results').innerHTML = ''; return; }
    timer = setTimeout(window._searchGo, 500);
  };

  inp.focus();
}

async function getFreshToken() {
  const basic = btoa(CONFIG.clientId + ':' + CONFIG.clientSecret);
  const resp = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': 'Basic ' + basic },
    body: 'grant_type=refresh_token&refresh_token=' + (state.refreshToken || FALLBACK_REFRESH_TOKEN)
  });
  const d = await resp.json();
  if (d.access_token) {
    state.token = d.access_token;
    state.tokenExpiry = Date.now() + (d.expires_in * 1000);
    if (d.refresh_token) state.refreshToken = d.refresh_token;
  }
  return d.access_token || null;
}

async function doSearch(query) {
  const resultsEl = document.getElementById('search-results');
  if (!resultsEl) return;

  resultsEl.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  let data;
  try {
    // Use existing token if valid, otherwise just use it anyway (api() handles refresh)
    let token = state.token;
    if (!token || Date.now() > state.tokenExpiry - 30000) {
      
      const ok = await refreshAccessToken();
      if (!ok) {
        resultsEl.innerHTML = '<div class="lyrics-empty">Could not refresh token</div>';
        return;
      }
      token = state.token;
    }

    
    const url = 'https://api.spotify.com/v1/search?q=' + encodeURIComponent(query) + '&type=track,artist,album,playlist&limit=8';
    const resp = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
    if (!resp.ok) {
      resultsEl.innerHTML = '<div class="lyrics-empty">Spotify error ' + resp.status + '</div>';
      return;
    }
    const text = await resp.text();
    data = JSON.parse(text);
  } catch(err) {
    resultsEl.innerHTML = '<div class="lyrics-empty">Error: ' + err.name + ' - ' + err.message + '</div>';
    return;
  }
  if (!data) { resultsEl.innerHTML = '<div class="lyrics-empty">No results</div>'; return; }

  try {

  let html = '';

  // Tracks
  if (data.tracks?.items?.length) {
    html += '<div class="section-block">';
    html += '<div class="section-header"><div class="section-title" style="color:var(--pink)">Songs</div></div>';
    html += '<div class="track-list">';
    data.tracks.items.filter(Boolean).forEach((t, i) => {
      const art = t.album?.images?.[t.album.images.length - 1]?.url || '';
      html += trackRow(i + 1, t.name, t.artists?.[0]?.name, art, t.uri, null, '--pink');
    });
    html += '</div></div>';
  }

  // Artists
  if (data.artists?.items?.length) {
    html += '<div class="section-block">';
    html += '<div class="section-header"><div class="section-title" style="color:var(--cyan)">Artists</div></div>';
    html += '<div class="card-grid">';
    data.artists.items.filter(Boolean).forEach(a => {
      const art = a.images?.[0]?.url || '';
      html += `<div class="card-item" onclick="openArtist('${a.id}')">
        <img class="card-art" src="${art}" alt="" style="border-radius:50%" loading="lazy">
        <div class="card-name">${esc(a.name)}</div>
        <div class="card-desc">${a.genres?.slice(0, 2).join(', ') || 'Artist'}</div>
      </div>`;
    });
    html += '</div></div>';
  }

  // Albums
  if (data.albums?.items?.length) {
    html += '<div class="section-block">';
    html += '<div class="section-header"><div class="section-title" style="color:var(--yellow)">Albums</div></div>';
    html += '<div class="card-grid">';
    data.albums.items.filter(Boolean).forEach(a => {
      const art = a.images?.[0]?.url || '';
      html += `<div class="card-item" onclick="openAlbum('${a.id}')">
        <img class="card-art" src="${art}" alt="" loading="lazy">
        <div class="card-name">${esc(a.name)}</div>
        <div class="card-desc">${esc(a.artists?.[0]?.name || '')}</div>
      </div>`;
    });
    html += '</div></div>';
  }

  // Playlists
  if (data.playlists?.items?.length) {
    html += '<div class="section-block">';
    html += '<div class="section-header"><div class="section-title" style="color:var(--green)">Playlists</div></div>';
    html += '<div class="card-grid">';
    data.playlists.items.filter(Boolean).forEach(p => {
      const art = p.images?.[0]?.url || '';
      html += `<div class="card-item" onclick="openPlaylist('${p.id}')">
        <img class="card-art" src="${art}" alt="" loading="lazy">
        <div class="card-name">${esc(p.name)}</div>
        <div class="card-desc">${p.tracks?.total || 0} tracks</div>
      </div>`;
    });
    html += '</div></div>';
  }

  resultsEl.innerHTML = html || '<div class="lyrics-empty">No results found</div>';
  } catch(renderErr) {
    resultsEl.innerHTML = '<div class="lyrics-empty">Render error: ' + renderErr.message + '</div>';
  }
}

// GENRES
async function renderGenres(container) {
  const data = await api('/browse/categories?limit=40&locale=en_US');
  if (!data?.categories?.items) { container.innerHTML = '<div class="loading">Could not load genres</div>'; return; }

  const colors = ['#e13300', '#1e3264', '#e8115b', '#148a08', '#f59b23', '#8c67ab', '#ba5d07', '#e91429', '#1db954', '#509bf5', '#b49bc8', '#dc148c', '#0d73ec', '#e61e32', '#8d67ab', '#d84000', '#477d95', '#eb1e32', '#27856a', '#af2896', '#1072ec', '#f037a5', '#e61e32', '#608108'];

  let html = '<div class="section-block"><div class="section-header"><div class="section-title">Browse Genres</div></div>';
  html += '<div class="genre-grid">';
  data.categories.items.forEach((cat, i) => {
    const bg = colors[i % colors.length];
    const icon = cat.icons?.[0]?.url || '';
    html += `<div class="genre-card" style="background:linear-gradient(135deg, ${bg}dd, ${bg}66)" onclick="openCategory('${cat.id}', '${esc(cat.name).replace(/'/g, "\\'")}')">
      ${icon ? `<img class="genre-card-img" src="${icon}" alt="">` : ''}
      <span class="genre-card-label">${esc(cat.name)}</span>
    </div>`;
  });
  html += '</div></div>';
  container.innerHTML = html;
}

// NEW RELEASES
async function renderNewReleases(container) {
  const data = await api('/browse/new-releases?limit=20');
  if (!data?.albums?.items) { container.innerHTML = '<div class="loading">Could not load</div>'; return; }

  let html = '<div class="section-block"><div class="section-header"><div class="section-title" style="color:var(--cyan)">New Releases</div></div>';
  html += '<div class="card-grid">';
  data.albums.items.forEach(a => {
    const art = a.images?.[0]?.url || '';
    html += `<div class="card-item" onclick="openAlbum('${a.id}')">
      <img class="card-art" src="${art}" alt="" loading="lazy">
      <div class="card-name">${esc(a.name)}</div>
      <div class="card-desc">${esc(a.artists?.[0]?.name || '')}</div>
    </div>`;
  });
  html += '</div></div>';
  container.innerHTML = html;
}

// PLAYLISTS (full view)
async function renderPlaylists(container) {
  if (!state.playlists.length) {
    const data = await api('/me/playlists?limit=50');
    state.playlists = data?.items || [];
  }

  let html = '<div class="section-block"><div class="section-header"><div class="section-title">Your Playlists</div></div>';
  html += '<div class="card-grid">';
  state.playlists.forEach(p => {
    const art = p.images?.[0]?.url || '';
    html += `<div class="card-item" onclick="openPlaylist('${p.id}')">
      <img class="card-art" src="${art}" alt="" loading="lazy">
      <div class="card-name">${esc(p.name)}</div>
      <div class="card-desc">${p.tracks?.total || 0} tracks</div>
    </div>`;
  });
  html += '</div></div>';
  container.innerHTML = html;
}

// TOP ARTISTS (full view)
async function renderTopArtists(container) {
  const data = await api('/me/top/artists?limit=30&time_range=medium_term');
  if (!data?.items?.length) { container.innerHTML = '<div class="loading">No data yet</div>'; return; }

  let html = '<div class="section-block"><div class="section-header"><div class="section-title" style="color:var(--pink)">Your Top Artists</div></div>';
  html += '<div class="card-grid">';
  data.items.forEach(a => {
    const art = a.images?.[0]?.url || '';
    html += `<div class="card-item" onclick="openArtist('${a.id}')">
      <img class="card-art" src="${art}" alt="" style="border-radius:50%" loading="lazy">
      <div class="card-name">${esc(a.name)}</div>
      <div class="card-desc">${esc(a.genres?.slice(0, 2).join(', ') || '')}</div>
    </div>`;
  });
  html += '</div></div>';
  container.innerHTML = html;
}

// === NOW PLAYING (full vinyl view with LIVE updates) ===
let npUpdateInterval = null;
let npLocalProgress = 0;
let npDuration = 0;
let npIsPlaying = false;
let npCurrentTrackId = null;
let npSyncedLyrics = null; // [{time: ms, text: string}]

function renderNowPlaying(container) {
  const np = state.nowPlaying;
  if (!np || !np.item) {
    container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:80vh;flex-direction:column;gap:16px"><div style="font-size:48px">♪</div><div style="color:var(--text3)">Nothing playing</div></div>';
    return;
  }

  const t = np.item;
  const art = t.album?.images?.[0]?.url || '';
  npLocalProgress = np.progress_ms || 0;
  npDuration = t.duration_ms || 1;
  npIsPlaying = np.is_playing;

  container.innerHTML = `
    <div class="np-full">
      <div class="np-vinyl-side">
        <div class="vinyl-container">
          <div class="turntable-body">
            <div class="turntable-speed">
              <div class="turntable-speed-dot active"></div>
              <div class="turntable-speed-dot"></div>
            </div>
          </div>
          <div class="vinyl-led-ring"></div>
          <div class="vinyl-platter"></div>
          <div class="vinyl-disc" id="vinyl-disc">
            <div class="vinyl-glow"></div>
            <div class="vinyl-label"><img src="${art}" alt="" id="vinyl-art"></div>
            <div class="vinyl-hole"></div>
          </div>
          <div class="tonearm" id="tonearm">
            <div class="tonearm-head"></div>
            <div class="tonearm-weight"></div>
          </div>
          <div class="turntable-led"></div>
        </div>
      </div>

      <div class="np-info-side">
        <div>
          <div class="np-track-full" id="np-title">${esc(t.name)}</div>
          <div class="np-artist-full" id="np-artist-full">${esc(t.artists?.map(a => a.name).join(', '))}</div>
          <div class="np-album-full" id="np-album-full">${esc(t.album?.name || '')}</div>
        </div>

        <div class="progress-bar">
          <span class="progress-time" id="np-elapsed">${formatMs(npLocalProgress)}</span>
          <div class="progress-track" id="np-progress-track" onclick="seekFromClick(event, npDuration)">
            <div class="progress-fill" id="np-progress-fill"></div>
          </div>
          <span class="progress-time" id="np-total">${formatMs(npDuration)}</span>
        </div>

        <div class="transport">
          <button class="transport-btn" id="btn-shuffle" onclick="toggleShuffle()" title="Shuffle">
            <svg viewBox="0 0 24 24"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>
          </button>
          <button class="transport-btn" onclick="prev()" title="Previous">
            <svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
          </button>
          <button class="transport-btn-play" id="btn-playpause" onclick="togglePlayPause()">
            <svg viewBox="0 0 24 24" id="icon-playpause"><path d="M8 5v14l11-7z"/></svg>
          </button>
          <button class="transport-btn" onclick="next()" title="Next">
            <svg viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
          </button>
          <button class="transport-btn" id="btn-repeat" onclick="toggleRepeat()" title="Repeat">
            <svg viewBox="0 0 24 24"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>
          </button>
        </div>

        <div class="volume-bar">
          <svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>
          <input type="range" class="volume-slider" id="np-volume" min="0" max="100" value="${np.device?.volume_percent || 50}" oninput="setVolume(this.value); document.getElementById('np-vol-pct').textContent=this.value+'%'">
          <span style="font-size:11px;color:var(--text3);min-width:28px" id="np-vol-pct">${np.device?.volume_percent || 50}%</span>
        </div>

        <div class="lyrics-box" id="lyrics-box">
          <div class="lyrics-content" id="lyrics-content">
            <div class="lyrics-loading"><div class="spinner"></div></div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Initial UI state
  updateNPVisuals();

  // Fetch lyrics if new track
  if (npCurrentTrackId !== t.id) {
    npCurrentTrackId = t.id;
    npSyncedLyrics = null;
    fetchLyrics(t.name, t.artists?.[0]?.name);
  }

  // Start live update loop (every 500ms)
  clearInterval(npUpdateInterval);
  npUpdateInterval = setInterval(npLiveUpdate, 500);
}

function togglePlayPause() {
  if (npIsPlaying) { pause(); npIsPlaying = false; }
  else { play(); npIsPlaying = true; }
  updateNPVisuals();
}

function npLiveUpdate() {
  if (state.currentView !== 'nowplaying') {
    clearInterval(npUpdateInterval);
    return;
  }

  // Advance local progress if playing
  if (npIsPlaying) {
    npLocalProgress += 500;
    if (npLocalProgress > npDuration) npLocalProgress = npDuration;
  }

  // Update progress bar
  const fill = document.getElementById('np-progress-fill');
  const elapsed = document.getElementById('np-elapsed');
  if (fill) fill.style.width = ((npLocalProgress / npDuration) * 100).toFixed(1) + '%';
  if (elapsed) elapsed.textContent = formatMs(npLocalProgress);

  // Update synced lyrics highlight
  if (npSyncedLyrics) {
    highlightCurrentLyric(npLocalProgress);
  }
}

function updateNPVisuals() {
  const disc = document.getElementById('vinyl-disc');
  const arm = document.getElementById('tonearm');
  const icon = document.getElementById('icon-playpause');
  const btnShuffle = document.getElementById('btn-shuffle');
  const btnRepeat = document.getElementById('btn-repeat');
  const np = state.nowPlaying;

  if (disc) {
    disc.className = 'vinyl-disc' + (npIsPlaying ? ' spinning' : '');
  }
  if (arm) {
    arm.className = 'tonearm' + (npIsPlaying ? ' playing' : '');
  }
  if (icon) {
    icon.innerHTML = npIsPlaying
      ? '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>'
      : '<path d="M8 5v14l11-7z"/>';
  }
  if (btnShuffle && np) {
    btnShuffle.className = 'transport-btn' + (np.shuffle_state ? ' active' : '');
  }
  if (btnRepeat && np) {
    btnRepeat.className = 'transport-btn' + (np.repeat_state !== 'off' ? ' active' : '');
  }
}

// Sync state from API poll
const _origUpdateNP = updateNowPlaying;
updateNowPlaying = function(data) {
  _origUpdateNP(data);
  if (data && data.item && state.currentView === 'nowplaying') {
    npIsPlaying = data.is_playing;
    npLocalProgress = data.progress_ms || 0;
    npDuration = data.item.duration_ms || 1;

    // Update track info if changed
    const titleEl = document.getElementById('np-title');
    if (titleEl && titleEl.textContent !== data.item.name) {
      titleEl.textContent = data.item.name;
      document.getElementById('np-artist-full').textContent = data.item.artists?.map(a => a.name).join(', ') || '';
      document.getElementById('np-album-full').textContent = data.item.album?.name || '';
      const vinylArt = document.getElementById('vinyl-art');
      if (vinylArt) vinylArt.src = data.item.album?.images?.[0]?.url || '';
      // New track — fetch lyrics
      if (npCurrentTrackId !== data.item.id) {
        npCurrentTrackId = data.item.id;
        npSyncedLyrics = null;
        fetchLyrics(data.item.name, data.item.artists?.[0]?.name);
      }
    }

    // Update total time
    const totalEl = document.getElementById('np-total');
    if (totalEl) totalEl.textContent = formatMs(npDuration);

    // Update volume
    const volSlider = document.getElementById('np-volume');
    const volPct = document.getElementById('np-vol-pct');
    if (volSlider && data.device && !volSlider.matches(':active')) {
      volSlider.value = data.device.volume_percent;
      if (volPct) volPct.textContent = data.device.volume_percent + '%';
    }

    updateNPVisuals();
  }
};

// === SYNCED LYRICS ===
async function fetchLyrics(title, artist) {
  const el = document.getElementById('lyrics-content');
  if (!el) return;

  el.innerHTML = '<div class="lyrics-loading"><div class="spinner"></div></div>';

  // Set a hard fallback — if nothing renders in 4 seconds, show "no lyrics"
  const fallbackTimer = setTimeout(() => {
    const el2 = document.getElementById('lyrics-content');
    if (el2 && el2.querySelector('.lyrics-loading')) {
      npSyncedLyrics = null;
      el2.innerHTML = '<div class="lyrics-empty">♪ No lyrics available</div>';
    }
  }, 4000);

  let data = null;
  
  // Try exact match
  try {
    const resp = await Promise.race([
      fetch('https://lrclib.net/api/get?' + new URLSearchParams({ track_name: title || '', artist_name: artist || '' })),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000))
    ]);
    if (resp.ok) data = await resp.json();
  } catch(e) { }
  
  // Fallback: search
  if (!data || (!data.syncedLyrics && !data.plainLyrics)) {
    try {
      const resp = await Promise.race([
        fetch('https://lrclib.net/api/search?' + new URLSearchParams({ q: (title || '') + ' ' + (artist || '') })),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000))
      ]);
      if (resp.ok) {
        const results = await resp.json();
        data = results.find(r => r.syncedLyrics) || results.find(r => r.plainLyrics) || null;
      }
    } catch(e) { }
  }

  clearTimeout(fallbackTimer);
  const el3 = document.getElementById('lyrics-content');
  if (!el3) return;

  if (data && data.syncedLyrics) {
    npSyncedLyrics = [];
    data.syncedLyrics.split('\n').forEach(line => {
      const match = line.match(/\[(\d{2}):(\d{2})\.(\d{2,3})\]\s*(.*)/);
      if (match) {
        const ms = parseInt(match[1]) * 60000 + parseInt(match[2]) * 1000 + parseInt(match[3].padEnd(3, '0'));
        npSyncedLyrics.push({ time: ms, text: match[4] || '♪' });
      }
    });
    el3.innerHTML = npSyncedLyrics.map((l, i) =>
      `<div class="lyric-line" id="lyric-${i}" data-time="${l.time}" onclick="seekToLyric(${l.time})">${esc(l.text) || '<span class="lyric-instrumental">♪ ♪ ♪</span>'}</div>`
    ).join('');
    // Force instant scroll to current position
    lastHighlightIdx = -1;
    setTimeout(() => highlightCurrentLyric(npLocalProgress, true), 100);
  } else if (data && data.plainLyrics) {
    npSyncedLyrics = null;
    el3.innerHTML = data.plainLyrics.split('\n').map(l =>
      `<div class="lyric-line plain">${esc(l) || '<span class="lyric-instrumental">♪ ♪ ♪</span>'}</div>`
    ).join('');
  } else {
    npSyncedLyrics = null;
    el3.innerHTML = '<div class="lyrics-empty">♪ No lyrics available</div>';
  }
}

function seekToLyric(timeMs) {
  seekTo(timeMs);
  npLocalProgress = timeMs;
  highlightCurrentLyric(timeMs);
}

let lastHighlightIdx = -1;

function highlightCurrentLyric(posMs, forceScroll) {
  if (!npSyncedLyrics || !npSyncedLyrics.length) return;

  // Find current line
  let activeIdx = 0;
  for (let i = 0; i < npSyncedLyrics.length; i++) {
    if (npSyncedLyrics[i].time <= posMs) activeIdx = i;
    else break;
  }

  // Only update DOM when active line changes (unless forced)
  if (activeIdx === lastHighlightIdx && !forceScroll) return;
  lastHighlightIdx = activeIdx;

  const box = document.getElementById('lyrics-box');

  // Update classes
  npSyncedLyrics.forEach((_, i) => {
    const el = document.getElementById('lyric-' + i);
    if (!el) return;

    el.classList.remove('active', 'near', 'passed');

    const dist = i - activeIdx;

    if (i === activeIdx) {
      el.classList.add('active');
      // Auto-scroll to active line
      if (box) {
        const lineTop = el.offsetTop - box.offsetTop;
        const boxHeight = box.clientHeight;
        const scrollTarget = lineTop - boxHeight / 2 + 20;
        box.scrollTo({ top: scrollTarget, behavior: forceScroll ? 'instant' : 'smooth' });
      }
    } else if (Math.abs(dist) <= 2) {
      el.classList.add('near');
    } else if (dist < 0) {
      el.classList.add('passed');
    }
  });
}

// === SUB-VIEWS ===

async function openPlaylist(id) {
  const main = document.getElementById('main');
  main.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  const data = await api('/playlists/' + id);
  if (!data) return;

  let html = `<div class="section-block">
    <div class="section-header" style="align-items:center;gap:16px">
      <div style="display:flex;align-items:center;gap:16px">
        <img src="${data.images?.[0]?.url || ''}" style="width:80px;height:80px;border-radius:8px;object-fit:cover">
        <div>
          <div class="section-title" style="color:var(--pink)">${esc(data.name)}</div>
          <div class="section-subtitle">${data.tracks?.total || 0} tracks • ${esc(data.owner?.display_name || '')}</div>
        </div>
      </div>
      <button class="auth-btn" style="padding:10px 24px;font-size:12px" onclick="play(null, 'spotify:playlist:${id}')">▶ PLAY ALL</button>
    </div>`;
  html += '<div class="track-list" style="margin-top:16px">';
  (data.tracks?.items || []).forEach((item, i) => {
    const t = item.track;
    if (!t) return;
    const art = t.album?.images?.[t.album.images.length - 1]?.url || '';
    html += trackRow(i + 1, t.name, t.artists?.[0]?.name, art, t.uri, 'spotify:playlist:' + id, '--pink', t.duration_ms);
  });
  html += '</div></div>';

  // Back button
  html = `<button class="section-viewall" onclick="navigate('${state.currentView === 'home' ? 'home' : 'playlists'}')" style="margin-bottom:16px">← Back</button>` + html;
  main.innerHTML = html;
}

async function openAlbum(id) {
  const main = document.getElementById('main');
  main.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  const data = await api('/albums/' + id);
  if (!data) return;

  let html = `<button class="section-viewall" onclick="navigate('${state.currentView}')" style="margin-bottom:16px">← Back</button>`;
  html += `<div class="section-block">
    <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px">
      <img src="${data.images?.[0]?.url || ''}" style="width:120px;height:120px;border-radius:8px;object-fit:cover">
      <div>
        <div class="section-title" style="color:var(--yellow)">${esc(data.name)}</div>
        <div class="section-subtitle">${esc(data.artists?.[0]?.name || '')} • ${data.release_date?.slice(0, 4) || ''}</div>
        <button class="auth-btn" style="padding:8px 20px;font-size:11px;margin-top:8px" onclick="play(null, 'spotify:album:${id}')">▶ PLAY</button>
      </div>
    </div>`;
  html += '<div class="track-list">';
  (data.tracks?.items || []).forEach((t, i) => {
    html += trackRow(i + 1, t.name, t.artists?.[0]?.name, '', t.uri, 'spotify:album:' + id, '--yellow', t.duration_ms);
  });
  html += '</div></div>';
  main.innerHTML = html;
}

async function openArtist(id) {
  const main = document.getElementById('main');
  main.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  const [artist, topTracks, albums] = await Promise.all([
    api('/artists/' + id),
    api('/artists/' + id + '/top-tracks?market=US'),
    api('/artists/' + id + '/albums?limit=20&include_groups=album,single')
  ]);

  if (!artist) return;

  let html = `<button class="section-viewall" onclick="navigate('search')" style="margin-bottom:16px">← Back</button>`;
  html += `<div style="display:flex;align-items:center;gap:16px;margin-bottom:24px">
    <img src="${artist.images?.[0]?.url || ''}" style="width:120px;height:120px;border-radius:50%;object-fit:cover">
    <div>
      <div class="section-title" style="color:var(--cyan)">${esc(artist.name)}</div>
      <div class="section-subtitle">${(artist.followers?.total || 0).toLocaleString()} followers</div>
    </div>
  </div>`;

  // Top tracks
  if (topTracks?.tracks?.length) {
    html += '<div class="section-block"><div class="section-header"><div class="section-title" style="color:var(--pink)">Top Tracks</div></div>';
    html += '<div class="track-list">';
    topTracks.tracks.forEach((t, i) => {
      const art = t.album?.images?.[t.album.images.length - 1]?.url || '';
      html += trackRow(i + 1, t.name, '', art, t.uri, null, '--pink', t.duration_ms);
    });
    html += '</div></div>';
  }

  // Albums
  if (albums?.items?.length) {
    html += '<div class="section-block"><div class="section-header"><div class="section-title">Discography</div></div>';
    html += '<div class="card-grid">';
    albums.items.forEach(a => {
      const art = a.images?.[0]?.url || '';
      html += `<div class="card-item" onclick="openAlbum('${a.id}')">
        <img class="card-art" src="${art}" alt="" loading="lazy">
        <div class="card-name">${esc(a.name)}</div>
        <div class="card-desc">${a.release_date?.slice(0, 4) || ''} • ${a.album_type}</div>
      </div>`;
    });
    html += '</div></div>';
  }

  main.innerHTML = html;
}

async function openCategory(id, name) {
  const main = document.getElementById('main');
  main.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  // Try category playlists first, fall back to search
  let playlists = [];
  const data = await api('/browse/categories/' + id + '/playlists?limit=20');
  if (data?.playlists?.items) {
    playlists = data.playlists.items.filter(Boolean);
  }
  
  // If empty, search for playlists matching the genre name
  if (!playlists.length) {
    const token = await getFreshToken();
    if (token) {
      try {
        const resp = await fetch('https://api.spotify.com/v1/search?q=' + encodeURIComponent(name) + '&type=playlist&limit=20', {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        if (resp.ok) {
          const searchData = await resp.json();
          playlists = searchData?.playlists?.items?.filter(Boolean) || [];
        }
      } catch(e) {}
    }
  }

  if (!playlists.length) {
    main.innerHTML = `<button class="section-viewall" onclick="navigate('genres')" style="margin-bottom:16px">← Back</button><div class="lyrics-empty">No playlists found for ${esc(name)}</div>`;
    return;
  }

  let html = `<button class="section-viewall" onclick="navigate('genres')" style="margin-bottom:16px">← Back</button>`;
  html += `<div class="section-block"><div class="section-header"><div class="section-title" style="color:var(--yellow)">${esc(name)}</div></div>`;
  html += '<div class="card-grid">';
  playlists.forEach(p => {
    const art = p.images?.[0]?.url || '';
    html += `<div class="card-item" onclick="openPlaylist('${p.id}')">
      <img class="card-art" src="${art}" alt="" loading="lazy">
      <div class="card-name">${esc(p.name)}</div>
      <div class="card-desc">${p.tracks?.total || 0} tracks</div>
    </div>`;
  });
  html += '</div></div>';
  main.innerHTML = html;
}

// === HELPERS ===

function trackRow(num, name, artist, artUrl, uri, contextUri, colorVar = '--pink', durationMs = null) {
  const artHtml = artUrl ? `<img class="track-art" src="${artUrl}" alt="" loading="lazy">` : '';
  const playAction = contextUri
    ? `play(null, '${contextUri}', ${num - 1})`
    : `play('${uri}')`;

  return `<div class="track-row" onclick="${playAction}">
    <div class="track-num" style="color:var(${colorVar})">${String(num).padStart(2, '0')}</div>
    <div class="track-info">
      <div class="track-name">${esc(name)}</div>
      ${artist ? `<div class="track-artist">${esc(artist)}</div>` : ''}
    </div>
    ${artHtml}
  </div>`;
}

function formatMs(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m + ':' + String(sec).padStart(2, '0');
}

function esc(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function seekFromClick(event, durationMs) {
  const bar = event.currentTarget;
  const rect = bar.getBoundingClientRect();
  const pct = (event.clientX - rect.left) / rect.width;
  seekTo(pct * durationMs);
}

// === INIT ===

function showAuth() {
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('topbar').classList.add('hidden');
  document.getElementById('sidebar').classList.add('hidden');
  document.getElementById('main').classList.add('hidden');
  document.getElementById('bottombar').classList.add('hidden');
}

function showApp() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('topbar').classList.remove('hidden');
  document.getElementById('sidebar').classList.remove('hidden');
  document.getElementById('main').classList.remove('hidden');
  document.getElementById('bottombar').classList.remove('hidden');
}

function switchAccount() {
  // Clear stored tokens so it forces re-auth
  localStorage.removeItem('jukebox_token');
  localStorage.removeItem('jukebox_refresh');
  localStorage.removeItem('jukebox_expiry');
  state.token = null;
  state.refreshToken = null;
  state.tokenExpiry = 0;

  // Redirect to Spotify auth with force dialog so they can pick a different account
  const params = new URLSearchParams({
    client_id: CONFIG.clientId,
    response_type: 'code',
    redirect_uri: CONFIG.redirectUri,
    scope: CONFIG.scopes,
    show_dialog: 'true'
  });
  window.location.href = 'https://accounts.spotify.com/authorize?' + params;
}

async function loadUserProfile() {
  const me = await api('/me');
  if (me && me.display_name) {
    const el = document.getElementById('sidebar-user');
    if (el) el.textContent = me.display_name + "'s Jukebox";
    const sub = document.querySelector('.sidebar-brand-sub');
    if (sub) sub.textContent = me.display_name + "'s Jukebox";
  }
}

async function initApp() {
  showApp();

  // Load user profile
  loadUserProfile();

  // Load playlists for sidebar
  const data = await api('/me/playlists?limit=50');
  state.playlists = data?.items || [];
  const sidebar = document.getElementById('sidebar-playlists');
  sidebar.innerHTML = state.playlists.map(p =>
    `<div class="sidebar-playlist-item" onclick="openPlaylist('${p.id}')">${esc(p.name)}</div>`
  ).join('');

  // Start now playing poll
  pollNowPlaying();
  state.pollInterval = setInterval(pollNowPlaying, 5000);

  // Arcade marquee messages
  const arcadeMessages = [
    '★ INSERT COIN TO PLAY ★',
    '♪ SELECT YOUR JAM ♪',
    '► PRESS PLAY — ROCK ON ►',
    '★ FRANK\'S JUKEBOX ★',
    '♪ DROP THE NEEDLE ♪',
    '► NOW SERVING BANGERS ►',
    '★ CHOOSE WISELY ★',
  ];
  let arcadeIdx = 0;
  const arcadeEl = document.getElementById('arcade-marquee');
  if (arcadeEl) {
    setInterval(() => {
      arcadeIdx = (arcadeIdx + 1) % arcadeMessages.length;
      arcadeEl.textContent = arcadeMessages[arcadeIdx];
    }, 6000);
  }

  // Navigate to home
  navigate('home');

  // Click on now playing mini -> full view
  document.getElementById('np-mini').addEventListener('click', () => navigate('nowplaying'));
}

// === BOOT ===
// Hardcoded refresh token from SpotifyPlus — auto-refreshes, no browser auth needed
const FALLBACK_REFRESH_TOKEN = 'YOUR_REFRESH_TOKEN_OR_EMPTY';

(async function boot() {
  // Check for auth code callback (redirect from Spotify)
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  if (code) {
    await handleAuthCallback(code);
    return;
  }

  // Check for stored token
  const token = localStorage.getItem('jukebox_token');
  const expiry = parseInt(localStorage.getItem('jukebox_expiry') || '0');
  const refresh = localStorage.getItem('jukebox_refresh') || FALLBACK_REFRESH_TOKEN;

  // If we have a refresh token (stored or fallback), just use it
  if (refresh) {
    state.refreshToken = refresh;

    if (token && Date.now() < expiry - 60000) {
      // Valid stored token
      state.token = token;
      state.tokenExpiry = expiry;
      initApp();
    } else {
      // Refresh to get a new token
      const ok = await refreshAccessToken();
      if (ok) {
        initApp();
      } else {
        showAuth();
      }
    }
  } else {
    showAuth();
  }
})();
