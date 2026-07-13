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

## Extração na página da série (`/series/{crSeriesId}/...`, sem abrir episódio)

Investigado ao vivo em 2026-07-13 (Playwright), pra viabilizar mapear um anime sem
abrir `/watch/` (que a plataforma registra como "aberto"). Testado em:

- `https://www.crunchyroll.com/series/GT00371630/daemons-of-the-shadow-realm`
  (1 temporada só)
- `https://www.crunchyroll.com/series/GR751KNZY/attack-on-titan` (4 temporadas +
  OADs/filme)

### `crSeriesId` e título

Vêm direto da URL (`parseSeriesId`, já implementado) e do JSON-LD `TVSeries` da
própria página (`name`, com prefixo `"Watch "` a remover — diferente do prefixo
romaji do JSON-LD `TVEpisode`). **Esse JSON-LD não traz `seasonNumber` nem
`TVSeason`** — season não vem daqui.

### `seasonNumber`: dropdown de temporada no DOM

A página tem um seletor de temporada (visível só quando a série tem **mais de
uma temporada**). Elemento estável (classe sem hash de CSS module):

```html
<div class="season-info">
  <span class="...">S1: Attack on Titan</span>
  ...
</div>
```

Confirmado que o texto **reflete a temporada atualmente selecionada no
dropdown**, atualizando ao vivo quando o usuário troca de temporada pela UI
(testado: trocar pra "S2: Attack on Titan Season 2" atualiza `.season-info` na
hora). **A URL não muda** ao trocar de temporada — é só estado client-side.
Isso implica: extrair o `seasonNumber` exige ler o DOM **no momento da
extração**, não dá pra inferir só pela URL, e o usuário precisa estar com a
temporada certa selecionada no dropdown antes de mapear.

**Bug real encontrado em produção (2026-07-13) — nem toda série usa
`S{N}: título`.** A hipótese inicial (regex `/^S(\d+):/` cobrindo o caso
comum, com fallback pra "sem dropdown = temporada única") quebrou pro anime
"Clevatess": a série tem 2 temporadas, mas os itens do dropdown são só
`"Clevatess"` (temporada 1) e `"Clevatess II"` (temporada 2) — sem nenhum
prefixo numérico. Em pt-BR, a mesma temporada 2 aparece como `"2ª Temporada"`
(rótulo genérico do locale, também sem o formato `S{N}:`). Ou seja, a
nomenclatura do item de temporada é curada por título no catálogo da CR, não
segue uma convenção única — varia por série *e* por locale.

Cheguei a investigar uma alternativa via API interna
(`content/v2/cms/series/{id}/seasons`, que retorna `season_number` explícito
por temporada — a fonte estruturada real por trás do dropdown), mas ela exige
um token de sessão vinculado ao locale exato da página; pedir com um locale
diferente do da sessão atual devolve `401 invalid_auth_token`. Não dá pra
prever de forma confiável qual locale usar sem já ter uma chamada bem-sucedida
pra copiar, e reverse-engineer esse token foge do padrão do projeto de "ler
só o que está exposto no DOM/metadados públicos" (mesma decisão já tomada em
`docs/pv-extraction.md` sobre não interceptar `fetch`/`XHR`).

### Alternativa manual pra temporadas 2+ com rótulo não reconhecido

Se o fallback (assume temporada 1) errar — série com 2+ temporadas cujo
rótulo no dropdown não bate com nenhum dos padrões conhecidos —, dá pra
mapear certo sem depender do dropdown: **abrir o episódio 1 da temporada
certa (clicar na miniatura na própria lista de episódios da página da série)
sem apertar play**, e usar "Plan to watch" a partir de lá. A extração
`/watch/` (`fromJsonLd()`) já lê `seasonNumber` de forma 100% confiável, sem
ambiguidade nenhuma — o único motivo de existir a extração alternativa pela
página da série é evitar abrir `/watch/`.

Investigado ao vivo (2026-07-13): abrir a página `/watch/` **sem apertar
play** não gera nenhuma requisição de rede parecida com rastreamento de
"assistido"/"histórico"/"continuar assistindo" — só busca de metadados
(episódio, série, avaliações, recomendações, episódio anterior). Ou seja,
parece seguro contra o problema original (CR registrar como "aberto"). Não
consegui confirmar o que acontece **depois** que o play de fato começa (a
tentativa de play caiu num paywall de "assine premium" na sessão anônima de
teste, sem chegar a reproduzir o vídeo) — mas a leitura mais provável é que o
rastreamento em si dispare no início da reprodução, não no carregamento da
página. Decisão registrada: manter o fallback automático (assume S1) como
está, sem automatizar a abertura de aba em background pra isso — é mais
prático simplesmente abrir manualmente o episódio certo sem dar play, nos
casos raros em que o fallback erraria.

### Heurística final (com fallback pra temporada 1)

```
seasonEl = document.querySelector('.season-info')
if (!seasonEl) → seasonNumber = 1                             // série de temporada única
else if (match = texto.match(/^S(\d+):/)) → seasonNumber = match[1]           // "S2: Título"
else if (match = texto.match(/(\d+)\s*ª?\s*(temporada|season)/i)) → seasonNumber = match[1]  // "2ª Temporada"
else → seasonNumber = 1   // não deu pra parsear ("Clevatess", "Clevatess II") — assume
                          // o estado padrão da página (temporada 1) em vez de falhar
```

O último fallback é uma aposta deliberada: a maioria das vezes que alguém abre
a página da série do zero, ela mostra a temporada 1 por padrão (confirmado com
"Attack on Titan"). Se o usuário estiver deliberadamente numa temporada
seguinte cujo rótulo não bate com nenhum dos padrões conhecidos, o mapeamento
sai errado — mas isso é corrigível depois pelo "re-mapear", e é estritamente
melhor que falhar sempre que a série não usa `S{N}:` (que era o caso comum
quebrado, não uma exceção rara).
