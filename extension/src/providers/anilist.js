// providers/anilist.js — AniList (OAuth2 Implicit Grant + GraphQL). Único
// backend de tracking desde o v1.0.0 (MAL saiu completamente, ver
// docs/1.0.0/contexto.md) — o nome do arquivo/módulo ficou "providers/" por
// história, não porque ainda existe escolha de provider.
//
// AniList não suporta refresh token em nenhum dos dois grants (implicit ou
// authorization code) — o token dura ~1 ano e depois exige relogin. Como não
// há ganho real de segurança em manter um client_secret que nunca é usado
// (a extensão não tem backend pra guardá-lo), usamos o Implicit Grant: mais
// simples (sem troca de code por token, sem client_secret) com a mesma
// limitação de durabilidade do Authorization Code Grant.
// Fluxo confirmado em https://docs.anilist.co/guide/auth/implicit e
// schema confirmado por introspecção direta em https://graphql.anilist.co
// (ver docs/0.5.3/contexto-providers.md e docs/1.0.0/design.md).

import { store } from '../store.js';

const PROVIDER_ID = 'anilist';

const AUTH_URL = 'https://anilist.co/api/v2/oauth/authorize';
const API = 'https://graphql.anilist.co';

function redirectUri() {
  return chrome.identity.getRedirectURL();
}

// --- auth ---

export async function getAuthConfig() {
  return {
    clientId: await store.getClientId(PROVIDER_ID),
    redirectUri: redirectUri(),
  };
}

export async function setAuthConfig({ clientId } = {}) {
  if (clientId !== undefined) await store.setClientId(PROVIDER_ID, clientId);
}

// Decodifica o campo `exp` (segundos, epoch) do JWT sem depender de lib —
// usado como validação cruzada do `expires_in` retornado pelo fragment.
function jwtExpiryMs(token) {
  try {
    const payload = token.split('.')[1];
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return json.exp ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

// Inicia o fluxo interativo de login (Implicit Grant — token direto no
// fragment da URL de redirect, sem troca de code por token).
export async function login() {
  const clientId = await store.getClientId(PROVIDER_ID);
  if (!clientId) throw new Error('Client ID do AniList não configurado.');

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'token',
  });
  const authUrl = `${AUTH_URL}?${params.toString()}`;

  const redirect = await new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      { url: authUrl, interactive: true },
      (responseUrl) => {
        if (chrome.runtime.lastError || !responseUrl) {
          reject(
            new Error(
              chrome.runtime.lastError?.message || 'Login cancelado.',
            ),
          );
        } else {
          resolve(responseUrl);
        }
      },
    );
  });

  const url = new URL(redirect);
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
  const accessToken = fragment.get('access_token');
  const err = fragment.get('error');
  if (err) throw new Error(`Erro OAuth do AniList: ${err}`);
  if (!accessToken) throw new Error('Nenhum access_token retornado pelo AniList.');

  const expiresIn = Number(fragment.get('expires_in')) || 31536000; // ~1 ano, fallback
  const expiresAt =
    jwtExpiryMs(accessToken) || Date.now() + expiresIn * 1000 - 60000;

  await store.setTokens(PROVIDER_ID, {
    access_token: accessToken,
    expires_at: expiresAt,
  });
  return true;
}

async function getAccessToken() {
  const tokens = await store.getTokens(PROVIDER_ID);
  if (!tokens) throw new Error('NOT_LOGGED_IN');
  if (Date.now() >= tokens.expires_at) {
    await store.clearTokens(PROVIDER_ID);
    throw new Error('Sessão do AniList expirada. Faça login de novo.');
  }
  return tokens.access_token;
}

export async function isLoggedIn() {
  const tokens = await store.getTokens(PROVIDER_ID);
  if (!tokens) return false;
  if (Date.now() >= tokens.expires_at) {
    await store.clearTokens(PROVIDER_ID);
    return false;
  }
  return true;
}

export async function logout() {
  await store.clearTokens(PROVIDER_ID);
}

// --- GraphQL ---

async function gqlFetch(query, variables) {
  const token = await getAccessToken();
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (!res.ok || body.errors) {
    const msg = body.errors?.[0]?.message || `AniList request falhou (${res.status})`;
    throw new Error(msg);
  }
  return body;
}

// --- busca (estado 1) ---

const MEDIA_FIELDS = `
  id
  idMal
  title { romaji english }
  episodes
  format
  seasonYear
  coverImage { medium large }
  bannerImage
`;

function nodeToCandidate(node) {
  return {
    id: node.id,
    title: node.title?.romaji || node.title?.english || '',
    en: node.title?.english || '',
    numEpisodes: node.episodes || 0,
    mediaType: node.format || '',
    year: node.seasonYear || '',
    picture: node.coverImage?.large || node.coverImage?.medium || '',
    banner: node.bannerImage || '',
  };
}

export async function searchAnime(query, limit = 10) {
  const gql = `
    query ($search: String, $perPage: Int) {
      Page(page: 1, perPage: $perPage) {
        media(search: $search, type: ANIME) { ${MEDIA_FIELDS} }
      }
    }
  `;
  const res = await gqlFetch(gql, { search: query.slice(0, 100), perPage: limit });
  return (res.data.Page.media || []).map(nodeToCandidate);
}

