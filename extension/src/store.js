// store.js — wrapper de chrome.storage
// - config (clientId) e tokens do MAL: chrome.storage.local
// - mapa CR→MAL: chrome.storage.sync (sincroniza entre máquinas), fallback local

const LOCAL_KEYS = {
  clientId: 'mal_client_id',
  clientSecret: 'mal_client_secret', // opcional (apps tipo "web" do MAL)
  tokens: 'mal_tokens', // { access_token, refresh_token, expires_at }
};

const MAP_PREFIX = 'map:'; // chave: "map:GT00371630#S1"

function localGet(key) {
  return new Promise((resolve) =>
    chrome.storage.local.get(key, (r) => resolve(r[key])),
  );
}
function localSet(obj) {
  return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
}
function localRemove(key) {
  return new Promise((resolve) => chrome.storage.local.remove(key, resolve));
}

// storage.sync com fallback para local se indisponível/quota
function syncArea() {
  return chrome.storage.sync || chrome.storage.local;
}
function syncGet(key) {
  return new Promise((resolve) =>
    syncArea().get(key, (r) => resolve(r[key])),
  );
}
function syncSet(obj) {
  return new Promise((resolve, reject) =>
    syncArea().set(obj, () => {
      if (chrome.runtime.lastError) {
        // fallback pro local se sync falhar (ex.: quota, sync desativado)
        chrome.storage.local.set(obj, resolve);
      } else {
        resolve();
      }
    }),
  );
}

export const store = {
  // --- config ---
  async getClientId() {
    return (await localGet(LOCAL_KEYS.clientId)) || '';
  },
  async setClientId(id) {
    return localSet({ [LOCAL_KEYS.clientId]: (id || '').trim() });
  },
  async getClientSecret() {
    return (await localGet(LOCAL_KEYS.clientSecret)) || '';
  },
  async setClientSecret(secret) {
    return localSet({ [LOCAL_KEYS.clientSecret]: (secret || '').trim() });
  },

  // --- tokens ---
  async getTokens() {
    return (await localGet(LOCAL_KEYS.tokens)) || null;
  },
  async setTokens(tokens) {
    return localSet({ [LOCAL_KEYS.tokens]: tokens });
  },
  async clearTokens() {
    return localRemove(LOCAL_KEYS.tokens);
  },

  // --- mapa CR→MAL ---
  async getMapping(key) {
    return (await syncGet(MAP_PREFIX + key)) || null;
  },
  async setMapping(key, value) {
    return syncSet({ [MAP_PREFIX + key]: value });
  },
  async getAllMappings() {
    return new Promise((resolve) =>
      syncArea().get(null, (all) => {
        const out = {};
        for (const [k, v] of Object.entries(all)) {
          if (k.startsWith(MAP_PREFIX)) out[k.slice(MAP_PREFIX.length)] = v;
        }
        resolve(out);
      }),
    );
  },
  async removeMapping(key) {
    return new Promise((resolve) => syncArea().remove(MAP_PREFIX + key, resolve));
  },
};
