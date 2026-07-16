# Contexto e Plano — Evolução pra modelo AniList-first (sem mapeamento manual)

**Status: exploração, nada decidido ainda.** Este doc existe pra reunir a ideia, o que dá
pra aproveitar do código atual, os campos reais disponíveis no AniList (pra escolher o que
aparece no popup) e as perguntas em aberto — antes de desenhar fases de implementação como
`docs/contexto-providers.md` fez.

## Contexto

Depois de implementar a camada de providers (`docs/contexto-providers.md`, v0.5.0+), o
usuário efetivamente migrou o uso real pro AniList — o MAL virou secundário na prática.
Nessa mesma época, explorando o schema do AniList (ver seção de campos abaixo), ficou claro
que `Media.externalLinks` e `Media.streamingEpisodes` já trazem os links de streaming
(Crunchyroll, Prime Video, etc.) **direto na entrada do anime**, mantidos pela comunidade do
AniList — validado ao vivo com dois exemplos reais do usuário:

- **Frieren** (`id 154587`, já assistido): `externalLinks` tem uma entrada
  `STREAMING`/`Crunchyroll` → `crunchyroll.com/series/GG5H5XQX4/...` — confirmado que esse
  ID resolve certo pra página real da série, sem redirect. `streamingEpisodes` traz os 28
  links de episódio individuais, com thumbnail.
- **"Nige Jouzu no Wakagimi 2nd Season" / The Elusive Samurai S2** (`id 182616`, na lista
  "Plan to watch" do usuário, ainda não lançado): mesmo com `status: NOT_YET_RELEASED`, já
  tem `externalLinks` apontando pro Crunchyroll (`.../series/GQWH0M19X/...`), e
  `nextAiringEpisode` já mostra o episódio 1 chegando (~38h na hora do teste — bate com "lança
  amanhã").

**A ideia central:** se o vínculo série↔streaming já existe no AniList (mantido pela
comunidade, não por você), a extensão não precisa de mapeamento local nenhum pro caso comum —
só precisa perguntar "esse anime que a source está mostrando já está na minha lista
Watching/Planning do AniList, e qual o link de streaming que ele já tem cadastrado?" em vez de
"deixa eu procurar por título e você escolhe". O popup também deixaria de ser "reativo à aba
atual" pra virar, na prática, um painel da sua lista do AniList — com a aba atual (se for
CR/PV) só destacando qual entrada é a "atual".

## O que dá pra aproveitar do código atual

A big maioria da infraestrutura já existe e serve sem mudança:

- **`providers/anilist.js`** — cliente OAuth (Implicit Grant) e GraphQL já prontos; só
  precisa de queries novas (buscar a lista com `externalLinks`/`streamingEpisodes`/
  `nextAiringEpisode` em vez de só busca por título).
- **`sources/crunchyroll.js` / `sources/primevideo.js`** — continuam necessários. Mesmo que
  "qual anime é" passe a vir do AniList, ainda precisa saber **qual episódio** você está
  vendo agora (pra saber até onde marcar como assistido) — isso só a source sabe dizer.
- **`store.js`** — o wrapper de `chrome.storage` continua útil, mas o *conteúdo* muda de
  "tabela de mapeamento que o usuário decidiu" pra "cache da lista do AniList" (evita
  rebuscar tudo a cada abertura do popup).
- **UI de cards com banner** (`popup.html`/`popup.js`, v0.5.1) — a tela de "mapeamentos
  salvos" já É, visualmente, quase o painel que a nova ideia pede (card com banner, título,
  episódios, botão pra abrir na source). A mudança é *de onde vem o dado de cada card*: hoje
  vem do mapeamento local; no modelo novo, vem direto do `MediaListCollection` do AniList.
- **i18n, ícones, manifest** (`host_permissions` já inclui `graphql.anilist.co`) — sem
  mudança estrutural.

