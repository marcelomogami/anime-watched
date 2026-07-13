// background.js — service worker (module).
// Camada fina de orquestração: o popup dirige o fluxo e chama estas operações.

import { store } from './store.js';
import {
  login,
  logout,
  isLoggedIn,
  searchAnime,
  getAnime,
  getListStatus,
  updateEpisodes,
  setPlanToWatch,
  getRedirectUri,
} from './mal.js';

// Sites suportados: cada um tem seu content script de extração.
const SITES = [
  { test: /crunchyroll\.com/, file: 'src/content.js' },
  { test: /primevideo\.com/, file: 'src/content-pv.js' },
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

// Roteador de mensagens vindas do popup.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg?.type) {
        case 'GET_STATUS':
          sendResponse({
            ok: true,
            loggedIn: await isLoggedIn(),
            clientId: await store.getClientId(),
            clientSecret: await store.getClientSecret(),
            redirectUri: getRedirectUri(),
          });
          break;

        case 'SET_CLIENT_ID':
          await store.setClientId(msg.clientId);
          sendResponse({ ok: true });
          break;

        case 'SET_CLIENT_SECRET':
          await store.setClientSecret(msg.clientSecret);
          sendResponse({ ok: true });
          break;

        case 'LOGIN':
          await login();
          sendResponse({ ok: true });
          break;

        case 'LOGOUT':
          await logout();
          sendResponse({ ok: true });
          break;

        case 'GET_CURRENT_EPISODE':
          sendResponse(await getEpisodeFromActiveTab());
          break;

        case 'GET_MAPPING':
          sendResponse({ ok: true, mapping: await store.getMapping(msg.mapKey) });
          break;

        case 'SEARCH':
          sendResponse({ ok: true, candidates: await searchAnime(msg.query) });
          break;

        case 'GET_ANIME':
          sendResponse({ ok: true, anime: await getAnime(msg.animeId) });
          break;

        case 'GET_LIST_STATUS':
          sendResponse({ ok: true, listStatus: await getListStatus(msg.animeId) });
          break;

        case 'SAVE_MAPPING':
          await store.setMapping(msg.mapKey, msg.value);
          sendResponse({ ok: true });
          break;

        case 'REMOVE_MAPPING':
          await store.removeMapping(msg.mapKey);
          sendResponse({ ok: true });
          break;

        case 'GET_ALL_MAPPINGS':
          sendResponse({ ok: true, mappings: await store.getAllMappings() });
          break;

        case 'UPDATE_EPISODES':
          sendResponse({
            ok: true,
            result: await updateEpisodes(
              msg.animeId,
              msg.num,
              msg.total || 0,
              msg.dates || {},
              msg.completed || false,
            ),
          });
          break;

        case 'PLAN_TO_WATCH':
          sendResponse({ ok: true, result: await setPlanToWatch(msg.animeId) });
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
