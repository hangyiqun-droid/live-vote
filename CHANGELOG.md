# Changelog

## 1.0.0 — v1.0.0-build001

First public release.

- Live voting for a room: phones vote, the big screen races the bars live, the MC drives the show from `/admin`.
- Five awards opened and closed one at a time; the stage plays an announcement scene with the podium and a hall of winners.
- One vote per device per award, enforced in Postgres. Nobody can see who voted for whom.
- Sound on the stage (CC0 effects and music), with the vote-storm throttling.
- Nominees are drawn as coloured circles with an initial; no photos are stored or shipped.
- Demo mode (`DEMO_MODE=1`): "sample data" tags, lobby greetings off for good, and a daily reset cron.
- Optional sub-path hosting through `NEXT_PUBLIC_BASE_PATH` (empty by default).
