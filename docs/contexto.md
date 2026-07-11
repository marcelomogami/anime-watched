# Contexto e Plano — Extensão Chrome: gravar episódio do Crunchyroll no MyAnimeList

## Context

Marcelo assiste anime no Crunchyroll (no Chrome) e quer registrar rapidamente no
MyAnimeList (MAL) o episódio que acabou de ver, sem abrir o site do MAL e procurar
o anime na mão. O gatilho é **manual, pelo botão da extensão na barra** (o ícone ao
lado da barra de endereço) — sem atalho de teclado. O Jellyfin já tem um plugin que faz
sync (`jellyfin-ani-sync`), então o foco agora é **só o Crunchyroll**.

Problema central de arquitetura: Crunchyroll e MAL usam identificadores diferentes e
sem chave comum. O CR identifica a série/temporada por GUIDs próprios (ex.: `GT00371630`);
o MAL por um `anime_id` numérico. Títulos divergem (romaji × inglês × título localizado
do CR) e, pior, uma "temporada" no CR frequentemente é uma **entrada separada** no MAL.

**Decisão-chave:** o "intermediário" que casa os dois IDs é uma **tabela de mapeamento
local dentro da própria extensão** (`chrome.storage`). Não há servidor/backend. A
extensão inteira é serverless: OAuth, chamadas ao MAL e o mapa CR→MAL vivem no cliente.

Stack: **JavaScript puro, Manifest V3, sem passo de build** — ferramenta pessoal,
carregável como "unpacked", iteração rápida, sem bundler pra manter.

## Arquitetura de arquivos

```
anime-watched/
  docs/
    PLAN.md                  # este plano
    cr-extraction.md         # investigação ao vivo da página /watch/ (feito)
  extension/
    manifest.json            # MV3, action com popup, permissões (SEM commands/atalho)
    src/
      background.js          # service worker: orquestra leitura + chamadas MAL
      content.js             # em crunchyroll.com/watch/*: extrai série/temporada/episódio
      mal.js                 # cliente API MAL (OAuth PKCE, search, get/patch list status)
      cr.js                  # (opcional) helpers de extração — hoje inline no content.js
      store.js               # wrapper chrome.storage (config, tokens, mapa CR→MAL)
      popup.html / popup.js  # A INTERFACE — máquina de estados (setup, gravar, mapear, gerir)
    icons/                   # 16/48/128
  README.md
```

## Extração no Crunchyroll (confirmado — ver `cr-extraction.md`)

Da página `/watch/`, via JSON-LD `TVEpisode` (fallback `og:title`):

| Dado | Origem | Exemplo |
|------|--------|---------|
| `episodeNumber` | `ld.episodeNumber` | `13` |
| `seasonNumber` | `ld.partOfSeason.seasonNumber` | `1` |
| `crSeriesId` | regex em `ld.partOfSeason["@id"]` | `GT00371630` |
| `seriesTitle` | `ld.partOfSeason.name` | `Yomi no Tsugai - Daemons do Reino das Sombras` |
| `episodeId` | regex na URL | `GE00374597JAJP` |

**Chave de mapeamento:** `` `${crSeriesId}#S${seasonNumber}` `` → ex.: `GT00371630#S1`.

## A INTERFACE (popup) — o coração do "intermediário"

O popup é uma **máquina de estados**. Abre ao clicar no ícone da extensão.

### Estado 1 — Não configurado (sem Client ID ou sem login)
- Mostra o **Redirect URI** (`https://<id>.chromiumapp.org/`) pra registrar no app do MAL.
- Input do **Client ID** + [Salvar].
- Botão **[Login no MAL]** (OAuth PKCE via `launchWebAuthFlow`).

### Estado 2 — Pronto, na página /watch/, temporada JÁ mapeada
```
Yomi no Tsugai — S1 · ep 13
→ MAL: Yomi no Tsugai (24 ep) · progresso atual: 12
[   Gravar episódio 13   ]
editar mapeamento · ver mapeamentos
```
- Antes de gravar, busca o `my_list_status` atual e mostra o **progresso já registrado**.
- Botão grava `num_watched_episodes` (regra de progresso abaixo).

### Estado 3 — Pronto, na página /watch/, temporada NÃO mapeada
```
Detectado: Yomi no Tsugai · S1 · ep 13   (GT00371630)
Buscar no MAL: [Yomi no Tsugai______] [Buscar]
  ○ Yomi no Tsugai         TV · 2024 · 24 ep   [Escolher]
  ○ Yomi no Tsugai 2ª Temp TV · 2025 · 12 ep   [Escolher]
Não achou? Cole a URL/ID do MAL: [__________] [Usar]
Nº do episódio a gravar: [13]   (ajustável)
```
- **Busca automática** pré-preenchida com um palpite limpo do título (trecho antes do
  `" - "` pra evitar o sufixo localizado). Lista candidatos com capa, título, tipo, ano, nº ep.
