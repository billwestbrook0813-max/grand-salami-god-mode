import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5173;

const ODDS_API_KEY = process.env.ODDS_API_KEY; // <- set this in Render/GitHub env vars
const SPORT_KEY = 'baseball_mlb';
const REGIONS = process.env.ODDS_REGIONS || 'us'; // comma separated, e.g. 'us,us2'
const ODDS_FORMAT = 'american';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Utility: safe get number
const num = (v, d=null) => (Number.isFinite(+v) ? +v : d);

// Map Odds API event + optional scores into UI shape
function mapEventToGame(event, scoreMap) {
  const id = event.id;
  const commence = event.commence_time;
  const homeTeam = event.home_team;
  const awayTeam = event.away_team;

  const scoreInfo = scoreMap.get(id) || {};
  const homeRuns = num(scoreInfo?.scores?.find(s => s.name === homeTeam)?.score, 0);
  const awayRuns = num(scoreInfo?.scores?.find(s => s.name === awayTeam)?.score, 0);

  // status
  // Odds API scores endpoint uses 'status': 'in_progress' | 'complete' | 'not_started'
  const status = scoreInfo?.status || 'not_started';
  const state = status === 'complete' ? 'final'
              : status === 'in_progress' ? 'in_progress'
              : 'scheduled';

  const inningStr = scoreInfo?.details || (state === 'scheduled' ? new Date(commence).toLocaleTimeString([], {hour:'numeric', minute:'2-digit'}) : '');

  // totals + alternate_totals from bookmakers
  const bookmakers = event.bookmakers || [];
  // Prefer a single "consensus" by aggregating all available outcomes into arrays we can process on FE
  let preMain = null;
  const preAlts = [];

  // helper to push outcomes
  const pushOutcomes = (market, intoAlts) => {
    const outcomes = market.outcomes || [];
    // For totals, outcomes might be two entries (Over, Under) both having a 'point' equal to the line
    const over = outcomes.find(o => o.name?.toLowerCase() === 'over');
    const under = outcomes.find(o => o.name?.toLowerCase() === 'under');
    if (over && under && Number.isFinite(+over.point)) {
      const line = +over.point;
      const overOdds = +over.price?.american || +over.price || +over.price_american || +over.odds || null;
      const underOdds = +under.price?.american || +under.price || +under.price_american || +under.odds || null;
      intoAlts.push({ line, overOdds, underOdds });
    }
  };

  // Collect markets across books
  for (const b of bookmakers) {
    for (const m of (b.markets || [])) {
      if (m.key === 'totals') {
        // main totals market
        const outcomes = [];
        const over = (m.outcomes || []).find(o => o.name?.toLowerCase() === 'over');
        const under = (m.outcomes || []).find(o => o.name?.toLowerCase() === 'under');
        if (over && under && Number.isFinite(+over.point)) {
          preMain = {
            line: +over.point,
            overOdds: +over.price?.american || +over.price || +over.price_american || +over.odds || null,
            underOdds: +under.price?.american || +under.price || +under.price_american || +under.odds || null,
          };
        }
      }
      if (m.key === 'alternate_totals') {
        pushOutcomes(m, preAlts);
      }
    }
  }

  return {
    id,
    state,
    inningStr,
    home: { abbr: (homeTeam||'HOME').slice(0,3).toUpperCase(), name: homeTeam, logo: `./assets/${(homeTeam||'home').toLowerCase().replace(/\s+/g,'')}.png` // e.g., 'New York Yankees' -> 'newyorkyankees.png', runs: homeRuns },
    away: { abbr: (awayTeam||'AWY').slice(0,3).toUpperCase(), name: awayTeam, logo: `./assets/${(awayTeam||'away').toLowerCase().replace(/\s+/g,'')}.png` // e.g., 'San Francisco Giants' -> 'sanfranciscogiants.png', runs: awayRuns },
    runsSoFar: homeRuns + awayRuns,
    markets: {
      preMain,
      preAlts,
      // liveMain/liveAlts can be obtained via event-odds for in-play books; many books expose only prematch totals via /odds.
      // If using a plan that includes in-play totals, you can add another fetch to /events/:id/odds and map 'totals' there into liveMain/liveAlts.
    }
  };
}

app.get('/api/games', async (req, res) => {
  if (!ODDS_API_KEY) {
    return res.status(500).json({ error: 'Missing ODDS_API_KEY environment variable' });
  }
  try {
    // 1) Featured markets: totals and alternate_totals
    const oddsUrl = new URL(`https://api.the-odds-api.com/v4/sports/${SPORT_KEY}/odds`);
    oddsUrl.searchParams.set('regions', REGIONS);
    oddsUrl.searchParams.set('markets', 'totals,alternate_totals');
    oddsUrl.searchParams.set('oddsFormat', ODDS_FORMAT);
    oddsUrl.searchParams.set('apiKey', ODDS_API_KEY);

    const [oddsResp, scoresResp] = await Promise.all([
      fetch(oddsUrl.toString(), { timeout: 15000 }),
      // 2) Scores (includes status + current scores for in-progress and recent finals)
      fetch(`https://api.the-odds-api.com/v4/sports/${SPORT_KEY}/scores?daysFrom=3&apiKey=${ODDS_API_KEY}`, { timeout: 15000 })
    ]);

    if (!oddsResp.ok) throw new Error(`Odds fetch failed: ${oddsResp.status}`);
    if (!scoresResp.ok) throw new Error(`Scores fetch failed: ${scoresResp.status}`);

    const oddsData = await oddsResp.json();
    const scoresData = await scoresResp.json();

    // Build map of scores by event id
    const scoreMap = new Map();
    for (const s of (scoresData || [])) {
      scoreMap.set(s.id, s);
    }

    const games = (oddsData || []).map(ev => mapEventToGame(ev, scoreMap));

    res.json(games);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch games from The Odds API' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`MLB Runs Tracker listening on http://localhost:${PORT}`);
});
