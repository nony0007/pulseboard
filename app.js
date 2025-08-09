
// ---------------------- Utilities ----------------------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const fmt = (n, cur="") => (n===null||n===undefined) ? "—" : (cur? new Intl.NumberFormat(undefined,{style:"currency",currency:cur}).format(n) : new Intl.NumberFormat().format(n));
const pct = (n) => (n===null||n===undefined) ? "—" : (n>=0? `+${n.toFixed(2)}%` : `${n.toFixed(2)}%`);
const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));

let state = {
  fiat: localStorage.getItem("fiat") || "usd",
  refresh: Number(localStorage.getItem("refresh") || 20),
  watchlist: JSON.parse(localStorage.getItem("watchlist") || '["bitcoin","ethereum","solana","arbitrum","base"]'),
  selected: null,
  top: []
};

// ---------------------- CoinGecko API ----------------------
async function fetchTopCoins(vs="usd"){
  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=${vs}&order=market_cap_desc&per_page=25&page=1&sparkline=false&price_change_percentage=1h,24h,7d`;
  const res = await fetch(url);
  if(!res.ok) throw new Error("CoinGecko rate limited or error");
  return res.json();
}

async function fetchHistory(id, vs="usd", days=1, interval="minute"){
  const url = `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=${vs}&days=${days}&interval=${interval}`;
  const res = await fetch(url);
  if(!res.ok) throw new Error("history error");
  return res.json();
}

async function searchId(query){
  const res = await fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`);
  if(!res.ok) return null;
  const data = await res.json();
  const coin = data.coins?.[0];
  return coin ? coin.id : null;
}

// ---------------------- Dexscreener API (New Pairs) ----------------------
async function fetchNewPairs(chains){
  // Dexscreener latest pairs per chain; we'll fetch and merge the first 20 per chain
  const results = [];
  for(const chain of chains){
    const url = `https://api.dexscreener.com/latest/dex/pairs/${chain}`;
    try{
      const res = await fetch(url);
      if(!res.ok) continue;
      const data = await res.json();
      const pairs = (data.pairs || []).slice(0, 15).map(p=> ({chain, ...p}));
      results.push(...pairs);
    }catch(e){}
    await sleep(250);
  }
  // Sort by createdAt (if available) or by txn count
  results.sort((a,b)=> (b.createdAt||0)-(a.createdAt||0));
  return results.slice(0, 45);
}

// ---------------------- Heuristic Prediction ----------------------
// Simple approach: compute recent return trend (EMA of 15 & 60 samples) from last-hour minute data;
// use volatility (std dev of log returns) and 24h volume as crude confidence proxy.
// Produce expected % move and likelihood bands for 1h/4h/24h.
function predictFromSeries(prices, volume24h){
  if(!prices || prices.length < 20) return null;
  // prices: [[ts, price], ...]
  const vals = prices.map(p=> p[1]);
  const returns = [];
  for(let i=1;i<vals.length;i++){
    returns.push(Math.log(vals[i]/vals[i-1]));
  }
  const ema = (arr, k)=>{
    let e = arr[0];
    const a = 2/(k+1);
    for(let i=1;i<arr.length;i++) e = arr[i]*a + e*(1-a);
    return e;
  };
  const rShort = ema(returns.slice(-30), 15);  // ~last 15 mins
  const rLong  = ema(returns.slice(-120), 60); // ~last hour
  const drift = (rShort*0.6 + rLong*0.4);      // weighted drift per step
  // volatility (per sample)
  const mean = returns.reduce((a,b)=>a+b,0)/returns.length;
  const variance = returns.reduce((a,b)=>a+(b-mean)*(b-mean),0)/(returns.length-1);
  const vol = Math.sqrt(Math.max(variance, 1e-9));
  // Map vol and volume24h to confidence 0..1
  const volScore = Math.max(0, 1 - (vol/0.01)); // if vol 1% per min => low confidence
  const volAdj = Math.min(1, Math.log10((volume24h||1)+10)/6); // more volume => more confidence
  const baseConf = Math.max(0.1, Math.min(0.95, 0.4*volScore + 0.6*volAdj));

  // Projected return for 1h/4h/24h (assuming drift per minute, 60/240/1440 steps)
  const proj = (minutes)=> Math.exp(drift*minutes) - 1;
  const p1h = proj(60);
  const p4h = proj(240);
  const p24h = proj(1440);

  // Likelihood: confidence damped by volatility vs move magnitude
  const like = (pmove)=>{
    const sizePenalty = Math.min(0.5, Math.abs(pmove)/0.2); // >20% move -> penalize
    return Math.max(0.05, Math.min(0.98, baseConf * (1 - sizePenalty)));
  };

  return {
    oneH: { change: p1h, likelihood: like(p1h), confidence: baseConf },
    fourH:{ change: p4h, likelihood: like(p4h), confidence: baseConf*0.9 },
    day:  { change: p24h, likelihood: like(p24h), confidence: baseConf*0.8 }
  };
}

