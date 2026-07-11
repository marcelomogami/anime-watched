// mal.js — cliente da API do MyAnimeList (OAuth2 PKCE + list status)
// MAL só suporta code_challenge_method=plain, então code_challenge == code_verifier.

import { store } from './store.js';

const AUTH_URL = 'https://myanimelist.net/v1/oauth2/authorize';
const TOKEN_URL = 'https://myanimelist.net/v1/oauth2/token';
const API = 'https://api.myanimelist.net/v2';

// gera code_verifier PKCE (48–128 chars, conjunto unreserved). Usamos 96.
function genCodeVerifier() {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const bytes = new Uint8Array(96);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += chars[b % chars.length];
  return out;
}

function redirectUri() {
  // https://<extension-id>.chromiumapp.org/
  return chrome.identity.getRedirectURL();
}

// --- OAuth ---

export function getRedirectUri() {
  return redirectUri();
}

// Inicia o fluxo interativo de login. Requer clientId já salvo.
export async function login() {
  const clientId = await store.getClientId();
  if (!clientId) throw new Error('Client ID do MAL não configurado.');

  const codeVerifier = genCodeVerifier();
  const state = genCodeVerifier().slice(0, 24);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    code_challenge: codeVerifier, // plain: challenge == verifier
    code_challenge_method: 'plain',
    state,
    redirect_uri: redirectUri(),
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
  const returnedState = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  const err = url.searchParams.get('error');
  if (err) throw new Error(`Erro OAuth do MAL: ${err}`);
  if (!code) throw new Error('Nenhum code retornado pelo MAL.');
  if (returnedState !== state) throw new Error('State OAuth divergente.');

  await exchangeCode(clientId, code, codeVerifier);
  return true;
}

async function exchangeCode(clientId, code, codeVerifier) {
  const clientSecret = await store.getClientSecret();
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'authorization_code',
    code,
    code_verifier: codeVerifier,
    redirect_uri: redirectUri(),
  });
  if (clientSecret) body.set('client_secret', clientSecret);
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Falha ao trocar code por token (${res.status}): ${t}`);
  }
  const data = await res.json();
  await saveTokens(data);
}

async function refresh() {
  const clientId = await store.getClientId();
  const clientSecret = await store.getClientSecret();
  const tokens = await store.getTokens();
  if (!tokens?.refresh_token) throw new Error('Sem refresh_token; refaça o login.');
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
  });
  if (clientSecret) body.set('client_secret', clientSecret);
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const t = await res.text();
    await store.clearTokens();
    throw new Error(`Falha ao renovar token (${res.status}): ${t}`);
  }
  const data = await res.json();
  await saveTokens(data);
}

async function saveTokens(data) {
  const expiresAt = Date.now() + (data.expires_in || 2419200) * 1000 - 60000;
  await store.setTokens({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: expiresAt,
  });
}

async function getAccessToken() {
  const tokens = await store.getTokens();
  if (!tokens) throw new Error('NOT_LOGGED_IN');
  if (Date.now() >= tokens.expires_at) {
    await refresh();
    return (await store.getTokens()).access_token;
  }
  return tokens.access_token;
}

export async function isLoggedIn() {
  return !!(await store.getTokens());
}

export async function logout() {
  await store.clearTokens();
}

// --- chamadas autenticadas ---

async function authedFetch(url, options = {}, retry = true) {
  const token = await getAccessToken();
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });
  if (res.status === 401 && retry) {
    await refresh();
    return authedFetch(url, options, false);
  }
  return res;
}

const SEARCH_FIELDS =
  'alternative_titles,num_episodes,media_type,start_season,main_picture';

function nodeToCandidate(node) {
  return {
    id: node.id,
    title: node.title,
    en: node.alternative_titles?.en || '',
    numEpisodes: node.num_episodes || 0,
    mediaType: node.media_type || '',
    year: node.start_season?.year || '',
    picture: node.main_picture?.medium || node.main_picture?.large || '',
  };
}

// Busca anime por título. Retorna [{ id, title, en, numEpisodes, mediaType, year, picture }]
export async function searchAnime(query, limit = 10) {
  const params = new URLSearchParams({
    q: query.slice(0, 100),
    limit: String(limit),
    fields: SEARCH_FIELDS,
  });
  const res = await authedFetch(`${API}/anime?${params.toString()}`);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Busca no MAL falhou (${res.status}): ${t}`);
  }
  const data = await res.json();
  return (data.data || []).map((d) => nodeToCandidate(d.node));
}

// Busca 1 anime por id (usado ao colar URL/ID do MAL manualmente).
export async function getAnime(animeId) {
  const params = new URLSearchParams({ fields: SEARCH_FIELDS });
  const res = await authedFetch(`${API}/anime/${animeId}?${params.toString()}`);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Anime ${animeId} não encontrado no MAL (${res.status}): ${t}`);
  }
  return nodeToCandidate(await res.json());
}

// Progresso atual do anime na lista do usuário (pra mostrar antes de gravar).
// Retorna { numWatched, status, numEpisodes } ou { numWatched: 0 } se não está na lista.
export async function getListStatus(animeId) {
  const params = new URLSearchParams({ fields: 'my_list_status,num_episodes' });
  const res = await authedFetch(`${API}/anime/${animeId}?${params.toString()}`);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Falha ao ler progresso (${res.status}): ${t}`);
  }
  const data = await res.json();
  const ls = data.my_list_status || null;
  return {
    numWatched: ls?.num_episodes_watched ?? 0,
    status: ls?.status || null,
    inList: !!ls,
    numEpisodes: data.num_episodes || 0,
  };
}

// Extrai o anime_id de uma URL do MAL ou de um id numérico colado.
// Aceita: "https://myanimelist.net/anime/12345/Slug", "myanimelist.net/anime/12345", "12345"
export function parseMalId(input) {
  const s = (input || '').trim();
  if (/^\d+$/.test(s)) return Number(s);
  const m = s.match(/anime\/(\d+)/);
  return m ? Number(m[1]) : null;
}

// Atualiza num_watched_episodes de um anime. numEpisodes = episódio dentro da temporada.
// Marca como "completed" se atingiu o total conhecido, senão "watching".
export async function updateEpisodes(animeId, numEpisodes, totalEpisodes = 0) {
  const status =
    totalEpisodes > 0 && numEpisodes >= totalEpisodes ? 'completed' : 'watching';
  const body = new URLSearchParams({
    num_watched_episodes: String(numEpisodes),
    status,
  });
  const res = await authedFetch(
    `${API}/anime/${animeId}/my_list_status`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    },
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Falha ao gravar no MAL (${res.status}): ${t}`);
  }
  return res.json();
}
