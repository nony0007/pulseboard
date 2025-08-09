
// ---------------- Utilities ----------------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const fmt = (n, cur="") => (n===null||n===undefined) ? "—" : (cur? new Intl.NumberFormat(undefined,{style:"currency",currency:cur}).format(n) : new Intl.NumberFormat().format(n));
const pct = (n) => (n===null||n===undefined) ? "—" : (n>=0? `+${n.toFixed(2)}%` : `${n.toFixed(2)}%`);
const nowTime = ()=> new Date().toLocaleTimeString();
const toast = (msg)=>{ const t=$("#toast"); t.textContent = msg; t.classList.add("show"); setTimeout(()=> t.classList.remove("show"), 3000); };

let state = {
  fiat: localStorage.getItem("fiat") || "usd",
  refresh: Number(localStorage.getItem("refresh") || 5),
  watchlist: JSON.parse(localStorage.getItem("watchlist") || '["bitcoin","ethereum","solana"]'),
  selected: null,
  ws: null,
  wsTicker: "", // manual override
};

function persist(){
  localStorage.setItem("watchlist", JSON.stringify(state.watchlist));
  localStorage.setItem("fiat", state.fiat);
  localStorage.setItem("refresh", state.refresh);
}

// ---------------- APIs ----------------
async function cgTop(vs="usd"){
  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=${vs}&order=market_cap_desc&per_page=25&page=1&sparkline=false&price_change_percentage=1h,24h,7d`;
  const r = await fetch(url);
  if(r.status===429) throw new Error("429 CoinGecko rate limit");
  if(!r.ok) throw new Error("CoinGecko error");
  return r.json();
}
async function cgHistory(id, vs="usd", days=1, interval="minute"){
  const r = await fetch(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=${vs}&days=${days}&interval=${interval}`);
  if(!r.ok) throw new Error("CG history error");
  return r.json();
}
async function cgMarket(id, vs="usd"){
  const r = await fetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=${vs}&ids=${id}`);
  if(!r.ok) throw new Error("CG market error");
  return r.json();
}
async function cgSearch(q){
  const r = await fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(q)}`);
  if(!r.ok) return null;
  const d = await r.json();
  return d.coins?.[0]?.id || null;
}

// Binance REST fallbacks
async function binanceKlines(symbol="BTCUSDT", limit=60){
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1m&limit=${limit}`;
  const r = await fetch(url);
  if(!r.ok) throw new Error("Binance klines error");
  const d = await r.json();
  // Convert to [[ts, price], ...] using close price
  return d.map(k=> [k[0], parseFloat(k[4])]);
}
async function binance24h(symbol="BTCUSDT"){
  const r = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`);
  if(!r.ok) throw new Error("Binance 24h error");
  return r.json();
}

// Dexscreener
async function dsNewPairs(chains){
  const out = [];
  for(const c of chains){
    try{
      const r = await fetch(`https://api.dexscreener.com/latest/dex/pairs/${c}`);
      if(!r.ok) throw new Error(`Dexscreener ${c} error`);
      const d = await r.json();
      out.push(...(d.pairs||[]).slice(0,15).map(p=>({chain:c, ...p})));
    }catch(e){
      $("#pairError").textContent = e.message;
    }
    await new Promise(res=> setTimeout(res, 200));
  }
  out.sort((a,b)=> (b.createdAt||0)-(a.createdAt||0));
  return out.slice(0,45);
}

// ---------------- Prediction ----------------
function predictFromSeries(prices, volume24h){
  if(!prices || prices.length < 20) return null;
  const vals = prices.map(p=> p[1]);
  const rets = [];
  for(let i=1;i<vals.length;i++) rets.push(Math.log(vals[i]/vals[i-1]));
  const ema = (arr, k)=>{
    let e = arr[0], a = 2/(k+1);
    for(let i=1;i<arr.length;i++) e = arr[i]*a + e*(1-a);
    return e;
  };
  const rShort = ema(rets.slice(-30), 15);
  const rLong  = ema(rets.slice(-120), 60);
  const drift = (rShort*0.6 + rLong*0.4);
  const mean = rets.reduce((a,b)=>a+b,0)/rets.length;
  const variance = rets.reduce((a,b)=>a+(b-mean)*(b-mean),0)/(rets.length-1);
  const vol = Math.sqrt(Math.max(variance, 1e-9));
  const volScore = Math.max(0, 1 - (vol/0.01));
  const volAdj = Math.min(1, Math.log10((volume24h||1)+10)/6);
  const baseConf = Math.max(0.1, Math.min(0.95, 0.4*volScore + 0.6*volAdj));
  const proj = (m)=> Math.exp(drift*m) - 1;
  const p1 = proj(60), p4 = proj(240), p24 = proj(1440);
  const like = (pmove)=> Math.max(0.05, Math.min(0.98, baseConf * (1 - Math.min(0.5, Math.abs(pmove)/0.2))));
  return {
    oneH:{change:p1, likelihood:like(p1), confidence:baseConf},
    fourH:{change:p4, likelihood:like(p4), confidence:baseConf*0.9},
    day:{change:p24, likelihood:like(p24), confidence:baseConf*0.8}
  };
}

