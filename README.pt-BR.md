# Anime Watched

*[Read this in English](README.md)*

Extensão de Chrome (Manifest V3) que grava, com um clique, o episódio que você acabou de
ver no **Crunchyroll** ou no **Prime Video** na sua lista do **MyAnimeList (MAL)**.

Sem servidor, sem backend: OAuth, chamadas ao MAL e o mapa de mapeamentos vivem inteiros
dentro da extensão (`chrome.storage`).

Interface disponível em **pt-BR** e **en** (o Chrome escolhe pelo idioma do navegador).

## Screenshots

| Episódio detectado → gravar | Buscar/escolher no MAL | Gestão de mapeamentos |
|---|---|---|
| ![Popup com episódio detectado e anime já mapeado](docs/screenshots/popup-main.png) | ![Popup com resultados de busca no MAL](docs/screenshots/popup-search.png) | ![Tela de gestão de mapeamentos salvos](docs/screenshots/popup-mappings.png) |

## Como funciona

1. **Crunchyroll:** numa página de episódio (`/watch/...`), a extensão lê do JSON-LD da
   página qual é a série, a temporada e o número do episódio. Na página da série
   (`/series/{id}/...`) — sem episódio aberto — lê o ID da série na URL e a temporada
   direto do seletor de temporada da própria página (`docs/cr-extraction.md`).
   **Prime Video:** com o player aberto, a extensão lê a série/temporada/episódio direto do
   overlay do player. Na página de detalhe (`/detail/{id}`) — sem o player aberto — lê a
   temporada e o título dos metadados da página; o próprio ID de detalhe já é por-temporada
   (`docs/pv-extraction.md`).
2. Você clica no ícone da extensão → o popup mostra o que foi detectado.
3. Na **primeira vez** de cada temporada, você casa a série com o anime certo no MAL (busca
   automática por título, ou colando a URL/ID do MAL).
4. A partir daí, duas opções:
   - **Gravar** — faz `PATCH` do `num_watched_episodes` no MAL (e **Finalizar** pra fechar
     a temporada).
   - **Para assistir** — salva o mapeamento sem gravar progresso nenhum. Se o anime ainda
     não estiver em nenhuma lista do MAL, também marca status `plan_to_watch` lá (0
     episódios); se já estiver numa lista, só o mapeamento local é salvo — o progresso
     existente nunca é tocado. Útil pra guardar algo que você ainda não começou a assistir,
     direto da página do próprio anime — sem que o Crunchyroll ou o Prime Video registrem o
     episódio como "aberto".

O mapeamento é guardado por **temporada**: no Crunchyroll, `crSeriesId#Stemporada` (ex.:
`GT00371630#S1`); no Prime Video, `pv:<detailId>` (ex.: `pv:0GZCWV7IOJ8M9624JD5A4HA66B`) —
cada temporada já tem o próprio `detail/<ID>` lá. Em ambos os casos resolve o caso comum de
uma temporada ser uma entrada separada no MAL.

## Instalação (unpacked)

1. Abra `chrome://extensions`.
2. Ative o **Modo do desenvolvedor** (canto superior direito).
3. **Carregar sem compactação** → selecione a pasta `extension/` deste repositório.
4. A extensão aparece na barra. Fixe o ícone se quiser.

> O ID da extensão (e portanto o Redirect URI) é estável enquanto a pasta não mudar de
> lugar. Se mover a pasta, o ID muda e o app do MAL precisa do novo Redirect URI.

## Registrar o app no MyAnimeList

1. Abra o popup da extensão e copie o **Redirect URI** mostrado
   (`https://<extension-id>.chromiumapp.org/`).