## O que vira legado (não quebra, mas deixa de ser o mecanismo principal)

- **Mapeamento multi-provider por chave** (`providers: { mal: {...}, anilist: {...} }`) —
  perde a razão de ser se o AniList sozinho já resolve o vínculo pra quem usa só AniList.
  Continua funcionando pra quem ainda quiser MAL (ver "Perguntas em aberto").
- **Cross-reference `idMal` (MAL↔AniList)** — só importa se o MAL continuar em uso ativo
  em paralelo; no modelo "só AniList", não tem mais outro provider pra cruzar.
- **Fluxo de busca por título** — não desaparece (ainda serve de fallback pra anime que não
  está na lista do AniList ou sem `externalLinks` cadastrado), mas deixa de ser o caminho
  principal.

## Campos disponíveis no AniList (pra decidir o que aparece no popup)

Levantado por introspecção direta do schema em `graphql.anilist.co` (não documentação
de terceiros) — lista completa, não só os já usados hoje (`title`, `episodes`, `coverImage`,
`bannerImage`, `idMal`).

### `Media` — dados do anime em si

| Campo | O que é |
|---|---|
| `id` / `idMal` | ID no AniList / ID equivalente no MAL |
| `title { romaji, english, native, userPreferred }` | título em cada idioma — `userPreferred` já respeita a preferência da sua conta |
| `format` | `TV`, `TV_SHORT`, `MOVIE`, `SPECIAL`, `OVA`, `ONA`, `MUSIC` (+ formatos de mangá) |
| `status` | `FINISHED`, `RELEASING`, `NOT_YET_RELEASED`, `CANCELLED`, `HIATUS` |
| `description` | sinopse |
| `startDate` / `endDate` | `{ year, month, day }` |
| `season` / `seasonYear` / `seasonInt` | `WINTER`/`SPRING`/`SUMMER`/`FALL` + ano |
| `episodes` | total de episódios quando completo (`null` se ainda não anunciado) |
| `duration` | duração média do episódio, em minutos |
| `countryOfOrigin`, `isLicensed`, `source` (`MANGA`, `LIGHT_NOVEL`, `ORIGINAL`, etc.), `hashtag` | metadados descritivos |
| `trailer { id, site, thumbnail }` | trailer (YouTube/Dailymotion) |
| `coverImage { extraLarge, large, medium, color }` | pôster vertical, + cor média dominante (dá pra usar em UI) |
| `bannerImage` | banner horizontal — já em uso desde v0.5.1 |
| `genres`, `synonyms`, `tags { name, description, rank, isGeneralSpoiler, ... }` | gêneros, títulos alternativos, tags temáticas com nível de spoiler |
| `averageScore`, `meanScore`, `popularity`, `favourites`, `trending` | métricas agregadas da comunidade |
| `relations`, `characters`, `staff`, `studios` | franquia relacionada, elenco, equipe, estúdios |
| `nextAiringEpisode { episode, airingAt, timeUntilAiring }` | **próximo episódio a estrear** — já cogitado como ideia futura em `docs/contexto-providers.md`, agora com caso de uso real validado |
| `airingSchedule` | cronograma completo de exibição (todos os episódios, não só o próximo) |
| `externalLinks { url, site, type (INFO/STREAMING/SOCIAL), language, icon }` | **é o campo-chave desta ideia** — links pra streaming, site oficial, redes sociais |
| `streamingEpisodes { title, url, site, thumbnail }` | link + thumbnail por episódio individual, quando disponível |
| `mediaListEntry` | atalho pra pegar a entrada da sua lista (equivale a fazer a query `MediaList` separada) |
| `siteUrl` | URL da própria página do anime no AniList |
| `rankings`, `reviews`, `recommendations`, `stats` | ranking por temporada/geral, reviews e recomendações de outros usuários |
| `isAdult`, `isFavourite` | flags de conteúdo adulto / favoritado por você |

