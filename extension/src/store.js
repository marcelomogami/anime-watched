// store.js — wrapper de chrome.storage
// - config (clientId/secret) e tokens: namespaced por provider, chrome.storage.local
// - provider ativo: chrome.storage.local
// - mapa source→provider: chrome.storage.sync (sincroniza entre máquinas), fallback local
//   cada entrada guarda um alvo por provider (`providers: { mal: {...}, anilist: {...} }`),
//   pra não perder o vínculo com um provider ao trocar o provider ativo pra outro.

const ACTIVE_PROVIDER_KEY = 'active_provider';
const DEFAULT_PROVIDER = 'mal';

const AUTH_PREFIX = 'auth/'; // chave: "auth/mal/client_id"
const MAP_PREFIX = 'map:'; // chave: "map:GT00371630#S1"

// Chaves antigas (pré-namespacing), só existiram pro MAL. Migradas por
// self-heal na primeira leitura de cada uma — ver `readAuthValue` abaixo.
const LEGACY_LOCAL_KEYS = {
  client_id: 'mal_client_id',
  client_secret: 'mal_client_secret',
  tokens: 'mal_tokens',
};

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

// Converte uma entrada de mapeamento do formato antigo (pré-providers, campos
// `malAnimeId`/`malTitle`/`malNumEpisodes` soltos) pro formato novo
// (`providers: { mal: { animeId, title, numEpisodes } }`). Entradas que já
// estão no formato novo passam direto.
function migrateMappingShape(raw) {
  if (!raw) return null;
  if (raw.providers) return raw;
  if (raw.malAnimeId === undefined) return raw; // formato desconhecido: não mexe
  const { malAnimeId, malTitle, malNumEpisodes, ...common } = raw;
  return {
    ...common,
    providers: {
      mal: {
        animeId: malAnimeId,
        title: malTitle,
        numEpisodes: malNumEpisodes || 0,
      },
    },
  };
}

// Lê uma chave de auth namespaced; se estiver vazia e existir uma chave
// legada equivalente (só possível pro provider 'mal'), migra o valor pra
// chave nova, apaga a antiga e retorna o valor migrado. Self-heal, mesmo
// espírito da migração de mapeamentos.
async function readAuthValue(providerId, suffix) {
  const key = `${AUTH_PREFIX}${providerId}/${suffix}`;
  const val = await localGet(key);
  if (val !== undefined) return val;

  const legacyKey = providerId === 'mal' ? LEGACY_LOCAL_KEYS[suffix] : undefined;
  if (!legacyKey) return undefined;
  const legacyVal = await localGet(legacyKey);
  if (legacyVal === undefined) return undefined;

  await localSet({ [key]: legacyVal });
  await localRemove(legacyKey);
  return legacyVal;
}

export const store = {
  // --- provider ativo ---
  async getActiveProvider() {
    return (await localGet(ACTIVE_PROVIDER_KEY)) || DEFAULT_PROVIDER;
  },
  async setActiveProvider(providerId) {
    return localSet({ [ACTIVE_PROVIDER_KEY]: providerId });
  },

  // --- auth (namespaced por provider) ---
  async getClientId(providerId) {
    return (await readAuthValue(providerId, 'client_id')) || '';
  },
  async setClientId(providerId, id) {
    return localSet({
      [`${AUTH_PREFIX}${providerId}/client_id`]: (id || '').trim(),
    });
  },
  async getClientSecret(providerId) {
    return (await readAuthValue(providerId, 'client_secret')) || '';
  },
  async setClientSecret(providerId, secret) {
    return localSet({
      [`${AUTH_PREFIX}${providerId}/client_secret`]: (secret || '').trim(),
    });
  },

  // --- tokens (namespaced por provider) ---
  async getTokens(providerId) {
    return (await readAuthValue(providerId, 'tokens')) || null;
  },
  async setTokens(providerId, tokens) {
    return localSet({ [`${AUTH_PREFIX}${providerId}/tokens`]: tokens });
  },
  async clearTokens(providerId) {
    return localRemove(`${AUTH_PREFIX}${providerId}/tokens`);
  },

  // --- mapa source→provider ---

  // Retorna a entrada inteira (metadados comuns + alvo por provider já
  // migrado), ou null se não existe.
  async getMappingEntry(key) {
    const raw = await syncGet(MAP_PREFIX + key);
    const migrated = migrateMappingShape(raw);
    if (migrated && migrated !== raw) {
      // self-heal: persiste o formato novo já na primeira leitura
      await syncSet({ [MAP_PREFIX + key]: migrated });
    }
    return migrated;
  },

  // Mescla `value` (shape { animeId, title, numEpisodes }) dentro de
  // `providers[providerId]` da entrada, preservando outros providers e os
  // metadados comuns já salvos (ex.: crSeriesTitle, site).
  async setMappingProvider(key, providerId, value, commonFields = {}) {
    const existing = (await store.getMappingEntry(key)) || { providers: {} };
    const entry = {
      ...existing,
      ...commonFields,
      providers: {
        ...existing.providers,
        [providerId]: value,
      },
    };
    return syncSet({ [MAP_PREFIX + key]: entry });
  },

  async getAllMappingEntries() {
    return new Promise((resolve) =>
      syncArea().get(null, async (all) => {
        const out = {};
        for (const [k, v] of Object.entries(all)) {
          if (k.startsWith(MAP_PREFIX)) {
            const migrated = migrateMappingShape(v);
            out[k.slice(MAP_PREFIX.length)] = migrated;
            if (migrated !== v) {
              await syncSet({ [k]: migrated }); // self-heal
            }
          }
        }
        resolve(out);
      }),
    );
  },

  async removeMapping(key) {
    return new Promise((resolve) => syncArea().remove(MAP_PREFIX + key, resolve));
  },
};
