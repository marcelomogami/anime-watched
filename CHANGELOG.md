# Changelog

Todas as mudanças relevantes deste projeto são documentadas aqui.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/)
e o projeto adota [Versionamento Semântico](https://semver.org/lang/pt-BR/).

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
- **Documentação:** `README.md`, `docs/PLAN.md` (plano) e `docs/cr-extraction.md`
  (investigação da página do Crunchyroll).

### Notas

- Gatilho é **manual** pelo botão da extensão — sem atalho de teclado.
- Escopo restrito ao Crunchyroll; Jellyfin fica a cargo do `jellyfin-ani-sync`.
- Sem detecção automática de fim de episódio, sem score/rewatch, sem publicação na
  Chrome Web Store (uso pessoal, carregado unpacked).

[0.1.0]: https://github.com/marcelomogami/anime-watched/releases/tag/v0.1.0
