# Changelog

Todas as mudanças relevantes deste projeto são documentadas aqui.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/)
e o projeto adota [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [0.3.1] — 2026-07-13

### Adicionado

- **`README.en.md`:** tradução completa do README para inglês, com screenshots próprias
  (`docs/screenshots/*-en.png`) geradas interceptando `chrome.i18n.getMessage` no popup
  pra servir o `en/messages.json` sem depender do idioma do navegador/SO. Links cruzados
  no topo dos dois READMEs (`Read this in English` / `Leia isso em português`).

## [0.3.0] — 2026-07-13

### Adicionado

- **Internacionalização (pt-BR + en):** interface do popup passa a usar `chrome.i18n`
  (`_locales/pt_BR/messages.json` e `_locales/en/messages.json`, 67 chaves). O Chrome
  escolhe o idioma sozinho pelo locale do navegador; `manifest.json` também usa
  `__MSG_extDescription__`. Strings dinâmicas (mensagens de erro, progresso, avisos) usam
  um helper `tr(key, vars)` com placeholders `{token}` — mais simples que o esquema nativo
  `$1`/`$2` do `chrome.i18n` pra mensagens com várias variáveis. Texto estático do HTML usa
  atributos `data-i18n`/`data-i18n-placeholder`/`data-i18n-title`/`data-i18n-html`,
  preenchidos no load do popup.

## [0.2.1] — 2026-07-12

### Adicionado

- **Badge de origem (CR/PV) na lista de mapeamentos:** cada mapeamento salvo agora grava um
  campo `site` (`cr`/`pv`), exibido como selo colorido antes do título. Mapeamentos salvos
  antes dessa mudança não têm o campo — cai no fallback de inferir pelo formato da chave
  (só existia Crunchyroll antes do suporte a múltiplos sites, então a ausência do prefixo
  `pv:` já identifica CR com segurança).
- Screenshots do popup (`docs/screenshots/`) referenciadas no README.

### Corrigido

- Título (H1) do README ainda estava com o nome antigo da extensão
  (`Crunchyroll/Prime Video → MyAnimeList`) — corrigido para **"Anime Watched"**.

## [0.2.0] — 2026-07-12

### Adicionado

- **Suporte ao Prime Video:** novo content script (`content-pv.js`) que extrai
  série/temporada/episódio direto do overlay do player (`.atvwebplayersdk-title-text` /
  `.atvwebplayersdk-episode-info`) — o Prime Video não navega para uma URL própria de
  player, então a extração exige o player aberto. Detalhes em `docs/pv-extraction.md`.
- **Roteamento por site no background:** `background.js` agora detecta o site da aba
  ativa (Crunchyroll ou Prime Video) e injeta/consulta o content script correspondente.
- **Mapeamento por temporada no Prime Video:** chave `pv:<detailId>` — cada temporada já
  tem seu próprio `detail/<ID>` na Amazon, então (diferente do CR) não precisa compor com
  o número da temporada.

### Alterado

- Nome da extensão passa a ser **"Anime Watched"** (mesmo nome do projeto), no lugar de
  `Crunchyroll/Prime Video → MyAnimeList`.
- Mensagens de "nenhum episódio detectado" no popup generalizadas por site
  (`NOT_SUPPORTED_SITE`, `NOT_A_WATCH_PAGE`, `NO_PLAYER_OPEN`).

### Corrigido

- **Título/subtítulo cortados na lista de candidatos do MAL:** `.candidate .title`/`.sub`
  usavam `white-space: nowrap` + `text-overflow: ellipsis`, truncando nomes longos (ex.:
  "Katainaka no Ossan, Kens..."). Trocado por quebra de linha (`overflow-wrap: break-word`)
  e popup alargado de 350px para 380px.

## [0.1.1] — 2026-07-11

### Adicionado

- **Datas de início e fim no MAL (automáticas):** ao gravar, define `start_date = hoje`
  quando o progresso do MAL está em 0 (robusto à numeração do Crunchyroll — ancora no
  watched, não no "episódio == 1") e `finish_date = hoje` ao completar a temporada
  (nº ≥ total). Só preenche datas vazias, nunca sobrescreve.
- **Botão "Finalizar":** marca `completed` + `finish_date = hoje` explicitamente, mesmo
  quando o MAL não conhece o total (simulcast/temporada em andamento). Ajusta o watched
  para o total quando ele é conhecido.
- **Progresso com datas:** a linha de progresso mostra início/fim (`início 2026-04-19`) e
  a mensagem de sucesso informa o que foi definido (`início hoje · fim hoje · concluído`).

## [0.1.0] — 2026-07-11

Primeira versão funcional. Extensão de Chrome (Manifest V3) que grava no MyAnimeList o
episódio assistido no Crunchyroll, pelo botão da extensão na barra.

### Adicionado

- **Extração no Crunchyroll:** lê série, temporada e número do episódio da página
  `/watch/` a partir do JSON-LD `TVEpisode` (fallback para `og:title`).
- **OAuth2 com o MyAnimeList:** login via `chrome.identity.launchWebAuthFlow` com PKCE
  (método `plain`, exigência do MAL) e renovação automática de token. Suporte a Client
  Secret para apps do tipo `web`.
- **Gravação de progresso:** `PATCH /v2/anime/{id}/my_list_status` com
  `num_watched_episodes`; marca `completed` ao atingir o total de episódios, senão
  `watching`.
- **Mapeamento CR→MAL:** tabela local (`chrome.storage`) com chave por temporada
  (`crSeriesId#Stemporada`), resolvendo o caso de uma temporada no CR ser uma entrada
  separada no MAL.
- **Interface (popup) como máquina de estados:** configuração inicial, detecção do
  episódio, busca no MAL com escolha de candidato, fallback de colar URL/ID do MAL,
  ajuste do número do episódio e leitura do progresso atual antes de gravar.
- **Gestão de mapeamentos:** listar, abrir no MAL (**MAL ↗**), re-mapear e apagar.
- **Guarda de retrocesso:** se o MAL já registra um número maior que o episódio a gravar,
  a extensão avisa e exige um segundo clique antes de reduzir o progresso.
- **Atalho para o MAL:** botão **MAL ↗** na tela do episódio e na de mapeamentos abre a
  página do anime no MyAnimeList.
- **Documentação:** `README.md`, `docs/contexto.md` (contexto e plano) e
  `docs/cr-extraction.md` (investigação da página do Crunchyroll).

### Notas

- Gatilho é **manual** pelo botão da extensão — sem atalho de teclado.
- Escopo restrito ao Crunchyroll; Jellyfin fica a cargo do `jellyfin-ani-sync`.
- Sem detecção automática de fim de episódio, sem score/rewatch, sem publicação na
  Chrome Web Store (uso pessoal, carregado unpacked).

[0.3.1]: https://github.com/marcelomogami/anime-watched/releases/tag/v0.3.1
[0.3.0]: https://github.com/marcelomogami/anime-watched/releases/tag/v0.3.0
[0.2.1]: https://github.com/marcelomogami/anime-watched/releases/tag/v0.2.1
[0.2.0]: https://github.com/marcelomogami/anime-watched/releases/tag/v0.2.0
[0.1.1]: https://github.com/marcelomogami/anime-watched/releases/tag/v0.1.1
[0.1.0]: https://github.com/marcelomogami/anime-watched/releases/tag/v0.1.0