2. Vá em [myanimelist.net/apiconfig](https://myanimelist.net/apiconfig) →
   **Create ID**.
3. Preencha:
   - **App Type:** `web` — gera **Client ID** e **Client Secret** (o MAL exige o secret
     na troca do token). Se escolher `other`, é cliente público e não há secret.
   - **App Redirect URL:** cole o Redirect URI do passo 1
   - **App Description:** mínimo de 50 caracteres, sem caracteres especiais
   - Demais campos obrigatórios (nome, homepage, etc.): à vontade
4. Salve e copie o **Client ID** (e o **Client Secret**, se for app `web`).
5. No popup da extensão: cole o **Client ID** e o **Client Secret** → **Salvar
   credenciais** → **Login no MAL** e autorize.

O login usa OAuth2 com PKCE (método `plain`, exigência do MAL). O Client Secret (quando
existe) é digitado por você e fica apenas no `chrome.storage.local` da sua máquina — nunca
é embutido no código nem versionado.

## Uso

- **Crunchyroll:** abra um episódio (`/watch/...`) — ou só a página da série
  (`/series/...`), se você só quiser guardar pra depois — e clique no ícone da extensão.
- **Prime Video:** dê play no episódio, ou só abra a página de detalhe do anime
  (`/detail/...`) sem tocar nada, e clique no ícone da extensão.
- **Temporada nova:** busque/escolha o anime no MAL (ou cole a URL/ID) e depois:
  - ajuste o nº do episódio e clique em **Gravar** (ou **Finalizar** pra fechar a
    temporada), ou
  - clique em **Para assistir** pra guardar sem gravar progresso.
- **Temporada já mapeada:** o popup mostra o alvo no MAL e seu progresso atual; ajuste o nº
  se quiser e clique em **Gravar**.
- **Ver mapeamentos:** lista tudo que já foi mapeado, com um botão que abre a página do
  anime na plataforma de origem (**CR ↗** / **PV ↗**, colorido por plataforma), além das
  opções de abrir no MAL (**MAL ↗**), **re-mapear** ou **apagar**.
- **MAL ↗:** tanto na tela do episódio quanto na de mapeamentos, abre a página do anime no
  MyAnimeList numa aba nova.

### Detalhes de comportamento

- **Não retrocede sozinho:** se o MAL já marca um número maior que o episódio que você vai
  gravar, a extensão avisa e pede um segundo clique antes de reduzir.
- **Ajuste de episódio:** a numeração do Crunchyroll nem sempre bate com a do MAL (ex.:
  cour com numeração absoluta) — por isso o número é editável antes de gravar.
- **`status`:** vira `completed` quando o episódio atinge o total de episódios conhecido
  no MAL; senão fica `watching`.
- **Data de início automática:** ao gravar, se o progresso do MAL estiver em **0** (e o
  start date vazio), define o início como **hoje**. A trava é o progresso zerado, não o
  número do episódio — assim funciona mesmo quando o Crunchyroll usa numeração sequencial
  diferente do MAL (ex.: `E25` no CR = `S2E1` no MAL).
- **Data de fim automática:** ao completar a temporada (nº ≥ total do MAL, com finish date
  vazio), define o fim como **hoje**.
- **Botão "Finalizar":** marca `completed` + fim = **hoje** explicitamente, útil quando o
  MAL não conhece o total (simulcast/temporada em andamento). Ajusta o progresso para o
  total quando conhecido.
- **Nunca sobrescreve datas:** início e fim só são preenchidos quando estão vazios; uma
  data já existente no MAL é preservada.
- **"Para assistir" nunca sobrescreve progresso:** só define status `plan_to_watch` no MAL
  se o anime ainda não estiver em nenhuma lista. Se já estiver `watching`, `completed`
  etc., clicar nele só grava o mapeamento local — seu status/progresso no MAL fica
  intocado.
- **Sem progresso local:** a extensão não guarda cópia local de "episódios assistidos" —
  esse número sempre vive no MAL e é lido ao vivo de lá quando você abre o popup pra um
  anime já mapeado. O que fica salvo localmente (`chrome.storage`) é só o vínculo
  Crunchyroll/Prime Video ↔ MAL em si.

## Estrutura

```
extension/
  manifest.json
  _locales/
    pt_BR/messages.json  # strings da interface (idioma padrão)
    en/messages.json     # strings da interface (inglês)
  src/
    background.js   # orquestra: detecta o site, lê o episódio da aba, chama o MAL, guarda o mapa
    content.js      # roda no Crunchyroll: extrai série/temporada/episódio do JSON-LD
    content-pv.js   # roda no Prime Video: extrai série/temporada/episódio do overlay do player
    mal.js          # cliente da API do MAL (OAuth PKCE, busca, gravar progresso)
    store.js        # wrapper de chrome.storage (config, tokens, mapa de mapeamentos)
    popup.html/js   # a interface (máquina de estados), com strings via chrome.i18n
  icons/
docs/
  contexto.md                        # contexto e plano de implementação
  contexto-mapeamento-sem-gravar.md  # plano da feature "Para assistir"
  cr-extraction.md  # investigação das páginas de episódio/série do Crunchyroll (fonte da extração)
  pv-extraction.md  # investigação do player/página de detalhe do Prime Video (fonte da extração)
```

## Escopo atual

Crunchyroll e Prime Video (no Jellyfin, o plugin `jellyfin-ani-sync` já cobre). Sem
detecção automática de fim de episódio, sem score/rewatch, sem publicação na Chrome Web
Store — uso pessoal, carregado unpacked.
