# MLB Runs Tracker

A lightweight, mobile-first dashboard that shows:
- **Total Runs Scored** (sum of all actual runs across games)
- **Projected Slate Finish** (actual runs + market-implied expected remaining,
  using pre/alt/live totals, de-vigged and converted to a single implied total per game).

## Quick start
1) Install Node 18+.
2) In this folder, run:
   ```bash
   npm i
   npm start
   ```
3) Open http://localhost:5173

The site serves the static UI from `/public` and a stub endpoint at `/api/games`.
Replace the body of that handler with your live feed logic.

## Data shape
Each game object:
```json
{
  "id": "string",
  "state": "scheduled|in_progress|final",
  "inningStr": "Top 5th|F|etc",
  "home": { "abbr":"NYY","name":"Yankees","logo":"./assets/nyy.png","runs":2 },
  "away": { "abbr":"DET","name":"Tigers","logo":"./assets/det.png","runs":1 },
  "runsSoFar": 3,
  "markets": {
    "liveMain": { "line": 8.5, "overOdds": -110, "underOdds": -110 },
    "liveAlts": [{ "line":7.5,"overOdds":-140,"underOdds":120 }, { "line":9.5,"overOdds":125,"underOdds":-145 }],
    "preMain":  { "line": 8.0, "overOdds": -110, "underOdds": -110 },
    "preAlts":  []
  }
}
```

## Assets
Drop transparent team logos into `public/assets/` (e.g., `nyy.png`, `det.png`, etc.).
Replace `logo.svg` if you want a custom product mark.


---
## Using The Odds API (live data)
Set your API key as an environment variable before starting the server:

**Local:**
```bash
ODDS_API_KEY=your_key_here npm start
```

**Render:**
- Add `ODDS_API_KEY` in **Environment** > **Environment Variables**.
- Optional: override `ODDS_REGIONS` (default `us`).

The server hits:
- `GET /v4/sports/baseball_mlb/odds?regions=REGIONS&markets=totals,alternate_totals&oddsFormat=american&apiKey=...`
- `GET /v4/sports/baseball_mlb/scores?daysFrom=3&apiKey=...`

It merges odds + scores and returns the UI shape expected by `public/script.js`.


---
## Live in-play totals (optional enhancement)
This version maps **prematch totals + alternate totals**. If your plan includes **in-play totals per event**, we can add a second call to:

`GET /v4/sports/baseball_mlb/events/:eventId/odds`

to fetch **live lines** and fill `liveMain` / `liveAlts` as well.



## Team logo mapping
Team logo filenames are derived from team names (e.g., `newyorkyankees.png`). You can keep your own filenames by adjusting the mapping logic in `server.js` where the logo path is constructed.



---
## Local environment variables
- Copy `.env.example` to `.env` and set your values for local runs.

## GitHub Actions (optional auto-deploy)
- Workflow in `.github/workflows/deploy.yml` triggers on pushes to `main`.
- In your GitHub repo settings, add a secret named **RENDER_DEPLOY_HOOK** with your Render service’s Deploy Hook URL (Render dashboard → your service → Settings → Deploy Hooks).
- On push, the workflow will `npm install` (sanity check) and POST to that hook to trigger a deploy.
