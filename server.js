// server.js
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
const REGIONS = process.env.ODDS_REGIONS || 'us'; // e.g., 'us,us2'
const ODDS_FORMAT = 'american';

app.use(cors());
app.use(express.json());

// ---- STATIC SITE ----
app.use(express.static(path.join(__dirname, 'public')));

// ---- helpers ----
const num = (v, d = null) => (Number.isFinite(+v) ? +v : d);

// Map Odds API event + optional scores into UI shape
function mapEventToGame(event, scoreMap) {
  const id = event.id;
  const commence = event.commence_time;
  const homeTeam = event.home_team;
  const awayTeam = event.away_team;

  const scoreInfo = scoreMap.get(id) || {};
  const homeRuns = num(scoreInfo?.scores?.find(s => s.name === homeTeam)?.score, 0);
  const awayRuns = num(scoreInfo?.scores?.find(s => s.name === awayTeam)?.score, 0);

  // status mapping: 'in_progress' | 'complete' | 'not_started'
  const status = scoreInfo?.status || 'not_started';
  const state =
    status === 'complete' ? 'final' :
    status === 'in_progress' ? 'in_progress' :
    'scheduled';

  const inningStr =
    scoreInfo?.details ||
    (state === 'scheduled'
      ? new Date(commence).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : '');

  // Collect totals + alternate_totals across bookmakers
  const bookmakers = event.bookmakers || [];

  let preMain = null;
  const preAlts = [];

  const readAmerican = v =>
    typeof v === 'object' && v !== null && 'american' in v
      ? +v.american
      : +v ?? null;

  const pushAlt = (market, intoAlts) => {
    const outcomes = market.outcomes || [];
    const over = outcomes.find(o => o.name?.toLowerCase() === 'over');
    const under = outcomes.find(o => o.name?.toLowerCase() === 'under');
    if (over && under && Number.isFinite(+over.point)) {
      const line = +over.point;
      const overOdds = readAmerican(over.price ?? over.odds ?? over.price_american);
      const underOdds = readAmerican(under.price ?? under.odds ?? under.price_american);
      intoAlts.push({ line, overOdds, underOdds });
    }
  };

  for (const b of bookmakers) {
    for (const m of b.markets || []) {
      if (m.key === 'totals') {
        const over = (m.outcomes || []).find(o => o.name?.toLowerCase() === 'over');
        const under = (m.outcomes || []).find(o => o.name?.toLowerCase() === 'under');
        if (over && under && Number.isFinite(+over.point)) {
          preMain = {
            line: +over.point,
            overOdds: readAmerican(over.price ?? over.odds ?? over.price_american),
            underOdds: readAmerican(under.price ?? under.odds ?? under.price_american),
          };
        }
      }
      if (m.key === 'alternate_totals') {
        pushAlt(m, preAlts);
      }
    }
  }

  return {
    id,
    state,
    inningStr,
    home: {
      abbr: (homeTeam || 'HOME').slice(0, 3).toUpperCase(),
      name: homeTeam,
      // e.g., 'New York Yankees' -> 'newyorkyankees.png'
      logo: `./assets/${(homeTeam || 'home').toLowerCase().replace(/\s+/g, '')}.png`,
      runs: homeRuns,
    },
    away: {
      abbr: (awayTeam || 'AWY').slice(0, 3).toUpperCase(),
      name: awayTeam,
      // e.g., 'San Francisco Giants' -> 'sanfranciscogiants.png'
      logo: `./assets/${(awayTeam || 'away').toLowerCase().replace(/\s+/g, '')}.png`,
      runs: awayRuns,
    },
    runsSoFar: (homeRuns ?? 0) + (awayRuns ?? 0),
    markets: {
      preMain,
      preAlts,
      // liveMain/liveAlts can be obtained via event-odds for in-play books.
      // If your plan includes in-play totals per event, add a second call to:
      //   GET /v4/sports/baseball_mlb/events/:eventId/odds
      // and map 'totals' into liveMain/liveAlts to feed the front-end implied-total logic.
    },
  };
}

// ---- DATA ENDPOINT ----
app.get('/api/games', async (req, res) => {
  if (!ODDS_API_KEY) {
    return res.status(500).json({ error: 'Missing ODDS_API_KEY environment variable' });
  }
  try {
    // 1) Odds (prematch totals + alternates)
    const oddsUrl = new URL(`https://api.the-odds-api.com/v4/sports/${SPORT_KEY}/odds`);
    oddsUrl.searchParams.set('regions', REGIONS);
    oddsUrl.searchParams.set('markets', 'totals,alternate_totals');
    oddsUrl.searchParams.set('oddsFormat', ODDS_FORMAT);
    oddsUrl.searchParams.set('apiKey', ODDS_API_KEY);

    // 2) Scores (status + current scores)
    const scoresUrl = new URL(`https://api.the-odds-api.com/v4/sports/${SPORT_KEY}/scores`);
    scoresUrl.searchParams.set('daysFrom', '3');
    scoresUrl.searchParams.set('apiKey', ODDS_API_KEY);

    const [oddsResp, scoresResp] = await Promise.all([
      fetch(oddsUrl.toString()),
      fetch(scoresUrl.toString()),
    ]);

    if (!oddsResp.ok) throw new Error(`Odds fetch failed: ${oddsResp.status}`);
    if (!scoresResp.ok) throw new Error(`Scores fetch failed: ${scoresResp.status}`);

    const oddsData = await oddsResp.json();
    const scoresData = await scoresResp.json();

    const scoreMap = new Map();
    for (const s of scoresData || []) scoreMap.set(s.id, s);

    const games = (oddsData || []).map(ev => mapEventToGame(ev, scoreMap));

    res.json(games);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch games from The Odds API' });
  }
});

// Fallback: single-page app
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`MLB Runs Tracker listening on http://localhost:${PORT}`);
});
