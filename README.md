# Anime Watched

*[Leia isso em português](README.pt-BR.md)*

Chrome extension (Manifest V3) that logs, with one click, the episode you just watched on
**Crunchyroll** or **Prime Video** to your **MyAnimeList (MAL)** list.

No server, no backend: OAuth, MAL calls, and the mapping table all live inside the
extension (`chrome.storage`).

Interface available in **pt-BR** and **en** (Chrome picks based on the browser's
language).

## Screenshots

| Episode detected → save | Search/pick on MAL | Manage mappings |
|---|---|---|
| ![Popup with a detected episode and an already-mapped anime](docs/screenshots/popup-main-en.png) | ![Popup with MAL search results](docs/screenshots/popup-search-en.png) | ![Saved mappings management screen](docs/screenshots/popup-mappings-en.png) |

## How it works

1. **Crunchyroll:** on an episode page (`/watch/...`), the extension reads the series,
   season, and episode number from the page's JSON-LD. On the series page
   (`/series/{id}/...`) — no episode open — it reads the series ID from the URL and the
   season from the page's own season selector (`docs/cr-extraction.md`).
   **Prime Video:** with the player open, the extension reads series/season/episode
   straight from the player's DOM overlay. On the detail page (`/detail/{id}`) — no player
   open — it reads season and title from the page's metadata; the detail ID itself is
   already season-specific (`docs/pv-extraction.md`).
2. Click the extension icon → the popup shows what it detected.
3. The **first time** for each season, you match it to the right anime on MAL (automatic
   search by title, or paste the MAL URL/ID).
4. From there, two options:
   - **Save** — `PATCH`es `num_watched_episodes` on MAL (and **Finish** to close out the
     season).
   - **Plan to watch** — saves the mapping without recording any progress. If the anime
     isn't in any MAL list yet, this also sets its status to `plan_to_watch` there (0
     episodes); if it's already in a list, only the local mapping is saved — existing
     progress is never touched. Useful for bookmarking something you haven't started yet,
     straight from the anime's own page — without Crunchyroll or Prime Video recording the
     episode as "opened".

Mappings are stored per **season**: on Crunchyroll, `crSeriesId#SseasonNumber` (e.g.,
`GT00371630#S1`); on Prime Video, `pv:<detailId>` (e.g., `pv:0GZCWV7IOJ8M9624JD5A4HA66B`)
— each season already has its own `detail/<ID>` there. Either way this handles the common
case of a season being a separate MAL entry.

## Installation (unpacked)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top-right corner).
3. **Load unpacked** → select this repo's `extension/` folder.
4. The extension shows up in the toolbar. Pin the icon if you'd like.

> The extension ID (and therefore the Redirect URI) stays stable as long as the folder
> doesn't move. If you move the folder, the ID changes and the MAL app needs the new
> Redirect URI.

## Registering the app on MyAnimeList

1. Open the extension popup and copy the **Redirect URI** shown
   (`https://<extension-id>.chromiumapp.org/`).
