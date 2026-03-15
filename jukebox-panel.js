// Jukebox — HACS Panel
// Registers a Home Assistant panel that loads the Jukebox Spotify player
// Source: https://github.com/wikydtron/jukebox

class JukeboxPanel extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    const shadow = this.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { display: block; height: 100%; }
        iframe {
          width: 100%;
          height: 100%;
          border: none;
          display: block;
        }
      </style>
      <iframe
        src="/local/jukebox/index.html"
        allow="autoplay; encrypted-media"
        allowfullscreen
      ></iframe>
    `;
  }
}

customElements.define("jukebox-panel", JukeboxPanel);

// Register as a custom panel type
window.customPanels = window.customPanels || {};
window.customPanels["jukebox"] = {
  name: "jukebox-panel",
  embed_iframe: false,
  trust_external_script: false,
};

