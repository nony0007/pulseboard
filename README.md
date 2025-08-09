# PulseBoard — Realtime Crypto With Heuristic Predictions

A frontend-only dashboard you can host on GitHub Pages. It shows:
- Top coins with live prices (CoinGecko) and quick % changes.
- Watchlist you can add/remove tokens to.
- Token details view with a mini chart (last hour) and **simple heuristic predictions** for 1h/4h/24h:
  - Based on recent trend (EMA of returns), volatility, and 24h volume.
  - Outputs expected direction/size, a "likelihood" %, and a "confidence" %.
- **New pairs feed** from Dexscreener across multiple chains (Ethereum, BSC, Polygon, Arbitrum, Base, Optimism, etc.).

> ⚠️ Predictions are for **education/entertainment**. Not investment advice. Accuracy is not guaranteed.

## Quick Start
1. Download the ZIP and unzip.
2. Open `index.html` in your browser.
3. Use the search box to add tokens to your watchlist. Click a token to open details and predictions.
4. Click **Newest** in the New Pairs section to see fresh launches.

## Deploy on GitHub Pages
1. Create a new public repo (e.g., `pulseboard`).
2. Drag & drop the three files (`index.html`, `style.css`, `app.js`).
3. In **Settings → Pages**, set **Deploy from a branch** and folder `/root`. Save.
4. Wait ~1 minute for Pages to go live.

## APIs
- Prices & history: CoinGecko public API (no key). Rate limits may apply.
- New pairs: Dexscreener public API.

## Notes
- If you see rate-limit messages, click **Refresh** or increase the interval to 30–60s.
- Everything is saved in your browser (localStorage) — no server needed.