export async function getAnime(animeId) {
  const gql = `query ($id: Int) { Media(id: $id, type: ANIME) { ${MEDIA_FIELDS} } }`;
  const res = await gqlFetch(gql, { id: Number(animeId) });
  if (!res.data.Media) throw new Error(`Anime ${animeId} não encontrado no AniList.`);
  return nodeToCandidate(res.data.Media);
}

// --- lista completa (cache) — ver docs/1.0.0/design.md ---

// Campos do `Media` usados pra montar cada entrada do cache local — mesmo
// shape em `getListCache()` e `saveEntry()` (a mutation devolve `media`
// nesse formato também, confirmado por introspecção: `SaveMediaListEntry`
// retorna `MediaList`, e `MediaList.media` resolve pro `Media` de verdade —
// dá pra montar/atualizar o cache com a resposta da própria mutation, sem
// uma segunda busca).
const LIST_ENTRY_MEDIA_FIELDS = `
  id
  title { romaji english }
  synonyms
  bannerImage
  coverImage { medium large }
  episodes
  siteUrl
  externalLinks { site url type }
  nextAiringEpisode { episode airingAt timeUntilAiring }
`;

function strToFuzzyDate(s) {
  if (!s) return undefined;
  const [year, month, day] = s.split('-').map(Number);
  return { year, month, day };
}

// Campos da entrada em si (não do anime) — `startedAt`/`completedAt` aqui
// pra dar pro popup decidir se já tem data (não sobrescrever, mesma regra
// da v0.1.1 — ver `computeAutoDates` em popup.js) sem precisar de uma
// segunda busca.
const LIST_ENTRY_FIELDS = `
  id
  status
  progress
  updatedAt
  startedAt { year month day }
  completedAt { year month day }
  media { ${LIST_ENTRY_MEDIA_FIELDS} }
`;

async function getViewerId() {
  const cached = await store.getViewerId(PROVIDER_ID);
  if (cached) return cached;
  const res = await gqlFetch('query { Viewer { id } }');
  const viewerId = res.data.Viewer?.id;
  if (!viewerId) {
    throw new Error('Não foi possível identificar o usuário autenticado no AniList.');
  }
  await store.setViewerId(PROVIDER_ID, viewerId);
  return viewerId;
}

// Busca a MediaListCollection inteira do usuário logado — todos os 6
// status (não só Watching/Planning, necessário pra detectar
// COMPLETED/DROPPED/PAUSED/REPEATING nos estados 3 e 4 do popup, ver
// docs/1.0.0/visao.md). A API pagina de verdade (`chunk`/`perChunk`, máximo
// 500 por chunk; o retorno tem `hasNextChunk`) — confirmado ao vivo, de
// dentro da extensão de verdade (Fase 2, via `chrome.storage`/token real):
// a lista real do usuário tem 506 entradas, bate o limite de uma chunk e
// precisa da segunda; o loop terminou certo (`hasNextChunk` virou `false`
// na 2ª chunk).
export async function getListCache() {
  const gql = `
    query ($userId: Int, $chunk: Int) {
      MediaListCollection(userId: $userId, type: ANIME, chunk: $chunk, perChunk: 500) {
        hasNextChunk
        lists {
          entries { ${LIST_ENTRY_FIELDS} }
        }
      }
    }
  `;
  const userId = await getViewerId();
  const entries = [];
  let chunk = 1;
  let hasNext = true;
  while (hasNext) {
    const res = await gqlFetch(gql, { userId, chunk });
    const collection = res.data.MediaListCollection;
    for (const list of collection.lists) entries.push(...list.entries);
    hasNext = !!collection.hasNextChunk;
    chunk += 1;
  }
  return entries;
}

// Grava/atualiza uma entrada da lista — cobre adicionar (busca, estado 1),
// gravar progresso (estado 4), Plan to watch/Dropar/Pausar/trocar status
// (tela de detalhes, estado 3). Um wrapper só pra tudo. Sempre usa
// `mediaId` (não `id` da entrada) — `SaveMediaListEntry` faz upsert por
// `mediaId` (confirmado contra o comportamento real do MALSync em sessão
// anterior deste projeto — ver AGENTS.md — salvar sem `id` atualiza a
// entrada existente em vez de duplicar), então não precisa saber se o anime
// já tem entrada ou não antes de chamar. Pede `media { ... }` na resposta
// pra dar pra atualizar o cache local direto, sem segunda busca (ver
// `store.patchListCacheEntry`). `startDate`/`finishDate` são strings
// "YYYY-MM-DD" (ou undefined) — mesma regra da v0.1.1 pra quando
// preenchê-las mora em popup.js (`computeAutoDates`), aqui só converte pro
// `FuzzyDateInput` do AniList.
export async function saveEntry({ mediaId, status, progress, startDate, finishDate }) {
  const gql = `
    mutation ($mediaId: Int, $status: MediaListStatus, $progress: Int, $startedAt: FuzzyDateInput, $completedAt: FuzzyDateInput) {
      SaveMediaListEntry(mediaId: $mediaId, status: $status, progress: $progress, startedAt: $startedAt, completedAt: $completedAt) {
        ${LIST_ENTRY_FIELDS}
      }
    }
  `;
  const res = await gqlFetch(gql, {
    mediaId: Number(mediaId),
    status,
    progress,
    startedAt: strToFuzzyDate(startDate),
    completedAt: strToFuzzyDate(finishDate),
  });
  return res.data.SaveMediaListEntry;
}

export const id = PROVIDER_ID;
export const label = 'AniList';
