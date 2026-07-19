# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
and the project adopts [Semantic Versioning](https://semver.org/).

## [1.0.0] — 2026-07-18

> **From-scratch, AniList-first rewrite.** MyAnimeList support, manual mapping, and the
> provider-selection UI are gone — the extension now reads and writes your real AniList
> lists directly, with a new panel-style popup instead of one purely reactive to the
> current tab.

### Added

- **AniList lists are now the source of truth.** No more local mapping table
  (`cr:<id>#S<n>` / `pv:<detailId>` → target) — the extension keeps a local cache of the
  whole AniList collection (`MediaListCollection`) and matches the detected Crunchyroll/
  Prime Video page against it, primarily via the streaming link AniList has on file
  (`externalLinks`), falling back to matching by title (romaji/English/synonyms, exact
  match) when that link is missing or outdated. Cache refreshes automatically about once a
  week, on demand via a **⟳ re-sync** button, and is patched instantly whenever the
  extension itself saves progress or adds a new anime.
- **New panel-style popup with four screens**, reacting to the active tab and whether a
  match was found in the cache:
  - **List panel** — Watching/Plan to Watch tabs, compact cards (banner, progress bar,
    countdown to the next episode, source badge), each with a **Details** button.
  - **Detail screen** — full view of one anime: editable progress, Save, Plan to Watch,
    Pause, Drop, links to AniList and the source platform, "currently in: `<list>`"
    indicator for every status (not just the ones that need confirmation to leave).
  - **Quick screen** — recognized episode page: episode number pre-filled, one-click Save,
    a **Details** button for anything else.
  - **Search screen** — reuses the existing search UI against AniList instead of a
    provider; destination depends on whether it came from an anime page (Plan to Watch) or
    an episode page (Watching + progress).
- **Confirmation before leaving "other lists"** (Completed/Dropped/Paused/Rewatching):
  saving progress or picking Plan to Watch on an anime currently in one of those now shows
  a warning with the current list first — a second click confirms the move. Going from Plan
  to Watch to Watching stays automatic, no confirmation needed.
- **Title-based fallback matching for Crunchyroll** (`findByTitle` in `store.js`, shared
  with the existing Prime Video fallback): a real check found 202 of 326 Crunchyroll links
  in one user's AniList data still on the pre-2018 URL format (no series ID), which never
  matched by ID alone — see [Known limitations](README.md#known-limitations) in the README.

### Changed

- **Automatic start/finish dates** (ported from v0.1.1's `computeDates`, unchanged rule):
  start date is set to today the first time progress leaves 0; finish date + `Completed`
  status once progress reaches the known episode total. The old **"Finish"** button (for
  completing when the total is unknown, e.g. a simulcast) was **not** ported — known,
  accepted gap.
- Details button (panel card + quick screen) recolored (purple/violet) and moved before the
  source badge, so multiple platform badges stay uniform as more sources get added; Plan to
  Watch (turquoise) and Pause (amber) buttons recolored off the previous generic gray, all
  chosen to avoid clashing with likely future platform colors (Netflix red, Hulu green,
  Twitch/HBO Max purple).
- Watching/Plan to Watch switcher restyled as actual tabs (underline + colored active
  state) instead of a pair of pill buttons; the manual re-sync button moved from beside the
  tabs to the header, next to settings.
- Crunchyroll/Prime Video source badge colors (`.src.cr`/`.src.pv`) now apply everywhere the
  classes are used, not just inside the panel's cards — fixes the detail screen's source
  button rendering white instead of platform-colored.
- AniList link now comes before the source badge in the detail screen's last row.

### Removed

- `providers/mal.js`, `providers/index.js` (generic provider registry), `providers/
  shared.js` (MAL↔AniList `idMal` cross-reference) — AniList is the only backend now, no
  more provider abstraction.
- Provider-selection UI (`popup.html`/`popup.js`) and `auth/mal/*` storage keys.
- MAL `host_permissions`.

## [0.5.3] — 2026-07-16

> **Last release of this architecture.** v1.0.0 is a from-scratch, AniList-first rewrite —
> MyAnimeList support, manual mapping, and the provider-selection UI are all dropped in favor
> of reading/writing your real AniList lists directly. See the `[1.0.0]` entry (once shipped)
> for what replaced them.

### Added

- **MIT license.** The repo had been public since v0.1.0 with no license file, which by
  default means "all rights reserved" — nobody could legally reuse the code. Now
  explicitly MIT, mentioned in both READMEs.

### Fixed

- **Release links in this changelog were broken.** They pointed to
  `/releases/tag/vX.Y.Z` for 0.1.0–0.3.3, but only the v0.1.0 and v0.1.1 tags had ever
  been created — every other link 404'd. All 15 missing tags (0.2.0 → 0.5.2) were created
  retroactively, each pointing at the commit that bumped `manifest.json` to that version
  (matching the convention the two existing tags already followed), and the link list now
  covers all 17 versions instead of stopping at 0.3.3.

## [0.5.2] — 2026-07-15

### Changed

- **README (en/pt-BR) revised** now that the provider layer has settled: "How it works"
  opens by naming the two independent axes — *source* (Crunchyroll/Prime Video, detected)
  and *provider* (MAL/AniList, picked) — instead of leaving the split implicit; the
  Crunchyroll/Prime Video extraction step split into clear sub-bullets instead of one dense
  paragraph; the `Structure` file tree's comment alignment fixed in both languages.
- **New "Security notes" section:** `chrome.storage.local` (where auth — Client ID/Secret,
  access/refresh tokens — lives) isn't encrypted at rest, isolated from other extensions
  and web pages but not from local machine access; the mapping table is the only thing
  that syncs (`chrome.storage.sync`), and it holds no credentials. Includes how to revoke
  access from each provider if a token is ever suspected leaked.

## [0.5.1] — 2026-07-14

### Added

- **Banner-style cards across the popup:** saved mappings, search/pick results, and the
  confirm/save screen all now show a wide cover image (3:1 crop) instead of a small
  thumbnail or plain text — AniList's `bannerImage` field when available, falling back to
  the vertical poster (`picture`, cropped) otherwise; MAL entries always use the poster
  fallback since MAL's API has no landscape image field. Both `picture` and `banner` are
  persisted per mapping (`providers.<id>.{picture,banner}`, just URLs — a few dozen bytes
  each, no meaningful cost against `chrome.storage.sync`'s quota) instead of being fetched
  only transiently like before. Mappings saved before this version show a placeholder
  until re-saved or re-mapped once.

## [0.5.0] — 2026-07-14

### Added

- **Provider layer: AniList support alongside MyAnimeList.** Where progress gets tracked
  is now a choice, not a hardcoded backend — pick MAL, AniList, or switch between them
  anytime from the new **⚙** settings button in the header. AniList login uses OAuth2's
  Implicit Grant (no client secret needed; neither AniList grant type supports refresh
  tokens, so a year-long token with no exchange step is the simpler option). Search,
  progress, and "Plan to watch" all go through AniList's GraphQL API when it's the active
  provider.
- **Cross-provider mapping resolution.** A season already mapped on one provider resolves
  automatically on the other via AniList's `idMal` field (works both ways, MAL→AniList and
  AniList→MAL) instead of asking you to search again — the AniList API is the only side
  that holds both IDs on the same record.
- Saved mappings now keep a target **per provider** (`providers: { mal: {...}, anilist:
  {...} }`) instead of one baked into the field names, so switching your active provider
  never discards a mapping you already had with the other one. Existing mappings migrate
  to the new shape automatically the first time they're read.

### Changed

- `mal.js` becomes `providers/mal.js`, implementing the same provider interface AniList
  now uses (`providers/anilist.js`) — internal refactor, no behavior change on its own.
- `content.js` / `content-pv.js` become `sources/crunchyroll.js` / `sources/primevideo.js`
  — symmetric with `providers/`, same rename spirit (no behavior change).
- UI strings that referenced "MAL" specifically (button labels, placeholders, error/status
  messages) now adapt to whichever provider is active.
- `host_permissions` gains `graphql.anilist.co`.

Motivation: Prime Video translates anime titles heavily in its own UI, which made MAL's
plain-title search miss often. Rather than replace the working MAL integration, the
backend became swappable — AniList's multilingual `synonyms` field handles those localized
titles noticeably better, confirmed against a real Prime Video page after this shipped.

## [0.4.2] — 2026-07-13

### Fixed

- Mapping from the Crunchyroll series page (`Plan to watch` origin) failed for shows
  whose season selector doesn't use the `S{n}: title` label format — e.g. "Clevatess"
  ("Clevatess" / "Clevatess II" in the dropdown, "2ª Temporada" in pt-BR), where no
  season number could be parsed. Season detection now also recognizes worded labels
  ("2ª Temporada", "Season 2") and, when nothing matches, defaults to season 1 (the
  page's default state) instead of failing outright.

## [0.4.1] — 2026-07-13

### Changed

- READMEs (en/pt-BR) and popup screenshots updated to reflect v0.4.0: the "Plan to
  watch" flow, mapping from the anime's own page (no episode/player needed), and the
  `CR ↗` / `PV ↗` shortcut in the mappings list.

## [0.4.0] — 2026-07-13

### Added

- **"Plan to watch" button.** Saved mappings no longer require recording episode
  progress first — you can now bookmark an anime you haven't started yet, so it
  shows up in the mappings list (with its `CR ↗` / `PV ↗` shortcut) right away.
  If the anime isn't in any MyAnimeList list yet, this also sets its status to
  `plan_to_watch` there (0 episodes watched); if it's already in a list
  (watching, completed, etc.), only the local mapping is saved — existing
  progress is never overwritten.
- **Mapping from the anime's own page, no episode required.** Crunchyroll
  (`/series/{id}/...`) and Prime Video (`/detail/{id}`) pages can now be mapped
  directly, without opening an episode or starting the player — avoids the
  platform recording the episode as "opened" for something you haven't
  actually watched yet. Season detection on Crunchyroll reads the page's own
  season selector; Prime Video's `/detail/{id}` is already season-specific.
  Opening an episode or the player still works exactly as before.

### Changed

- Error messages for "couldn't identify what to map" now cover both entry
  points (episode/player and anime page) instead of assuming the episode page.

## [0.3.6] — 2026-07-13

### Fixed

- The episode header (`S{season} · ep {episode}`) was the last hardcoded,
  non-localized string in the popup UI. It now goes through the same
  `chrome.i18n` mechanism as the rest of the interface (`epMetaFormat` key).

## [0.3.5] — 2026-07-13

### Added

- Saved mappings now show a link button (`CR ↗` / `PV ↗`, colored per platform) that
  opens the anime's page on the source platform directly, built from the mapping's
  `mapKey` — no schema change or re-mapping needed for existing entries.

## [0.3.4] — 2026-07-13

### Changed

- New extension icon (eye illustration) replacing the previous placeholder, resized to
  16/48/128px. Source image kept at `extension/icons/original.png`.

## [0.3.3] — 2026-07-13

### Changed

- **`README.md` is now the English version** (used to be pt-BR); Portuguese moves to
  `README.pt-BR.md`, kept as a bilingual pair with a cross link between them. Reason:
  English has wider reach on GitHub and is what the platform shows by default on the repo
  page — in pt-BR, the README would stay "hidden" even with an English version available.
- **Changelog consolidated to English-only:** the short-lived `CHANGELOG.en.md` becomes
  the one and only `CHANGELOG.md`; there's no more Portuguese changelog. Unlike the
  README, keeping a bilingual pair here wasn't worth the ongoing translation upkeep for a
  document that's mostly a technical log.

## [0.3.2] — 2026-07-13

### Changed

- **The extension's `default_locale` switches from `pt_BR` to `en`:** only affects the
  `chrome.i18n` fallback when the browser's language doesn't match any shipped locale
  (neither `pt_BR` nor `en`) — in that case it now falls back to English instead of
  Portuguese.
- `CHANGELOG.en.md`: full English translation of the changelog, with a cross link at the
  top of both files.

## [0.3.1] — 2026-07-13

### Added

- **`README.en.md`:** full English translation of the README, with its own screenshots
  (`screenshots/*-en.png`) generated by intercepting `chrome.i18n.getMessage` in the
  popup to serve `en/messages.json` without depending on the browser/OS language. Cross
  links at the top of both READMEs (`Read this in English` / `Leia isso em português`).

## [0.3.0] — 2026-07-13

### Added

- **Internationalization (pt-BR + en):** the popup UI now uses `chrome.i18n`
  (`_locales/pt_BR/messages.json` and `_locales/en/messages.json`, 67 keys). Chrome picks
  the language on its own based on the browser's locale; `manifest.json` also uses
  `__MSG_extDescription__`. Dynamic strings (error messages, progress, warnings) use a
  `tr(key, vars)` helper with `{token}` placeholders — simpler than `chrome.i18n`'s native
  `$1`/`$2` scheme for messages with several variables. Static HTML text uses
  `data-i18n`/`data-i18n-placeholder`/`data-i18n-title`/`data-i18n-html` attributes, filled
  in when the popup loads.

## [0.2.1] — 2026-07-12

### Added

- **Source badge (CR/PV) in the mappings list:** every saved mapping now stores a `site`
  field (`cr`/`pv`), shown as a colored badge before the title. Mappings saved before this
  change don't have the field — falls back to inferring it from the key format (only
  Crunchyroll existed before multi-site support, so the absence of the `pv:` prefix safely
  identifies CR).
- Popup screenshots (`screenshots/`) referenced in the README.

### Fixed

- The README's title (H1) still had the extension's old name
  (`Crunchyroll/Prime Video → MyAnimeList`) — fixed to **"Anime Watched"**.

## [0.2.0] — 2026-07-12

### Added

- **Prime Video support:** new content script (`content-pv.js`) that extracts
  series/season/episode straight from the player overlay (`.atvwebplayersdk-title-text` /
  `.atvwebplayersdk-episode-info`) — Prime Video doesn't navigate to its own player URL,
  so extraction requires the player to be open.
- **Site routing in the background script:** `background.js` now detects the active tab's
  site (Crunchyroll or Prime Video) and injects/queries the matching content script.
- **Per-season mapping on Prime Video:** key `pv:<detailId>` — each season already has its
  own `detail/<ID>` on Amazon, so (unlike CR) there's no need to compose it with the
  season number.

### Changed

- The extension's name becomes **"Anime Watched"** (same name as the project), replacing
  `Crunchyroll/Prime Video → MyAnimeList`.
- "No episode detected" popup messages generalized per site (`NOT_SUPPORTED_SITE`,
  `NOT_A_WATCH_PAGE`, `NO_PLAYER_OPEN`).

### Fixed

- **Truncated title/subtitle in the MAL candidates list:** `.candidate .title`/`.sub` used
  `white-space: nowrap` + `text-overflow: ellipsis`, cutting off long names (e.g.,
  "Katainaka no Ossan, Kens..."). Replaced with line wrapping (`overflow-wrap:
  break-word`) and widened the popup from 350px to 380px.

## [0.1.1] — 2026-07-11

### Added

- **Automatic start/finish dates on MAL:** when saving, sets `start_date = today` when
  MAL's progress is at 0 (robust to Crunchyroll's numbering — anchored on watched count,
  not on "episode == 1") and `finish_date = today` when the season is completed (number ≥
  total). Only fills in empty dates, never overwrites.
- **"Finish" button:** explicitly marks `completed` + `finish_date = today`, even when MAL
  doesn't know the total (simulcast/ongoing season). Adjusts watched count to the total
  when it's known.
- **Progress with dates:** the progress line shows start/finish dates (`started
  2026-04-19`) and the success message reports what was set (`started today · finished
  today · completed`).

## [0.1.0] — 2026-07-11

First working version. Chrome extension (Manifest V3) that logs the episode watched on
Crunchyroll to MyAnimeList via the toolbar button.

### Added

- **Crunchyroll extraction:** reads series, season, and episode number from the `/watch/`
  page's `TVEpisode` JSON-LD (fallback to `og:title`).
- **OAuth2 with MyAnimeList:** login via `chrome.identity.launchWebAuthFlow` with PKCE
  (`plain` method, a MAL requirement) and automatic token refresh. Client Secret support
  for `web`-type apps.
- **Progress logging:** `PATCH /v2/anime/{id}/my_list_status` with
  `num_watched_episodes`; marks `completed` once the episode total is reached, otherwise
  `watching`.
- **CR→MAL mapping:** local table (`chrome.storage`) keyed per season
  (`crSeriesId#SseasonNumber`), handling the case where a CR season is a separate MAL
  entry.
- **Popup interface as a state machine:** initial setup, episode detection, MAL search
  with candidate selection, fallback to pasting a MAL URL/ID, episode number adjustment,
  and reading current progress before saving.
- **Mapping management:** list, open on MAL (**MAL ↗**), re-map, and delete.
- **Regression guard:** if MAL already records a higher number than the episode about to
  be saved, the extension warns and requires a second click before reducing progress.
- **MAL shortcut:** **MAL ↗** button on both the episode screen and the mappings screen
  opens the anime's page on MyAnimeList.
- **Documentation:** `README.md`.

### Notes

- The trigger is **manual** via the extension button — no keyboard shortcut.
- Scope limited to Crunchyroll; Jellyfin is covered by `jellyfin-ani-sync`.
- No automatic end-of-episode detection, no score/rewatch, no Chrome Web Store publishing
  (personal use, loaded unpacked).

[1.0.0]: https://github.com/marcelomogami/anime-watched/releases/tag/v1.0.0
[0.5.3]: https://github.com/marcelomogami/anime-watched/releases/tag/v0.5.3
[0.5.2]: https://github.com/marcelomogami/anime-watched/releases/tag/v0.5.2
[0.5.1]: https://github.com/marcelomogami/anime-watched/releases/tag/v0.5.1
[0.5.0]: https://github.com/marcelomogami/anime-watched/releases/tag/v0.5.0
[0.4.2]: https://github.com/marcelomogami/anime-watched/releases/tag/v0.4.2
[0.4.1]: https://github.com/marcelomogami/anime-watched/releases/tag/v0.4.1
[0.4.0]: https://github.com/marcelomogami/anime-watched/releases/tag/v0.4.0
[0.3.6]: https://github.com/marcelomogami/anime-watched/releases/tag/v0.3.6
[0.3.5]: https://github.com/marcelomogami/anime-watched/releases/tag/v0.3.5
[0.3.4]: https://github.com/marcelomogami/anime-watched/releases/tag/v0.3.4
[0.3.3]: https://github.com/marcelomogami/anime-watched/releases/tag/v0.3.3
[0.3.2]: https://github.com/marcelomogami/anime-watched/releases/tag/v0.3.2
[0.3.1]: https://github.com/marcelomogami/anime-watched/releases/tag/v0.3.1
[0.3.0]: https://github.com/marcelomogami/anime-watched/releases/tag/v0.3.0
[0.2.1]: https://github.com/marcelomogami/anime-watched/releases/tag/v0.2.1
[0.2.0]: https://github.com/marcelomogami/anime-watched/releases/tag/v0.2.0
[0.1.1]: https://github.com/marcelomogami/anime-watched/releases/tag/v0.1.1
[0.1.0]: https://github.com/marcelomogami/anime-watched/releases/tag/v0.1.0
