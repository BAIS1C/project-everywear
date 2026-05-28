# Kasai Sports Picks Analyst via Browser MCP

Date: 2026-05-27

## Intent

Build a Kasai/My Mait research workflow that automates the tedious parts of sports pick analysis through browser MCP, without relying on odds/stat APIs by default.

This is a research and decision-support direction, not a guarantee of profit. Betting carries financial risk. The product posture should be evidence-first, conservative, and human-confirmed.

## Source Methodology

Local reference:

`C:\Users\MAG MSI\Project Claude\Kasai-Local\sports betting sytem.html`

The referenced video/method describes a soccer **Over 1.5 total goals** strategy with a claimed 87% hit rate.

Filters to automate:

1. Both teams average at least `1.0` goal per game.
2. Head-to-head meetings between the two teams went Over 1.5 goals at least `80%` of the time.
3. Both teams scored in at least `4 of their last 5` matches.
4. Offered Over 1.5 odds are better than the claimed 87% fair price:
   - fair probability: `0.87`;
   - American odds: about `-670`;
   - decimal odds: about `1.149`.

Important: treat `87%` as an unverified hypothesis until Kasai backtests by league, date range, source, and price band.

## Preferred Architecture

No default odds/data APIs. Use browser MCP:

```text
Kasai Pick Agent
  -> Browser MCP opens stats sites
  -> extracts fixtures, team stats, H2H, recent form
  -> opens odds pages / sportsbook pages
  -> reads Over 1.5 price
  -> runs deterministic filters
  -> ranks candidates
  -> saves evidence
  -> optionally prepares bet slip
  -> stops before final submission
```

## Browser-MCP Steps

1. Open fixture sources such as Flashscore, SofaScore, Soccerway, or similar visible web pages.
2. Gather upcoming matches by date/league.
3. For each match, extract:
   - home goals per game;
   - away goals per game;
   - H2H score history;
   - last five results for each team;
   - whether each team scored in those last five;
   - Over 1.5 odds from visible odds/sportsbook page.
4. Convert odds to implied probability.
5. Apply the four filters.
6. Compute edge and expected value against the assumed model probability.
7. Save evidence:
   - source URLs;
   - timestamps;
   - screenshots;
   - extracted table rows or DOM text;
   - extraction confidence.
8. Produce ranked candidate picks.

## Human-in-the-Loop Boundary

Kasai may:

- navigate to sportsbook/odds pages;
- search for a match;
- locate the Over 1.5 goals market;
- highlight or prepare a bet slip;
- explain the rationale and risks.

Kasai must not:

- bypass CAPTCHA or anti-bot systems;
- use stealth login or evasion tactics;
- circumvent sportsbook terms of service;
- submit a bet without explicit user confirmation of the exact wager;
- chase losses or auto-increase stakes after losses.

Default mode should stop at **review-ready pick + evidence**. Bet slip preparation is optional and confirmation-gated.

## Candidate Output Contract

Each pick candidate should contain:

```json
{
  "match": "Home Team vs Away Team",
  "league": "League name",
  "kickoff_time": "ISO-8601 or local display",
  "market": "Over 1.5 Goals",
  "odds": {
    "american": "-420",
    "decimal": 1.238,
    "source": "visible sportsbook or odds page"
  },
  "implied_probability": 0.8077,
  "assumed_model_probability": 0.87,
  "edge": 0.0623,
  "ev": 0.077,
  "filters": {
    "home_goals_per_game": true,
    "away_goals_per_game": true,
    "h2h_over_15_rate": true,
    "recent_form": true,
    "price_threshold": true
  },
  "evidence": {
    "stats_urls": [],
    "odds_urls": [],
    "screenshot_paths": [],
    "extracted_rows": []
  },
  "recommendation": "candidate",
  "risk_notes": []
}
```

## Everywear Product Shape

Create this as a Kasai/My Mait skill or applet surface:

- **Scan:** run browser-MCP scan over today/tomorrow fixtures.
- **Candidates:** ranked table with pass/fail filter chips, odds, edge, and confidence.
- **Evidence:** screenshots, source links, extracted rows, and page timestamps.
- **Backtest:** replay saved scans and realized match results by league/source.
- **Bet Slip:** opens the site and highlights/prepares the selection, but stops for explicit user confirmation.

## Risk Controls

- No parlays by default.
- No automatic bet submission by default.
- No bankroll advice unless the user explicitly configures bankroll and staking rules.
- If staking is enabled, use conservative capped fractional Kelly or flat stake defaults.
- Show responsible gambling warnings and make it easy to skip/ignore picks.
- Log every recommendation with the evidence used at decision time.

## Next Implementation Slice

1. Define a Kasai skill spec for `Sports Picks Analyst`.
2. Add a browser-MCP extraction schema for fixtures, stats, H2H, form, and odds.
3. Implement deterministic scoring locally.
4. Save scan evidence to Vault.
5. Add a dry-run candidate report before any sportsbook login or bet-slip interaction.
