# Audio credits

Every sound and both music beds are CC0 / public domain: free to use, including commercially, with no
attribution required. Each source page below was checked to show the CC0 licence on 1 Nov 2026.
The files here are built from those sources by `pnpm audio <source folder>` (`scripts/make-audio.ts`:
trim, fades, loudness levelling, one sprite for the effects, seamless loops for the music;
`pnpm audio <folder> --bgm-only` rebuilds just the music). The source files themselves are not kept in the repo.

| Shipped file | Key | Used for | Source file | Source URL | Creator | License |
|---|---|---|---|---|---|---|
| `sfx.webm` / `sfx.mp3` | `sfx_tick` | a vote lands (pitch ±10 %) | `pluck_001.ogg` — Interface Sounds 1.0 | https://kenney.nl/assets/interface-sounds | Kenney | CC0 1.0 |
| 〃 | `sfx_burst` | many votes at once | `chips-handle-1.ogg` — Casino Audio | https://kenney.nl/assets/casino-audio | Kenney | CC0 1.0 |
| 〃 | `sfx_overtake` (whoosh part) | someone overtakes | `whoosh_short_mid.wav` (#449996) | https://freesound.org/people/DJT4NN3R/sounds/449996/ | DJT4NN3R | CC0 1.0 |
| 〃 | `sfx_overtake` (ding part) | 〃 | `confirmation_001.ogg` — Interface Sounds 1.0 | https://kenney.nl/assets/interface-sounds | Kenney | CC0 1.0 |
| 〃 | `sfx_leader` | new no. 1 | `jingles_HIT15.ogg` — Music Jingles | https://kenney.nl/assets/music-jingles | Kenney | CC0 1.0 |
| 〃 | `sfx_chase` | closing in on the lane above | `phaserUp3.ogg` — Digital Audio | https://kenney.nl/assets/digital-audio | Kenney | CC0 1.0 |
| 〃 | `sfx_open` | award opens | `jingles_STEEL07.ogg` — Music Jingles | https://kenney.nl/assets/music-jingles | Kenney | CC0 1.0 |
| 〃 | `sfx_count` | last 10 seconds | `tick_004.ogg` — Interface Sounds 1.0 | https://kenney.nl/assets/interface-sounds | Kenney | CC0 1.0 |
| 〃 | `sfx_close` | voting closes (gong) | `gong-013.wav` (#436486) | https://freesound.org/people/rabban625/sounds/436486/ | rabban625 | CC0 1.0 |
| 〃 | `sfx_drumroll` | before the reveal | `drumroll.wav` (#191718) | https://freesound.org/people/adriann/sounds/191718/ | adriann | CC0 1.0 |
| 〃 | `sfx_place` | 3rd / 2nd place card | `jingles_HIT11.ogg` — Music Jingles | https://kenney.nl/assets/music-jingles | Kenney | CC0 1.0 |
| 〃 | `sfx_reveal` | winner appears (cymbal) | `crash Zildjian 16 inches bassized very long 2` (#807997) | https://freesound.org/people/Logicogonist/sounds/807997/ | Logicogonist | CC0 1.0 |
| 〃 | `sfx_applause` | after the reveal | `cheering and clapping crowd 2` (#221567) | https://freesound.org/people/AlaskaRobotics/sounds/221567/ | AlaskaRobotics | CC0 1.0 |
| `bgm-lobby.webm` / `.mp3` | `bgm_lobby` | lobby / waiting music (loop, 80.0 s, 120 bpm) | `sunny_city_bpm120.mp3` — Sunny City (saved as `og_sunny_city_bpm120.mp3`) | https://opengameart.org/content/sunny-city | MintoDog | CC0 1.0 |
| `bgm-voting.webm` / `.mp3` | `bgm_voting` | music while voting is open (loop, 102.4 s, 150 bpm) | `trance_boss_battle_bpm150.mp3` — Trance Boss Battle (saved as `og_trance_boss_battle_bpm150.mp3`) | https://opengameart.org/content/trance-boss-battle | MintoDog | CC0 1.0 |

- Kenney packs: the `License.txt` in each pack says "Creative Commons Zero, CC0 — free to use in personal, educational
  and commercial projects", crediting optional. Thank you, Kenney.
- Freesound: every sound page above shows the Creative Commons 0 licence. Downloaded from the public preview (HQ MP3)
  on that page.
- OpenGameArt: each page above shows the CC0 licence badge for that work; the files are the `.mp3` links on the page,
  no account needed. Both tracks are cut on the beat to a whole number of bars (256 / 160 beats), so they loop as they
  are, with no crossfade.
- Not used: anything under a licence that needs attribution, and anything from streaming or video sites.
- Licence text: https://creativecommons.org/publicdomain/zero/1.0/