// ---------------------- UI: Top Coins ----------------------
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
      <button data-id="${c.id}" class="view">View</button>
      <button data-id="${c.id}" class="add">Add</button>
    </div>
  `).join("");
  root.innerHTML = header + rows;
  $$("#topCoins .view").forEach(b=> b.onclick = ()=> selectToken(b.dataset.id));
  $$("#topCoins .add").forEach(b=> b.onclick = ()=> addToWatch(b.dataset.id));
}

// ---------------------- UI: Watchlist ----------------------
async function renderWatchlist(){
  const root = $("#watchlist");
  if(state.watchlist.length===0){ root.innerHTML = "<div class='badge'>Empty</div>"; return; }
  // fetch basic prices
  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=${state.fiat}&ids=${state.watchlist.join(",")}&price_change_percentage=1h,24h`;
  const res = await fetch(url); const data = res.ok ? await res.json() : [];
  root.innerHTML = data.map(c=>`
    <div class="row" style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border);padding:6px 0">
      <span><img class="icon" src="${c.image}"> ${c.name} <span class="symbol">(${c.symbol.toUpperCase()})</span></span>
      <span>${fmt(c.current_price, state.fiat.toUpperCase())} <span class="${c.price_change_percentage_24h_in_currency>=0?'chgUp':'chgDown'}">${pct(c.price_change_percentage_24h_in_currency)}</span></span>
      <span>
        <button class="view" data-id="${c.id}">Open</button>
        <button class="remove" data-id="${c.id}">✕</button>
      </span>
    </div>
  `).join("");
  $$("#watchlist .view").forEach(b=> b.onclick = ()=> selectToken(b.dataset.id));
  $$("#watchlist .remove").forEach(b=> b.onclick = ()=> removeFromWatch(b.dataset.id));
}

function addToWatch(id){
  if(!id) return;
  if(!state.watchlist.includes(id)) state.watchlist.push(id);
  persist(); renderWatchlist();
}
function removeFromWatch(id){
  state.watchlist = state.watchlist.filter(x=> x!==id);
  persist(); renderWatchlist();
}
function persist(){
  localStorage.setItem("watchlist", JSON.stringify(state.watchlist));
  localStorage.setItem("fiat", state.fiat);
  localStorage.setItem("refresh", state.refresh);
}

