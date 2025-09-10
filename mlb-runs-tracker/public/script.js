// ---- Market math helpers ----
function americanToProbRaw(odds){ return odds>=0 ? 100/(odds+100) : (-odds)/((-odds)+100) }
function devigTwoWay(pOverRaw,pUnderRaw){ const d=pOverRaw+pUnderRaw; const pOver=pOverRaw/d; return {pOver,pUnder:1-pOver} }
function linInterp(x1,F1,x2,F2,target=.5){ if(F2===F1) return (x1+x2)/2; const t=(target-F1)/(F2-F1); return x1+t*(x2-x1) }
function impliedMedianFromAlts(alts){
  if(!alts||!alts.length) return null;
  const pts = alts
    .filter(a=>Number.isFinite(a.line)&&Number.isFinite(a.overOdds)&&Number.isFinite(a.underOdds))
    .map(a=>{ const pOverRaw=americanToProbRaw(a.overOdds); const pUnderRaw=americanToProbRaw(a.underOdds); const {pUnder}=devigTwoWay(pOverRaw,pUnderRaw); return {line:a.line,F:pUnder} })
    .sort((a,b)=>a.line-b.line);
  if(!pts.length) return null;
  for(let i=0;i<pts.length-1;i++){
    const a=pts[i], b=pts[i+1];
    if((a.F<=.5 && b.F>=.5) || (a.F>=.5 && b.F<=.5)) return linInterp(a.line,a.F,b.line,b.F,.5);
  }
  return pts.reduce((best,cur)=>Math.abs(cur.F-.5)<Math.abs(best.F-.5)?cur:best).line;
}
function marketImpliedTotal({ liveMain, liveAlts, preMain, preAlts }={}){
  const liveMedian = impliedMedianFromAlts(liveAlts);
  if(Number.isFinite(liveMedian)) return liveMedian;
  if(Number.isFinite(liveMain?.line)) return liveMain.line;
  const preMedian = impliedMedianFromAlts(preAlts);
  if(Number.isFinite(preMedian)) return preMedian;
  if(Number.isFinite(preMain?.line)) return preMain.line;
  return null;
}
function computeTwoNumbers(games){
  let totalRunsScored=0, expectedRemainingSum=0;
  for(const g of games){
    const A=Math.max(0,g.runsSoFar||0);
    totalRunsScored+=A;
    if(g.state!=="final"){
      const Tstar=marketImpliedTotal(g.markets||{});
      const rem=Number.isFinite(Tstar)?Math.max(Tstar-A,0):0;
      expectedRemainingSum+=rem;
    }
  }
  return { totalRunsScored, projectedSlateFinish: totalRunsScored+expectedRemainingSum };
}

// ---- UI wiring ----
const elKpiTotal = document.getElementById('kpi-total-runs');
const elKpiProj  = document.getElementById('kpi-projected');
const elGames    = document.getElementById('games-list');
const elTicker   = document.getElementById('ticker-track');

const btnRefresh = document.getElementById('btn-refresh');
const toggleFinal= document.getElementById('toggle-show-final');
const toggleCompact = document.getElementById('toggle-compact');

toggleCompact.addEventListener('change',()=> {
  document.body.classList.toggle('compact', toggleCompact.checked);
});
btnRefresh.addEventListener('click', hydrate);
toggleFinal.addEventListener('change', hydrate);

function gameBadge(state){
  if(state==="in_progress") return '<span class="badge badge--live">LIVE</span>';
  if(state==="final") return '<span class="badge badge--final">FINAL</span>';
  return '<span class="badge">SCHEDULED</span>';
}
function gameCard(g){
  const showFinals = toggleFinal.checked;
  if(g.state==="final" && !showFinals) return '';
  const score = `${g.away.runs} - ${g.home.runs}`;
  const Tstar = marketImpliedTotal(g.markets||{});
  const marketStr = Number.isFinite(Tstar) ? `Imp. total: ${Tstar.toFixed(1)}` : 'No market';

  return `
  <article class="game" data-id="${g.id}">
    <div class="game__row">
      <div class="team">
        <img alt="${g.away.abbr} logo" src="${g.away.logo}" />
        <div class="team__name" title="${g.away.name}">${g.away.abbr}</div>
      </div>
      <div class="game__score">${score}</div>
      <div class="team" style="justify-content:end">
        <div class="team__name" title="${g.home.name}" style="text-align:right">${g.home.abbr}</div>
        <img alt="${g.home.abbr} logo" src="${g.home.logo}" />
      </div>
    </div>
    <div class="sep"></div>
    <div class="game__meta">
      <div>${gameBadge(g.state)} ${g.inningStr || ''}</div>
      <div class="game__market">
        <span class="market-pill">${marketStr}</span>
      </div>
    </div>
  </article>`;
}
function renderTicker(games){
  const items = games.map(g=>{
    const tag = g.state==="final" ? "F" : (g.inningStr || g.state.toUpperCase());
    return `<span><span class="dot"></span>${g.away.abbr} ${g.away.runs} — ${g.home.abbr} ${g.home.runs} | ${tag}</span>`;
  }).join('');
  elTicker.innerHTML = items + items;
}

async function fetchGamesSnapshot(){
  const res = await fetch('/api/games', { cache: 'no-store' });
  if(!res.ok) throw new Error('Failed to load games');
  return res.json();
}

async function hydrate(){
  elGames.setAttribute('aria-busy','true');
  try{
    const games = await fetchGamesSnapshot();
    const { totalRunsScored, projectedSlateFinish } = computeTwoNumbers(games);
    elKpiTotal.textContent = Number.isFinite(totalRunsScored) ? Math.round(totalRunsScored) : '—';
    elKpiProj.textContent  = Number.isFinite(projectedSlateFinish) ? projectedSlateFinish.toFixed(1) : '—';
    renderTicker(games);
    elGames.innerHTML = games.map(gameCard).join('');
  }catch(e){
    console.error(e);
    elGames.innerHTML = '<p style="color:#f66">Error loading games.</p>';
  }finally{
    elGames.removeAttribute('aria-busy');
  }
}

hydrate();
setInterval(hydrate, 30000);