- **Fallback manual:** colar URL (`myanimelist.net/anime/XXXX/...`) ou ID → extrai o id.
- **Nº de episódio ajustável:** cobre descasamento de numeração CR × MAL (cour absoluto).
- Ao escolher/usar → salva o mapeamento e grava o episódio.

### Estado 4 — Fora de uma página /watch/
- Mensagem: "Abra um episódio no Crunchyroll." (+ acesso à tela de mapeamentos e setup.)

### Estado 5 — Gestão de mapeamentos (seção/aba secundária)
```
Mapeamentos salvos
  GT00371630#S1 → Yomi no Tsugai (24 ep)   [re-mapear] [apagar]
  GT00xxxxxx#S1 → Frieren (28 ep)          [re-mapear] [apagar]
```
- Listar todos, **re-mapear** (reabre a busca do Estado 3) e **apagar** (quando errou).

## Regras de comportamento (novas — faltavam no plano)

1. **Confirmação antes de gravar:** o clique no ícone abre o popup; a gravação só ocorre
   ao clicar em **Gravar** (evita gravação acidental). Nunca grava automático.
2. **Progresso nunca retrocede por engano:** se o MAL já tem progresso `>=` o episódio
   detectado, avisa ("MAL já tem 15, você quer voltar pra 13?") em vez de sobrescrever
   silenciosamente. Aumentar é direto; diminuir pede confirmação.
3. **`status`:** vira `completed` quando o episódio `>=` total conhecido do MAL; senão
   `watching`. (Rewatch fica fora de escopo por ora.)
4. **Aquisição dos IDs:** `crSeriesId` sempre automático da página; `malAnimeId` por busca
   ou colagem manual de URL/ID.

## MAL API (confirmado — pesquisa)

- **OAuth2 PKCE, só `plain`** (`code_challenge == code_verifier`, verifier 48–128 chars).
  App público, sem secret. Redirect `https://<extension-id>.chromiumapp.org/`.
- **Gravar:** `PATCH /v2/anime/{id}/my_list_status` form-urlencoded (`num_watched_episodes`,
  `status`), Bearer token.
- **Ler progresso atual:** `GET /v2/anime/{id}?fields=my_list_status,num_episodes`.
- **Buscar:** `GET /v2/anime?q=&limit=&fields=alternative_titles,num_episodes,media_type,start_season,main_picture`.

## Passos de implementação (revisado)

1. `manifest.json`: **remover `commands`** (sem atalho). Mantém `action`/popup.
2. `store.js`: config, tokens, mapa CR→MAL, CRUD de mapeamentos. *(já existe, revisar)*
3. `mal.js`: OAuth PKCE, refresh, `searchAnime` (com capa), `getListStatus`,
   `updateEpisodes`, `parseMalUrl` (extrai id de URL/ID colado). *(revisar/expandir)*
4. `content.js`: extração + resposta ao background. *(já existe, revisar)*
5. `background.js`: só orquestração leve (ler episódio, ler/gravar MAL, CRUD mapa);
   toda a UI de decisão migra pro popup. *(revisar)*
6. `popup.html/js`: **reescrever como a máquina de estados acima** (1→5), com busca,
   colagem de URL, ajuste de episódio, progresso atual e gestão de mapeamentos.
7. `README.md`: carregar unpacked, registrar app no MAL, configurar redirect URI.

## Verificação (ponta a ponta)

- Carregar unpacked (`chrome://extensions` → Load unpacked).
- Registrar app no MAL com o redirect URI mostrado no popup; colar Client ID; login.
- Episódio no CR → clicar no ícone:
  - Temporada nova → Estado 3: buscar/colar URL, ajustar nº, escolher, gravar.
  - Conferir no site do MAL que gravou no anime certo com o nº certo.
  - Mesmo anime, outro episódio → Estado 2: mostra progresso atual, grava com um clique.
  - Testar fallback de URL colada; testar re-mapear e apagar; testar regra de retrocesso.
- Erros: token expirado (refresh), busca sem resultado (cai no colar URL), fora de /watch/.

## Fora de escopo (por ora)

- Jellyfin (coberto pelo `jellyfin-ani-sync`).
- Detecção automática de fim de episódio (gatilho é o botão, por decisão).
- Rewatch / score / notas no MAL.
- Publicar na Chrome Web Store (uso pessoal, unpacked basta).
