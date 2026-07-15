// providers/anilist.js — provider AniList (OAuth2 Implicit Grant + GraphQL).
// AniList não suporta refresh token em nenhum dos dois grants (implicit ou
// authorization code) — o token dura ~1 ano e depois exige relogin. Como não
// há ganho real de segurança em manter um client_secret que nunca é usado
// (a extensão não tem backend pra guardá-lo), usamos o Implicit Grant: mais
// simples (sem troca de code por token, sem client_secret) com a mesma
// limitação de durabilidade do Authorization Code Grant.
// Fluxo confirmado em https://docs.anilist.co/guide/auth/implicit e
// schema confirmado por introspecção direta em https://graphql.anilist.co
// (ver docs/contexto-providers.md).

import { store } from '../store.js';
import { parseAnimeId } from './shared.js';

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

// Tenta achar o equivalente no AniList a partir do id de outro provider, pra
// evitar remapear na mão quando os dois catálogos já concordam no vínculo
// (ver docs/contexto-providers.md, "Bônus possível"). Hoje só sabe cruzar com
// o MAL, via `idMal` — não existe um `idAnilist` do lado do MAL pro caminho
// inverso. Retorna null (sem lançar) quando não encontra, já que "não achou
// cross-ref" é um resultado esperado, não uma falha.
export async function findByCrossRef(otherProviderId, otherAnimeId) {
  if (otherProviderId !== 'mal') return null;
  const gql = `query ($idMal: Int) { Media(idMal: $idMal, type: ANIME) { ${MEDIA_FIELDS} } }`;
  try {
    const res = await gqlFetch(gql, { idMal: Number(otherAnimeId) });
    return res.data.Media ? nodeToCandidate(res.data.Media) : null;
  } catch {
    return null;
  }
}

export function parseId(input) {
  return parseAnimeId(input);
}

export function getDisplayUrl(animeId) {
  return `https://anilist.co/anime/${animeId}`;
}

// MediaListStatus (AniList, maiúsculo) <-> vocabulário genérico já usado
// pelo resto da extensão (minúsculo, herdado do MAL) — ver
// docs/contexto-providers.md sobre por que os providers normalizam pro
// mesmo shape.
const STATUS_TO_GENERIC = {
  CURRENT: 'watching',
  COMPLETED: 'completed',
  PLANNING: 'plan_to_watch',
  DROPPED: 'dropped',
  PAUSED: 'on_hold',
  REPEATING: 'watching',
};

function fuzzyDateToStr(d) {
  if (!d || !d.year) return '';
  const mm = String(d.month || 1).padStart(2, '0');
  const dd = String(d.day || 1).padStart(2, '0');
  return `${d.year}-${mm}-${dd}`;
}

function strToFuzzyDate(s) {
  if (!s) return undefined;
  const [year, month, day] = s.split('-').map(Number);
  return { year, month, day };
}

export async function getListStatus(animeId) {
  const gql = `
    query ($id: Int) {
      Media(id: $id, type: ANIME) {
        episodes
        mediaListEntry {
          progress
          status
          startedAt { year month day }
          completedAt { year month day }
        }
      }
    }
  `;
  const res = await gqlFetch(gql, { id: Number(animeId) });
  const media = res.data.Media;
  const entry = media?.mediaListEntry || null;
  return {
    numWatched: entry?.progress ?? 0,
    status: entry ? STATUS_TO_GENERIC[entry.status] || null : null,
    inList: !!entry,
    numEpisodes: media?.episodes || 0,
    startDate: fuzzyDateToStr(entry?.startedAt),
    finishDate: fuzzyDateToStr(entry?.completedAt),
  };
}

export async function updateEpisodes(
  animeId,
  numEpisodes,
  totalEpisodes = 0,
  dates = {},
  completed = false,
) {
  const status =
    completed || (totalEpisodes > 0 && numEpisodes >= totalEpisodes)
      ? 'COMPLETED'
      : 'CURRENT';
  const gql = `
    mutation ($mediaId: Int, $progress: Int, $status: MediaListStatus, $startedAt: FuzzyDateInput, $completedAt: FuzzyDateInput) {
      SaveMediaListEntry(mediaId: $mediaId, progress: $progress, status: $status, startedAt: $startedAt, completedAt: $completedAt) {
        id
        status
        progress
      }
    }
  `;
  return (
    await gqlFetch(gql, {
      mediaId: Number(animeId),
      progress: numEpisodes,
      status,
      startedAt: strToFuzzyDate(dates.start_date),
      completedAt: strToFuzzyDate(dates.finish_date),
    })
  ).data.SaveMediaListEntry;
}

// Marca como "PLANNING" (plan to watch), sem progresso e sem datas.
export async function setPlanToWatch(animeId) {
  const gql = `
    mutation ($mediaId: Int) {
      SaveMediaListEntry(mediaId: $mediaId, status: PLANNING, progress: 0) {
        id
        status
      }
    }
  `;
  return (await gqlFetch(gql, { mediaId: Number(animeId) })).data.SaveMediaListEntry;
}

export const id = PROVIDER_ID;
export const label = 'AniList';
// Implicit Grant não usa client_secret — a UI de setup esconde o campo.
export const authFields = { clientSecret: false };