2. Go to [myanimelist.net/apiconfig](https://myanimelist.net/apiconfig) → **Create ID**.
3. Fill in:
   - **App Type:** `web` — generates a **Client ID** and **Client Secret** (MAL requires
     the secret when exchanging the token). Choosing `other` makes it a public client with
     no secret.
   - **App Redirect URL:** paste the Redirect URI from step 1
   - **App Description:** minimum 50 characters, no special characters
   - Other required fields (name, homepage, etc.): up to you
4. Save and copy the **Client ID** (and **Client Secret**, if it's a `web` app).
5. In the extension popup: paste the **Client ID** and **Client Secret** → **Save
   credentials** → **Log in to MAL** and authorize.

Login uses OAuth2 with PKCE (`plain` method, a MAL requirement). The Client Secret (when
present) is typed by you and stays only in your machine's `chrome.storage.local` — it's
never embedded in the code or committed.

## Usage

- **Crunchyroll:** open an episode (`/watch/...`) — or just the series page
  (`/series/...`), if you only want to bookmark it — and click the extension icon.
- **Prime Video:** press play on the episode, or just open the anime's detail page
  (`/detail/...`) without playing anything, and click the extension icon.
- **New season:** search/pick the anime on MAL (or paste the URL/ID), then either:
  - adjust the episode number and click **Save** (or **Finish** to close out the season),
    or
  - click **Plan to watch** to bookmark it without recording any progress.
- **Season already mapped:** the popup shows the MAL target and your current progress;
  adjust the number if you want and click **Save**.
- **View mappings:** lists everything mapped so far, with a button that opens the anime's
  page on the source platform (**CR ↗** / **PV ↗**, colored by platform), plus the options
  to open it on MAL (**MAL ↗**), **re-map**, or **delete**.
- **MAL ↗:** on both the episode screen and the mappings screen, opens the anime's page on
  MyAnimeList in a new tab.

### Behavior details

- **Won't regress on its own:** if MAL already shows a higher number than the episode
  you're about to save, the extension warns you and requires a second click before
  reducing it.
- **Episode adjustment:** Crunchyroll's numbering doesn't always match MAL's (e.g., a cour
  with absolute numbering) — that's why the number is editable before saving.
- **`status`:** becomes `completed` once the episode reaches MAL's known total; otherwise
  it stays `watching`.
- **Automatic start date:** when saving, if MAL's progress is at **0** (and the start date
  is empty), sets the start date to **today**. The trigger is zeroed progress, not episode
  number — so it works even when Crunchyroll uses sequential numbering that differs from
  MAL's (e.g., `E25` on CR = `S2E1` on MAL).
- **Automatic finish date:** when the season is completed (number ≥ MAL's total, with an
  empty finish date), sets the finish date to **today**.
- **"Finish" button:** explicitly marks `completed` + finish date = **today**, useful when
  MAL doesn't know the total (simulcast/ongoing season). Adjusts progress to the total
  when it's known.
- **Never overwrites dates:** start and finish dates are only filled in when empty; an
  existing date on MAL is preserved.
- **"Plan to watch" never overwrites progress:** it only sets the `plan_to_watch` status on
  MAL if the anime isn't in any list yet. If it's already `watching`, `completed`, etc.,
  clicking it just saves the local mapping — your MAL status/progress stays untouched.
- **No local progress tracking:** the extension doesn't keep a local copy of "episodes
  watched" — that number always lives on MAL and is read live from there when you open the
  popup for an already-mapped anime. What's stored locally (`chrome.storage`) is only the
  Crunchyroll/Prime Video ↔ MAL mapping itself.

## Structure

```
extension/
  manifest.json
  _locales/
    pt_BR/messages.json  # UI strings (default language)
    en/messages.json     # UI strings (English)
  src/
    background.js   # orchestration: detects the site, reads the tab's episode, calls MAL, stores the map
    content.js      # runs on Crunchyroll: extracts series/season/episode from the JSON-LD
    content-pv.js   # runs on Prime Video: extracts series/season/episode from the player overlay
    mal.js          # MAL API client (OAuth PKCE, search, save progress)
    store.js        # chrome.storage wrapper (config, tokens, mapping table)
    popup.html/js   # the interface (state machine), strings via chrome.i18n
  icons/
docs/
  contexto.md                        # context and implementation plan (pt-BR)
  contexto-mapeamento-sem-gravar.md  # design notes for "Plan to watch" (pt-BR)
  cr-extraction.md  # investigation of Crunchyroll's episode/series pages (extraction source)
  pv-extraction.md  # investigation of the Prime Video player/detail page (extraction source)
```

## Current scope

Crunchyroll and Prime Video (for Jellyfin, the `jellyfin-ani-sync` plugin already covers
it). No automatic end-of-episode detection, no score/rewatch, no Chrome Web Store
publishing — personal use, loaded unpacked.
