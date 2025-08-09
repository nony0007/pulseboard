# PulseBoard v3 — Fixes + WebSocket Live + Fallbacks

**What’s fixed**
- Buttons work regardless of CoinGecko rate limits.
- Token details load even if top list fails.
- Price predictions work with Binance **1m klines** when CoinGecko history is blocked.
- **Binance WebSocket** live price for selected token (auto maps SYMBOL → SYMBOLUSDT). Manual override field if listing differs.
- New Pairs shows errors and continues; uses HTTPS and displays retries.

**How to use**
1. Download and unzip.
2. Open `index.html`.
3. Add/search a token (bitcoin, ethereum, solana) → click to open. Live price will use Binance WS.
4. If ticker mapping is wrong, type the correct one (e.g., `ARBUSDT`, `WIFUSDT`, `WETHUSDT`) in the field and press **Use**.
5. Predictions will compute from CoinGecko minute data or Binance klines fallback.

**Deploy**
- Push the 3 files to a public GitHub repo → Settings → Pages → Deploy from branch → `/root`.

**Notes**
- All client-side, no keys. Some assets may still rate-limit under heavy use; WS avoids most issues.
