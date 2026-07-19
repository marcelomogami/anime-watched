// background.js — service worker (module).
// Camada fina de orquestração: o popup dirige o fluxo, chamando as
// operações abaixo. AniList é o único backend desde o v1.0.0 (ver
// docs/1.0.0/contexto.md) — sem mais indireção de "provider ativo".

import { store } from './store.js';
import * as anilist from './providers/anilist.js';

// Sources suportadas: cada uma tem seu content script de extração.
const SITES = [
  { test: /crunchyroll\.com/, file: 'src/sources/crunchyroll.js' },
  { test: /primevideo\.com/, file: 'src/sources/primevideo.js' },
];

// Lê o episódio atual da aba ativa, injetando o content script certo se preciso.
async function getEpisodeFromActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const site = SITES.find((s) => s.test.test(tab?.url || ''));
  if (!tab || !site) {
    return { ok: false, error: 'NOT_SUPPORTED_SITE' };
  }
  const send = () =>
    new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tab.id, { type: 'GET_EPISODE' }, (resp) => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(resp);
      });
    });

  let resp;
  try {
    resp = await send();
  } catch {
    // content script ainda não injetado (extensão recém-carregada): injeta e tenta de novo
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: [site.file],
      });
      resp = await send();
    } catch (e) {
      return { ok: false, error: 'INJECT_FAILED' };
    }
  }
  return resp || { ok: false, error: 'NO_RESPONSE' };
}

// --- resolução de estado do popup (docs/1.0.0/design.md § "UI — a máquina
// de estados por aba") ---
async function resolveState() {
  const episode = await getEpisodeFromActiveTab();
  if (!episode.ok) {
    return { ok: true, state: 2 }; // nenhuma página relevante → painel
  }

  const { data } = episode;
  const sourceId = data.site === 'cr' ? data.crSeriesId : data.pvDetailId;
  if (!sourceId) {
    return { ok: true, state: 2 };
  }

  const entry = await store.resolveEntryForSource({
    site: data.site,
    sourceId,
    seriesTitle: data.seriesTitle,
  });

  if (entry) {
    return data.episodeNumber != null
      ? { ok: true, state: 4, entry, source: data } // episódio, já reconhecido
      : { ok: true, state: 3, entry, source: data }; // tela de detalhes
  }

  // Estado 1 (busca) — `source` carrega se veio de episódio (grava
  // CURRENT+progresso direto ao escolher) ou da página do anime (PLANNING),
  // ver docs/1.0.0/visao.md § "Como o popup funciona".
  return { ok: true, state: 1, source: data };
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// Re-sync completo: busca a MediaListCollection inteira de novo e substitui
// o cache local (atualiza `fetchedAt`) — docs/1.0.0/design.md § "Cache
// local". Usado pelo botão manual e pelo gatilho automático de 7 dias.
async function resyncList() {
  const entries = await anilist.getListCache();
  await store.setListCache(entries);
  return store.getListCache();
}

function toPanelShape(cache) {
  return {
    ok: true,
    fetchedAt: cache.fetchedAt,
    watching: cache.entries.filter((e) => e.status === 'CURRENT'),
    planning: cache.entries.filter((e) => e.status === 'PLANNING'),
  };
}

// Estado 2 (painel de lista): lê o cache local, separado em Watching/
// Planning — o cache guarda todos os 6 status (necessário pros estados
// 3/4), o painel só mostra essas duas. Re-sync automático (mesmo mecanismo
// do botão manual, ver `resyncList()`) se o cache ainda não existe (primeiro
// uso) ou se passou de 7 dias desde o último — `fetchedAt` só é tocado por
// um re-sync completo, nunca por um save otimista de uma entrada só.
async function getPanelEntries() {
  let cache = await store.getListCache();
  if (!cache || Date.now() - cache.fetchedAt > SEVEN_DAYS_MS) {
    cache = await resyncList();
  }
  return toPanelShape(cache);
}

// Grava/atualiza uma entrada (Gravar/Plan to watch/Dropar/Pausar — estados 3
// e 4) e já atualiza o cache local com a própria resposta da mutation, sem
// segunda busca (docs/1.0.0/design.md § "Adicionar/atualizar entrada no
// cache local, numa chamada só").
async function saveEntry({ mediaId, status, progress, startDate, finishDate }) {
  const result = await anilist.saveEntry({ mediaId, status, progress, startDate, finishDate });
  await store.patchListCacheEntry(result);
  return { ok: true, entry: result };
}

// Roteador de mensagens vindas do popup.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg?.type) {
        case 'GET_STATUS': {
          const auth = await anilist.getAuthConfig();
          sendResponse({
            ok: true,
            loggedIn: await anilist.isLoggedIn(),
            clientId: auth.clientId,
            redirectUri: auth.redirectUri,
          });
          break;
        }

        case 'SET_CLIENT_ID':
          await anilist.setAuthConfig({ clientId: msg.clientId });
          sendResponse({ ok: true });
          break;

        case 'LOGIN':
          await anilist.login();
          sendResponse({ ok: true });
          break;

        case 'LOGOUT':
          await anilist.logout();
          sendResponse({ ok: true });
          break;

        case 'GET_STATE':
          sendResponse(await resolveState());
          break;

        case 'GET_PANEL_ENTRIES':
          sendResponse(await getPanelEntries());
          break;

        case 'RESYNC_LIST':
          sendResponse(toPanelShape(await resyncList()));
          break;

        case 'SAVE_ENTRY':
          sendResponse(
            await saveEntry({
              mediaId: msg.mediaId,
              status: msg.status,
              progress: msg.progress,
              startDate: msg.startDate,
              finishDate: msg.finishDate,
            }),
          );
          break;

        // Busca (estado 1) — direto no AniList.
        case 'SEARCH_ANIME':
          sendResponse({ ok: true, candidates: await anilist.searchAnime(msg.query) });
          break;

        case 'GET_ANIME_BY_ID':
          sendResponse({ ok: true, anime: await anilist.getAnime(msg.animeId) });
          break;

        default:
          sendResponse({ ok: false, error: 'unknown message' });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message || String(e) });
    }
  })();
  return true; // resposta assíncrona
});
