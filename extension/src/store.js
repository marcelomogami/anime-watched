// store.js — wrapper de chrome.storage. Tudo em chrome.storage.local desde
// o v1.0.0 (AniList é o único backend, sem mapa source→provider — a lista
// real do AniList é a fonte de verdade, ver docs/1.0.0/contexto.md). Não usa
// mais chrome.storage.sync pra nada.

const AUTH_PREFIX = 'auth/'; // chave: "auth/anilist/client_id"

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

// Numerais romanos usados pelo AniList pra marcar temporada >= 2 no título
// romaji (ex.: "Mushoku Tensei II: ..." pra S2). Índice 0 = temporada 2.
const SEASON_ROMAN = ['II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

// Confere se um título (romaji OU english) "pertence" à temporada informada.
// Usado só pra desambiguar candidatos empatados por ID (ver
// `resolveEntryForSource` abaixo) — a CR costuma usar UMA página de série só
// pra franquias multi-temporada (ex.: Mushoku Tensei: S1/S2/S3 têm o mesmo
// crSeriesId), então casar só por ID não basta. Temporada 1 não tem marcador
// próprio no título (nem numeral romano nem "Season 1") — só é reconhecida
// pela AUSÊNCIA de marcador de qualquer temporada >= 2. Limitação conhecida:
// splits "Part 2" dentro da mesma temporada grande (ex.: "Mushoku Tensei II:
// ... Part 2") continuam ambíguos entre si, já que carregam o mesmo numeral.
function titleMatchesSeason(title, seasonNumber) {
  if (!title) return false;
  if (new RegExp(`\\bseason\\s*${seasonNumber}\\b`, 'i').test(title)) return true;
  if (seasonNumber >= 2) {
    const roman = SEASON_ROMAN[seasonNumber - 2];
    return roman ? new RegExp(`\\b${roman}\\b`).test(title) : false;
  }
  const hasHigherSeasonMarker =
    /\bseason\s*\d+\b/i.test(title) ||
    SEASON_ROMAN.some((r) => new RegExp(`\\b${r}\\b`).test(title));
  return !hasHigherSeasonMarker;
}

// Fallback por título (romaji/english/synonyms, comparação exata sem fuzzy)
// usado quando o casamento por ID falha — tanto por link desatualizado no
// AniList (CR) quanto por falta de índice ainda (PV), ver
// `resolveEntryForSource` abaixo.
function findByTitle(cache, seriesTitle) {
  if (!seriesTitle) return null;
  const normalized = seriesTitle.trim().toLowerCase();
  return (
    cache.entries.find((entry) => {
      const t = entry.media?.title || {};
      const synonyms = entry.media?.synonyms || [];
      return (
        t.romaji?.trim().toLowerCase() === normalized ||
        t.english?.trim().toLowerCase() === normalized ||
        synonyms.some((s) => s.trim().toLowerCase() === normalized)
      );
    }) || null
  );
}

export const store = {
  // --- auth (namespaced por provider) ---
  async getClientId(providerId) {
    return (await localGet(`${AUTH_PREFIX}${providerId}/client_id`)) || '';
  },
  async setClientId(providerId, id) {
    return localSet({
      [`${AUTH_PREFIX}${providerId}/client_id`]: (id || '').trim(),
    });
  },

  // --- tokens (namespaced por provider) ---
  async getTokens(providerId) {
    return (await localGet(`${AUTH_PREFIX}${providerId}/tokens`)) || null;
  },
  async setTokens(providerId, tokens) {
    return localSet({ [`${AUTH_PREFIX}${providerId}/tokens`]: tokens });
  },
  async clearTokens(providerId) {
    return localRemove(`${AUTH_PREFIX}${providerId}/tokens`);
  },

  // --- id numérico do usuário autenticado (namespaced por provider) ---
  // Cacheado depois do primeiro `Viewer { id }` — evita repetir essa query
  // toda vez que `getListCache()` precisa montar `MediaListCollection(userId: ...)`.
  async getViewerId(providerId) {
    return (await localGet(`${AUTH_PREFIX}${providerId}/viewer_id`)) || null;
  },
  async setViewerId(providerId, viewerId) {
    return localSet({ [`${AUTH_PREFIX}${providerId}/viewer_id`]: viewerId });
  },

  // --- cache local da MediaListCollection (v1.0.0) ---
  // { entries: [...], fetchedAt } em chrome.storage.local — não .sync, lista
  // completa (506 entradas reais confirmadas, ~470 KB) estoura de longe os
  // 100 KB de quota do .sync (ver docs/1.0.0/design.md § "Cache local").
  // `fetchedAt` só é tocado por um re-sync completo (setListCache) — updates
  // otimistas de uma entrada só (patchListCacheEntry) não mexem nele, de
  // propósito.
  async getListCache() {
    return (await localGet('anilist/listCache')) || null;
  },
  async setListCache(entries) {
    return localSet({
      'anilist/listCache': { entries, fetchedAt: Date.now() },
    });
  },
  // Substitui (ou adiciona) uma entrada só no cache já existente, sem tocar
  // em `fetchedAt` — usado depois de um save otimista (ver
  // docs/1.0.0/design.md § "Adicionar/atualizar entrada no cache local,
  // numa chamada só"). Casa pelo `id` da entrada (id da lista, não do anime);
  // se não achar nenhuma com esse id, adiciona como nova.
  async patchListCacheEntry(entry) {
    const cache = (await localGet('anilist/listCache')) || {
      entries: [],
      fetchedAt: 0,
    };
    const idx = cache.entries.findIndex((e) => e.id === entry.id);
    if (idx === -1) cache.entries.push(entry);
    else cache.entries[idx] = entry;
    return localSet({ 'anilist/listCache': cache });
  },

  // --- índice pvDetailId -> mediaId (só Prime Video) ---
  // Não é um mapeamento de dados (não guarda título/progresso/nada disso —
  // isso sempre vem do cache real acima). É só uma tradução de ID: o AniList
  // registra o Prime Video em `externalLinks` pelo ASIN da Amazon
  // (`amazon.com/dp/B07WT8T6KK`), que **não é o mesmo identificador** que o
  // `pvDetailId` extraído da URL da página
  // (`primevideo.com/detail/0GZCWV7IOJ8M9624JD5A4HA66B`) — confirmado com
  // dado real desta sessão, são sistemas de ID desconectados. Sem essa
  // tradução, dava pra casar por título (fallback em `resolveEntryForSource`
  // abaixo), mas uma vez resolvido — pelo usuário, no estado 1 (busca) — o
  // resultado fica salvo aqui pra não precisar buscar de novo. Existe só
  // porque o Crunchyroll não tem esse problema (o `crSeriesId` aparece
  // direto na URL do `externalLinks`, sem tradução nenhuma).
  async getPvMediaId(pvDetailId) {
    const map = (await localGet('pv/idMap')) || {};
    return map[pvDetailId] || null;
  },
  async setPvMediaId(pvDetailId, mediaId) {
    const map = (await localGet('pv/idMap')) || {};
    map[pvDetailId] = mediaId;
    return localSet({ 'pv/idMap': map });
  },

  // Resolve se a aba atual (source + id extraído da página) já está em
  // alguma lista, usando só o cache local — sem query nova. Ver
  // docs/1.0.0/design.md § "Resolver aba atual → estado do popup".
  //   - Crunchyroll: casa `sourceId` (crSeriesId) direto contra a URL de
  //     `externalLinks` — confirmado com dado real (.../series/GT00371630/...).
  //     Nem todo link do AniList foi migrado pro formato novo do CR, porém:
  //     achado real (2026-07-18) mostrou 202 de 326 entradas com link de CR
  //     ainda no formato antigo (`crunchyroll.com/<slug>`, sem `/series/<id>/`,
  //     era pré-2018), que nunca bate por ID — cai no mesmo fallback por
  //     título do PV abaixo. Franquias multi-temporada costumam ter VÁRIAS
  //     entradas do AniList batendo no mesmo `crSeriesId` (confirmado com
  //     dado real 2026-07-22: Mushoku Tensei S2/S3/S2-Part2 compartilham a
  //     mesma página de série na CR) — quando isso acontece, desambigua por
  //     `seasonNumber` via `titleMatchesSeason` antes de aceitar o primeiro.
  //   - Prime Video: `sourceId` (pvDetailId) não bate com o ASIN do
  //     `externalLinks` (ver `getPvMediaId` acima) — tenta o índice primeiro;
  //     sem índice ainda, cai pro fallback por título (best-effort, sem
  //     garantia — compara romaji/english/synonyms exato, sem fuzzy).
  async resolveEntryForSource({ site, sourceId, seriesTitle, seasonNumber }) {
    const cache = await store.getListCache();
    if (!cache) return null;

    if (site === 'cr') {
      const candidates = cache.entries.filter((entry) =>
        (entry.media?.externalLinks || []).some(
          (link) => link.type === 'STREAMING' && link.url.includes(sourceId),
        ),
      );
      if (candidates.length > 1 && seasonNumber) {
        const bySeason = candidates.find(
          (entry) =>
            titleMatchesSeason(entry.media?.title?.romaji, seasonNumber) ||
            titleMatchesSeason(entry.media?.title?.english, seasonNumber),
        );
        if (bySeason) return bySeason;
      }
      return candidates[0] || findByTitle(cache, seriesTitle);
    }

    if (site === 'pv') {
      const mediaId = await store.getPvMediaId(sourceId);
      if (mediaId) {
        const byId = cache.entries.find((entry) => entry.media?.id === mediaId);
        if (byId) return byId;
      }
      return findByTitle(cache, seriesTitle);
    }

    return null;
  },
};