### `MediaList` — sua relação pessoal com o anime (progresso)

| Campo | O que é |
|---|---|
| `status` | `CURRENT` (watching), `PLANNING`, `COMPLETED`, `DROPPED`, `PAUSED`, `REPEATING` |
| `progress` | episódios assistidos |
| `score` | sua nota |
| `repeat` | quantas vezes já re-assistiu |
| `priority` | prioridade dentro do "planning" |
| `notes` | suas anotações pessoais no anime |
| `startedAt` / `completedAt` | `{ year, month, day }` de quando começou/terminou |
| `updatedAt` / `createdAt` | quando a entrada foi mexida/criada |
| `customLists` | em quais listas customizadas suas o anime está |
| `private`, `hiddenFromStatusLists` | visibilidade da entrada |

### Observações práticas

- **`streamingEpisodes` não tem um campo de número de episódio estruturado** — só `title`
  (ex.: `"Episode 12 - A Real Hero"`). Pra linkar direto no "próximo episódio a assistir"
  (progress + 1), a extensão precisaria parsear esse texto ou confiar na ordem do array —
  funciona na prática mas não é um campo garantido pelo schema, vale testar em mais casos
  antes de depender disso.
- **Nem todo anime tem `externalLinks`/`streamingEpisodes` preenchido** — é dado mantido
  pela comunidade do AniList, então títulos obscuros podem não ter. Sempre precisa de
  fallback.
- **Rate limit:** 90 requisições/min (30/min em modo degradado, ver
  `docs/contexto-providers.md`) — buscar a lista inteira (`MediaListCollection`) com todos
  esses campos por entrada é uma query só, não uma por anime, então não é motivo de
  preocupação mesmo com listas grandes.

## Possibilidades de UI (nada decidido, só opções)

- **Painel por status:** seções "Assistindo" / "Pra assistir", cada entrada como card
  banner (já existe visualmente) — clicar abre o streaming (via `externalLinks`, ou já
  linkando o próximo episódio via `streamingEpisodes` se der pra confiar no parse).
- **Contagem regressiva:** usar `nextAiringEpisode.timeUntilAiring` pra mostrar "próximo
  episódio em Xh" nos itens que ainda não lançaram (ligado à ideia de notificação já
  registrada como futura em `docs/contexto-providers.md`).
- **Aba atual como destaque, não como gatilho único:** se você abrir o popup estando no
  Crunchyroll/PV, a entrada correspondente (achada via `externalLinks` batendo com
  `crSeriesId`/`pvDetailId` da aba) fica em destaque/topo, mas o painel funciona igual
  abrindo de qualquer aba.
- **Progresso visual:** `progress`/`episodes` dá pra virar barra de progresso por card, não
  só texto.

## Perguntas em aberto

1. **Evoluir o `anime-watched` atual ou criar um projeto novo?** Dado o quanto é
   reaproveitável (seção acima), a favor de evoluir — mas é decisão do usuário.
2. **MAL fica como opção secundária, ou sai de vez?** Se ficar, o mapeamento multi-provider
   continua justificado pra quem usa MAL; se sair, simplifica bastante `store.js`/
   `background.js` (sem mais interface genérica de provider pra só um provider existir).
3. **O que fazer quando o anime não está na lista do AniList ainda?** Precisa de um fluxo
   de "adicionar" (busca + `SaveMediaListEntry` com status `PLANNING`) — é basicamente o
   fluxo de busca que já existe hoje, só que gravando na lista de verdade em vez de só
   mapeamento local.
4. **Confiar em `streamingEpisodes` pra linkar o episódio exato, ou só a série
   (`externalLinks`)?** Precisa testar em mais animes antes de decidir — o campo não tem
   número de episódio estruturado.
5. **Cache da lista:** buscar `MediaListCollection` toda vez que o popup abre, ou cachear
   localmente (`store.js`) e só re-buscar periodicamente/sob demanda?
