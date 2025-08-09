# PulseBoard v2 — Live Design + 1s Price Updates (Selected Token)

What's new vs v1:
- **Refined design**: glassmorphism, animated status, cleaner cards, shimmering loaders.
- **Live 1s updates for selected token** with adaptive backoff when rate-limited.
- Smoother, no-legend mini chart that grows with 1s ticks (keeps last 60 points).
- Same features: Top coins, watchlist, predictions (1h/4h/24h), new pairs from Dexscreener, fiat/interval controls.

## Notes on "by second" updates
- The selected token uses CoinGecko Simple Price every second. If the API rate-limits your IP, the app auto-backs off (2 → 5 → 10 → 20s) and resumes 1s when possible.
- The **Top Coins** table refreshes on your chosen interval (default 5s) to reduce chances of rate-limit.

## Quick Start
1. Download the ZIP and unzip.
2. Open `index.html`. Add a token (e.g., bitcoin) and click it to open. The price ticks every second.
3. Adjust update interval for the top list in the header.
4. Use "New Pairs" to fetch latest pairs from Dexscreener.

## Deploy on GitHub Pages
- Same as v1: push files to a public repo, then Settings → Pages → Deploy from branch → /root.

> This dashboard is educational. Predictions are heuristics only and **not** financial advice.
