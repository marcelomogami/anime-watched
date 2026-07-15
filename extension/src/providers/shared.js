// providers/shared.js — helpers reaproveitados entre implementações de provider.

// Extrai um id numérico de uma URL "*/anime/{id}/*" (MAL e AniList usam o
// mesmo padrão de path) ou de um id colado direto.
export function parseAnimeId(input) {
  const s = (input || '').trim();
  if (/^\d+$/.test(s)) return Number(s);
  const m = s.match(/anime\/(\d+)/);
  return m ? Number(m[1]) : null;
}

// O AniList guarda `id` (dele mesmo) e `idMal` no mesmo registro — isso o
// torna a única "ponte" com dado cruzado entre os dois catálogos, então
// qualquer provider pode usar a API pública dele (sem autenticação, campo
// `Media.idMal` não exige token) pra traduzir um id do AniList pro id
// equivalente no MAL. Não existe o caminho contrário (o MAL não expõe um
// `idAnilist`) — ver docs/contexto-providers.md.
export async function anilistIdToMalId(anilistId) {
  const res = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      query: 'query ($id: Int) { Media(id: $id, type: ANIME) { idMal } }',
      variables: { id: Number(anilistId) },
    }),
  });
  if (!res.ok) return null;
  const body = await res.json();
  return body.data?.Media?.idMal ?? null;
}
