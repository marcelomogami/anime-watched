# Extração de dados da página /watch/ do Crunchyroll

Investigado ao vivo em 2026-07-11 na página:
`https://www.crunchyroll.com/pt-br/watch/GE00374597JAJP/daikyo-and-shokyo`
(anime "Yomi no Tsugai / Daemons do Reino das Sombras", E13).

## Fonte primária: JSON-LD (`<script type="application/ld+json">`)

O CR injeta, **após a renderização do SPA**, um bloco JSON-LD do tipo `TVEpisode`.
É a fonte mais estruturada e estável. Estrutura relevante:

```json
{
  "@type": "TVEpisode",
  "name": "Yomi no Tsugai - Daemons do Reino das Sombras | E13 - Muito Azar e Pouco Azar",
  "episodeNumber": 13,
  "partOfSeason": {
    "@type": "TVSeason",
    "@id": "https://www.crunchyroll.com/pt-br/series/GT00371630/daemons-of-the-shadow-realm",
    "name": "Yomi no Tsugai - Daemons do Reino das Sombras",
    "seasonNumber": 1
  },
  "partOfSeries": {
    "@type": "TVSeries",
    "@id": "https://www.crunchyroll.com/pt-br/series/GT00371630/daemons-of-the-shadow-realm",
    "name": "Yomi no Tsugai - Daemons do Reino das Sombras"
  }
}
```

### Campos que usamos

| Dado | De onde | Exemplo |
|------|---------|---------|
| `episodeNumber` | `ld.episodeNumber` | `13` → vira `num_watched_episodes` no MAL |
| `seasonNumber` | `ld.partOfSeason.seasonNumber` | `1` |
| `crSeriesId` | regex `/series/(G[A-Z0-9]+)/` em `ld.partOfSeason["@id"]` | `GT00371630` |
| `seriesTitle` | `ld.partOfSeason.name` | `Yomi no Tsugai - Daemons do Reino das Sombras` (usado na busca do MAL) |
| `episodeId` | regex `/watch/(G[A-Z0-9]+)/` na URL | `GE00374597JAJP` |

### Chave de mapeamento CR→MAL

```
`${crSeriesId}#S${seasonNumber}`   →   ex.: "GT00371630#S1"
```

Chave por **temporada** (série CR + número da temporada). Cobre o caso comum de um
show multi-cour em que cada temporada do CR é uma entrada separada no MAL, e mantém
`num_watched_episodes` como o número do episódio dentro da temporada.

## Fallback: `og:title` (meta tag)

Também renderizado após o SPA carregar. Formato observado:

```
<meta property="og:title"
      content="Yomi no Tsugai - Daemons do Reino das Sombras | E13 - Muito Azar e Pouco Azar">
```

Padrão: `{Série} | E{num} - {TítuloEpisódio}`. Regex de fallback:
`/^(.*?)\s*\|\s*E(\d+)\s*-\s*(.*)$/` → série, número do episódio, título. Não traz
`seasonNumber` nem `crSeriesId` (esses saem da URL/`og:url`), então é fallback só se o
JSON-LD faltar.

## Observações de implementação

- **Timing:** JSON-LD e og:title só aparecem depois que o React renderiza (~alguns
  segundos após navegar). O content script deve **esperar** — `MutationObserver` no
  `<head>`/`<script>` ou polling curto — até o JSON-LD `TVEpisode` existir. Não ler no
  `DOMContentLoaded`.
- **Locale:** a URL tem prefixo de locale (`/pt-br/`). O match do content script precisa
  aceitar com e sem locale → usar `*://*.crunchyroll.com/*watch/*` e validar `/watch/`
  em código.
- **Título localizado:** `name` vem com prefixo romaji + título localizado
  ("Yomi no Tsugai - ..."). Pra busca no MAL, o romaji ("Yomi no Tsugai") costuma ser o
  melhor termo; de todo modo o usuário confirma o candidato certo na 1ª vez, então o
  título só precisa ser "bom o suficiente" pra busca.
- **Bloqueio de segurança do executor:** dumps amplos de `window`/scripts são barrados
  pelo filtro (suspeita de cookie/token). No content script isso não se aplica — mas
  confirma que devemos ler apenas os campos do JSON-LD, sem varrer `window`.