// ---------------- UI: Top & Watchlist ----------------
function renderTopCoins(list){
  const root = $("#topCoins");
  const header = `
    <div class="header">#</div>
    <div class="header">Name</div>
    <div class="header">Price</div>
    <div class="header">1h</div>
    <div class="header">24h</div>
    <div class="header">7d</div>
    <div class="header">Action</div>
  `;
  const rows = list.map((c,i)=>`
    <div class="row">${i+1}</div>
    <div class="row"><img class="icon" src="${c.image}"> ${c.name} <span class="symbol">(${c.symbol.toUpperCase()})</span></div>
    <div class="row">${fmt(c.current_price, state.fiat.toUpperCase())}</div>
    <div class="row ${c.price_change_percentage_1h_in_currency>=0?'chgUp':'chgDown'}">${pct(c.price_change_percentage_1h_in_currency)}</div>
    <div class="row ${c.price_change_percentage_24h_in_currency>=0?'chgUp':'chgDown'}">${pct(c.price_change_percentage_24h_in_currency)}</div>
    <div class="row ${c.price_change_percentage_7d_in_currency>=0?'chgUp':'chgDown'}">${pct(c.price_change_percentage_7d_in_currency)}</div>
    <div class="row actions">
      <button data-id="${c.id}" class="view btn">View</button>
      <button data-id="${c.id}" class="add btn">Add</button>
    </div>
  `).join("");
  root.classList.remove("skeleton");
  root.innerHTML = header + rows;
  $$("#topCoins .view").forEach(b=> b.onclick = ()=> selectToken(b.dataset.id));
  $$("#topCoins .add").forEach(b=> b.onclick = ()=> addToWatch(b.dataset.id));
  $("#statusText").textContent = "Live";
  $("#lastUpdate").textContent = nowTime();
  $("#topError").textContent = "";
}

