// background.js — service worker (module).
// Camada fina de orquestração: o popup dirige o fluxo e chama estas operações.
// Fala com o provider ativo (`store.getActiveProvider()`) via `providers/index.js`
// em vez de importar um backend fixo — ver docs/contexto-providers.md.

import { store } from './store.js';
import { providers, providerOrder } from './providers/index.js';

// Sources suportadas: cada uma tem seu content script de extração.
const SITES = [
  { test: /crunchyroll\.com/, file: 'src/sources/crunchyroll.js' },
  { test: /primevideo\.com/, file: 'src/sources/primevideo.js' },
];

async function activeProvider() {
  const providerId = await store.getActiveProvider();
  return providers[providerId];
}

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

function flattenSlice(provider, entry, slice) {
  return {
    animeId: slice.animeId,
    title: slice.title,
    numEpisodes: slice.numEpisodes || 0,
    picture: slice.picture || '',
    banner: slice.banner || '',
    url: provider.getDisplayUrl(slice.animeId),
    crSeriesTitle: entry.crSeriesTitle,
    site: entry.site,
    savedAt: entry.savedAt,
  };
}

// Acha a fatia do provider ativo numa entrada já carregada. Se ainda não
// existe mas outro provider da mesma entrada já tem vínculo, tenta resolver
// sozinho via cross-ref (hoje só AniList sabe fazer isso, por `idMal`) e
// persiste o resultado — evita remapear na mão quando os dois catálogos já
// concordam no vínculo. Ver docs/contexto-providers.md.
async function resolveSlice(mapKey, entry, provider) {
  const slice = entry.providers?.[provider.id];
  if (slice) return slice;

  if (provider.findByCrossRef) {
    for (const [otherId, otherSlice] of Object.entries(entry.providers || {})) {
      const found = await provider.findByCrossRef(otherId, otherSlice.animeId);
      if (found) {
        const resolved = {
          animeId: found.id,
          title: found.title,
          numEpisodes: found.numEpisodes || 0,
          picture: found.picture || '',
          banner: found.banner || '',
        };
        await store.setMappingProvider(mapKey, provider.id, resolved);
        return resolved;
      }
    }
  }

  return null;
}

// Lê o mapeamento salvo e devolve só a fatia do provider ativo, achatada com
// os metadados comuns da entrada + a URL de exibição já resolvida.
async function getFlatMapping(mapKey, provider) {
  const entry = await store.getMappingEntry(mapKey);
  if (!entry) return null;
  const slice = await resolveSlice(mapKey, entry, provider);
  return slice ? flattenSlice(provider, entry, slice) : null;
}

function withDisplayUrl(provider, candidate) {
  return { ...candidate, url: provider.getDisplayUrl(candidate.id) };
}

// Roteador de mensagens vindas do popup.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      const provider = await activeProvider();

      switch (msg?.type) {
        case 'GET_STATUS': {
          const auth = await provider.getAuthConfig();
          sendResponse({
            ok: true,
            loggedIn: await provider.isLoggedIn(),
            clientId: auth.clientId,
            clientSecret: auth.clientSecret || '',
            redirectUri: auth.redirectUri,
            providerId: provider.id,
            providerLabel: provider.label,
            needsClientSecret: provider.authFields?.clientSecret ?? true,
          });
          break;
        }

        case 'GET_PROVIDERS':
          sendResponse({
            ok: true,
            active: await store.getActiveProvider(),
            options: providerOrder.map((pid) => ({
              id: pid,
              label: providers[pid].label,
            })),
          });
          break;

        case 'SET_ACTIVE_PROVIDER':
          await store.setActiveProvider(msg.providerId);
          sendResponse({ ok: true });
          break;

        case 'SET_CLIENT_ID':
          await provider.setAuthConfig({ clientId: msg.clientId });
          sendResponse({ ok: true });
          break;

        case 'SET_CLIENT_SECRET':
          await provider.setAuthConfig({ clientSecret: msg.clientSecret });
          sendResponse({ ok: true });
          break;

        case 'LOGIN':
          await provider.login();
          sendResponse({ ok: true });
          break;

        case 'LOGOUT':
          await provider.logout();
          sendResponse({ ok: true });
          break;

        case 'GET_CURRENT_EPISODE':
          sendResponse(await getEpisodeFromActiveTab());
          break;

        case 'GET_MAPPING':
          sendResponse({
            ok: true,
            mapping: await getFlatMapping(msg.mapKey, provider),
          });
          break;

        case 'SEARCH': {
          const candidates = await provider.searchAnime(msg.query);
          sendResponse({ ok: true, candidates: candidates.map((c) => withDisplayUrl(provider, c)) });
          break;
        }

        case 'GET_ANIME': {
          const anime = await provider.getAnime(msg.animeId);
          sendResponse({ ok: true, anime: withDisplayUrl(provider, anime) });
          break;
        }

        case 'GET_LIST_STATUS':
          sendResponse({ ok: true, listStatus: await provider.getListStatus(msg.animeId) });
          break;

        case 'SAVE_MAPPING': {
          const { animeId, title, numEpisodes, picture, banner, ...common } = msg.value;
          await store.setMappingProvider(
            msg.mapKey,
            provider.id,
            {
              animeId,
              title,
              numEpisodes: numEpisodes || 0,
              picture: picture || '',
              banner: banner || '',
            },
            common,
          );
          sendResponse({ ok: true });
          break;
        }

        case 'REMOVE_MAPPING':
          await store.removeMapping(msg.mapKey);
          sendResponse({ ok: true });
          break;

        case 'GET_ALL_MAPPINGS': {
          const entries = await store.getAllMappingEntries();
          const mappings = {};
          for (const [key, entry] of Object.entries(entries)) {
            if (!entry) continue;
            const slice = await resolveSlice(key, entry, provider);
            if (!slice) continue;
            mappings[key] = flattenSlice(provider, entry, slice);
          }
          sendResponse({ ok: true, mappings });
          break;
        }

        case 'UPDATE_EPISODES':
          sendResponse({
            ok: true,
            result: await provider.updateEpisodes(
              msg.animeId,
              msg.num,
              msg.total || 0,
              msg.dates || {},
              msg.completed || false,
            ),
          });
          break;

        case 'PLAN_TO_WATCH':
          sendResponse({ ok: true, result: await provider.setPlanToWatch(msg.animeId) });
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