// ---------------------- Details + Chart + Prediction ----------------------
let chart;
async function selectToken(id){
  state.selected = id;
  const [hist, info] = await Promise.all([
    fetchHistory(id, state.fiat, 1, "minute"),
    fetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=${state.fiat}&ids=${id}`).then(r=>r.json()).then(a=>a[0])
  ]);

  $("#tdName").textContent = info ? `${info.name} (${info.symbol.toUpperCase()})` : id;
  $("#tdPrice").textContent = info ? fmt(info.current_price, state.fiat.toUpperCase()) : "—";
  $("#tdStats").innerHTML = info ? `
    <span class="badge">MktCap: ${fmt(info.market_cap, state.fiat.toUpperCase())}</span>
    <span class="badge">24h Vol: ${fmt(info.total_volume, state.fiat.toUpperCase())}</span>
    <span class="badge ${info.price_change_percentage_24h_in_currency>=0?'chgUp':'chgDown'}">24h: ${pct(info.price_change_percentage_24h_in_currency)}</span>
  ` : "—";

  // Chart
  const labels = hist.prices.map(p=> new Date(p[0]).toLocaleTimeString());
  const values = hist.prices.map(p=> p[1]);
  const ctx = $("#miniChart").getContext("2d");
  if(chart) chart.destroy();
  chart = new Chart(ctx, {
    type: "line",
    data: { labels, datasets: [{ label: id, data: values, fill:false, tension:.25 }] },
    options: { plugins:{legend:{display:false}}, scales:{x:{display:false}, y:{display:true}} }
  });

  // Prediction
  const pred = predictFromSeries(hist.prices, info?.total_volume||0);
  const renderPred = (el, p, label)=>{
    if(!p){ el.textContent = `${label}: —`; el.className = "pred"; return; }
    const dir = p.change>=0 ? "up":"down";
    el.className = "pred "+dir;
    const arrow = p.change>=0 ? "↑" : "↓";
    el.innerHTML = `<strong>${label}</strong>: ${arrow} ${pct(p.change*100)} · Likely: ${(p.likelihood*100).toFixed(0)}% · Confidence: ${(p.confidence*100).toFixed(0)}%`;
  };
  renderPred($("#pred1h"), pred?.oneH, "1h");
  renderPred($("#pred4h"), pred?.fourH, "4h");
  renderPred($("#pred24h"), pred?.day, "24h");
}

// ---------------------- New Pairs ----------------------
async function loadPairs(){
  const sel = $("#chains");
  const chains = Array.from(sel.selectedOptions).map(o=> o.value);
  $("#pairs").innerHTML = "<div class='small'>Loading...</div>";
  const list = await fetchNewPairs(chains);
  $("#pairs").innerHTML = list.map(p=>`
    <div class="pair">
      <div><strong>${p.baseToken?.symbol || "?"}/${p.quoteToken?.symbol || "?"}</strong> <span class="small">on ${p.chain?.toUpperCase() || p.chainId}</span></div>
      <div class="small">Pair: ${p.pairAddress?.slice(0,10)}... · Dex: ${p.dexId || "-"}</div>
      <div class="small">FDV: ${p.fdv ? fmt(p.fdv, state.fiat.toUpperCase()) : "—"} · 24h Vol: ${p.volume?.h24? fmt(p.volume.h24):"—"}</div>
      <div class="small">Txns 5m: 🟩 ${p.txns?.m5?.buys||0} / 🟥 ${p.txns?.m5?.sells||0}</div>
      <a href="${p.url}" target="_blank">Open on Dexscreener</a>
    </div>
  `).join("");
}

// ---------------------- App Init & Refresh Loop ----------------------
async function refreshAll(){
  try{
    const top = await fetchTopCoins(state.fiat);
    state.top = top;
    renderTopCoins(top);
    renderWatchlist();
    if(state.selected){ selectToken(state.selected); }
  }catch(e){
    $("#topCoins").innerHTML = "<div class='small'>Rate limited. Try 'Refresh' or increase interval.</div>";
  }
}

function bind(){
  $("#fiat").value = state.fiat;
  $("#refreshInt").value = String(state.refresh);
  $("#fiat").onchange = ()=>{ state.fiat = $("#fiat").value; persist(); refreshAll(); };
  $("#refreshInt").onchange = ()=>{ state.refresh = Number($("#refreshInt").value); persist(); };
  $("#refreshNow").onclick = refreshAll;
  $("#addToken").onclick = async ()=>{
    const q = $("#searchToken").value.trim();
    if(!q) return;
    const id = await searchId(q);
    if(!id){ alert("Not found"); return; }
    addToWatch(id);
    if(!state.selected) selectToken(id);
  };
  $("#loadPairs").onclick = loadPairs;
}

(async function init(){
  bind();
  await refreshAll();
  await loadPairs();
  // auto refresh
  setInterval(refreshAll, state.refresh*1000);
})();