async function renderWatchlist(){
  const root = $("#watchlist");
  if(state.watchlist.length===0){ root.innerHTML = "<div class='badge-plain'>Empty</div>"; return; }
  try{
    const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=${state.fiat}&ids=${state.watchlist.join(",")}&price_change_percentage=1h,24h`;
    const res = await fetch(url); const data = res.ok ? await res.json() : [];
    root.classList.remove("skeleton");
    root.innerHTML = data.map(c=>`
      <div class="row">
        <span><img class="icon" src="${c.image}"> ${c.name} <span class="symbol">(${c.symbol.toUpperCase()})</span></span>
        <span>${fmt(c.current_price, state.fiat.toUpperCase())} <span class="${c.price_change_percentage_24h_in_currency>=0?'chgUp':'chgDown'}">${pct(c.price_change_percentage_24h_in_currency)}</span></span>
        <span>
          <button class="view btn" data-id="${c.id}">Open</button>
          <button class="remove btn subtle" data-id="${c.id}">✕</button>
        </span>
      </div>
    `).join("");
  }catch(e){
    root.innerHTML = state.watchlist.map(id=>`
      <div class="row">
        <span>${id}</span>
        <span>—</span>
        <span>
          <button class="view btn" data-id="${id}">Open</button>
          <button class="remove btn subtle" data-id="${id}">✕</button>
        </span>
      </div>
    `).join("");
  }
  $$("#watchlist .view").forEach(b=> b.onclick = ()=> selectToken(b.dataset.id));
  $$("#watchlist .remove").forEach(b=> b.onclick = ()=> removeFromWatch(b.dataset.id));
}

function addToWatch(id){ if(!id) return; if(!state.watchlist.includes(id)) state.watchlist.push(id); persist(); renderWatchlist(); }
function removeFromWatch(id){ state.watchlist = state.watchlist.filter(x=> x!==id); persist(); renderWatchlist(); }

// ---------------- Details: Live via WebSocket + fallbacks ----------------
let chart;
function coinIdToWsTicker(info){
  // Try SYMBOLUSDT by default; allow manual override
  if(state.wsTicker) return state.wsTicker.toUpperCase();
  const sym = (info?.symbol || "").toUpperCase();
  if(!sym) return "BTCUSDT";
  // Common exceptions
  if(sym==="WETH") return "ETHUSDT";
  if(sym==="WBTC") return "BTCUSDT";
  return sym + "USDT";
}

async function selectToken(id){
  state.selected = id;
  $("#detailError").textContent = "";
  $("#tdName").textContent = "Loading…";
  $("#tdPrice").textContent = "—";
  $("#tdStats").textContent = "—";
  $("#tdPriceChange").textContent = "—";
  $("#liveStatus").textContent = "Connecting…";

  // Close old WS
  if(state.ws){ try{ state.ws.close(); }catch{} state.ws=null; }

  // Try CG market (for name/symbol). If that fails, skip gracefully.
  let info=null;
  try{
    const arr = await cgMarket(id, state.fiat);
    info = arr[0];
    $("#tdName").textContent = info ? `${info.name} (${info.symbol.toUpperCase()})` : id;
    $("#tdPrice").textContent = info ? fmt(info.current_price, state.fiat.toUpperCase()) : "—";
    $("#tdPriceChange").textContent = info ? pct(info.price_change_percentage_24h_in_currency) : "—";
    $("#tdPriceChange").className = "change " + (info?.price_change_percentage_24h_in_currency>=0 ? "up":"down");
    $("#tdStats").innerHTML = info ? `
      <span class="badge-plain">MktCap: ${fmt(info.market_cap, state.fiat.toUpperCase())}</span>
      <span class="badge-plain">24h Vol: ${fmt(info.total_volume, state.fiat.toUpperCase())}</span>
    ` : "—";
  }catch(e){
    $("#tdName").textContent = id;
    $("#detailError").textContent = "CoinGecko info limited (rate limit). Using Binance fallback.";
  }

  // Chart + predictions: try CG history, fallback to Binance klines
  let hist=null;
  try{
    hist = await cgHistory(id, state.fiat, 1, "minute");
    drawChart(id, hist.prices.map(p=> new Date(p[0]).toLocaleTimeString()), hist.prices.map(p=> p[1]));
    renderPredictions(hist.prices, info?.total_volume||0);
  }catch(e){
    try{
      const ticker = coinIdToWsTicker(info);
      const kl = await binanceKlines(ticker, 60);
      drawChart(id, kl.map(p=> new Date(p[0]).toLocaleTimeString()), kl.map(p=> p[1]));
      // fabricate prices array [[ts,price],...]
      renderPredictions(kl, parseFloat((await binance24h(ticker)).quoteVolume||0));
      $("#detailError").textContent = "Used Binance 1m klines as fallback.";
    }catch(err){
      $("#detailError").textContent = "Failed to load history from both sources.";
    }
  }

  // Start WebSocket live price (Binance) with auto ticker mapping
  try{
    const ticker = coinIdToWsTicker(info).toLowerCase();
    $("#wsTicker").value = ticker.toUpperCase();
    const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${ticker}@trade`);
    state.ws = ws;
    ws.onopen = ()=> { $("#liveStatus").textContent = "Live (WS)"; };
    ws.onmessage = (ev)=>{
      const msg = JSON.parse(ev.data);
      const price = parseFloat(msg.p);
      if(!isNaN(price)){
        $("#tdPrice").textContent = fmt(price, state.fiat.toUpperCase());
        // Update chart
        if(window.miniChart){
          const t = new Date().toLocaleTimeString();
          window.miniChart.data.labels.push(t);
          window.miniChart.data.datasets[0].data.push(price);
          if(window.miniChart.data.labels.length>120){ window.miniChart.data.labels.shift(); window.miniChart.data.datasets[0].data.shift(); }
          window.miniChart.update();
        }
      }
    };
    ws.onerror = ()=> { $("#liveStatus").textContent = "WS error"; };
    ws.onclose = ()=> { $("#liveStatus").textContent = "WS closed"; };
  }catch(e){
    $("#liveStatus").textContent = "WS unavailable";
  }
}

function drawChart(id, labels, values){
  const ctx = $("#miniChart").getContext("2d");
  if(window.miniChart) window.miniChart.destroy();
  window.miniChart = new Chart(ctx, {
    type: "line",
    data: { labels, datasets: [{ label: id, data: values, fill:false, tension:.25 }] },
    options: { animation:false, plugins:{legend:{display:false}}, scales:{x:{display:false}, y:{display:true}} }
  });
}

function renderPredictions(series, volume){
  const pred = predictFromSeries(series, volume);
  const fmtPred = (el, p, label)=>{
    if(!p){ el.textContent = `${label}: —`; el.className = "pred"; return; }
    const dir = p.change>=0 ? "up":"down";
    el.className = "pred "+dir;
    const arrow = p.change>=0 ? "↑" : "↓";
    el.innerHTML = `<strong>${label}</strong>: ${arrow} ${pct(p.change*100)} · Likely: ${(p.likelihood*100).toFixed(0)}% · Confidence: ${(p.confidence*100).toFixed(0)}%`;
  };
  fmtPred($("#pred1h"), pred?.oneH, "1h");
  fmtPred($("#pred4h"), pred?.fourH, "4h");
  fmtPred($("#pred24h"), pred?.day, "24h");
}

// ---------------- New Pairs ----------------
async function loadPairs(){
  const sel = $("#chains");
  const chains = Array.from(sel.selectedOptions).map(o=> o.value);
  $("#pairs").innerHTML = "<div class='small'>Loading...</div>";
  $("#pairError").textContent = "";
  try{
    const list = await dsNewPairs(chains);
    $("#pairs").classList.remove("skeleton");
    if(!list.length){ $("#pairs").innerHTML = "<div class='small'>No data returned. Try again in 30s.</div>"; return; }
    $("#pairs").innerHTML = list.map(p=>`
      <div class="pair">
        <div><strong>${p.baseToken?.symbol || "?"}/${p.quoteToken?.symbol || "?"}</strong> <span class="small">on ${p.chain?.toUpperCase() || p.chainId}</span></div>
        <div class="small">Pair: ${p.pairAddress?.slice(0,10)}... · Dex: ${p.dexId || "-"}</div>
        <div class="small">FDV: ${p.fdv ? fmt(p.fdv, state.fiat.toUpperCase()) : "—"} · 24h Vol: ${p.volume?.h24? fmt(p.volume.h24):"—"}</div>
        <div class="small">Txns 5m: 🟩 ${p.txns?.m5?.buys||0} / 🟥 ${p.txns?.m5?.sells||0}</div>
        <a href="${p.url}" target="_blank">Open on Dexscreener</a>
      </div>
    `).join("");
  }catch(e){
    $("#pairError").textContent = e.message || "Pairs fetch failed.";
  }
}

// ---------------- Refresh ----------------
async function refreshTop(){
  try{
    $("#statusText").textContent = "Updating…";
    const top = await cgTop(state.fiat);
    renderTopCoins(top);
  }catch(e){
    $("#statusText").textContent = "Limited";
    $("#topError").textContent = e.message + " — Buttons still work. Use search or watchlist.";
    $("#topCoins").innerHTML = ""; // keep area clean; actions still accessible elsewhere
  }
}

function bind(){
  $("#fiat").value = state.fiat;
  $("#refreshInt").value = String(state.refresh);
  $("#fiat").onchange = ()=>{ state.fiat = $("#fiat").value; persist(); refreshTop(); };
  $("#refreshInt").onchange = ()=>{ state.refresh = Number($("#refreshInt").value); persist(); };
  $("#refreshNow").onclick = refreshTop;
  $("#addToken").onclick = async ()=>{
    const q = $("#searchToken").value.trim();
    if(!q) return;
    const id = await cgSearch(q);
    if(!id){ toast("Not found"); return; }
    addToWatch(id);
    selectToken(id);
  };
  $("#clearWatch").onclick = ()=>{ state.watchlist=[]; persist(); renderWatchlist(); };
  $("#loadPairs").onclick = loadPairs;
  $("#applyWsTicker").onclick = ()=>{
    state.wsTicker = ($("#wsTicker").value||"").trim();
    if(state.selected) selectToken(state.selected);
  };
}

(async function init(){
  bind();
  await refreshTop();
  await renderWatchlist();
  await loadPairs();
  setInterval(refreshTop, Math.max(5, state.refresh)*1000);
  if(state.watchlist.length) selectToken(state.watchlist[0]);
})();
