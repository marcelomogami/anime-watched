# Crunchyroll → MyAnimeList

Extensão de Chrome (Manifest V3) que grava, com um clique, o episódio que você acabou de
ver no **Crunchyroll** na sua lista do **MyAnimeList (MAL)**.

Sem servidor, sem backend: OAuth, chamadas ao MAL e o mapa Crunchyroll→MAL vivem inteiros
dentro da extensão (`chrome.storage`).

## Como funciona

1. Numa página `/watch/` do Crunchyroll, a extensão lê do JSON-LD da página qual é a
   série, a temporada e o número do episódio.
2. Você clica no ícone da extensão → o popup mostra o episódio detectado.
3. Na **primeira vez** de cada temporada, você casa a série do CR com o anime certo no MAL
   (busca automática por título, ou colando a URL/ID do MAL). Esse mapeamento fica salvo.
4. A partir daí, é só clicar em **Gravar** — a extensão faz `PATCH` do
   `num_watched_episodes` no MAL.

O mapeamento é guardado por **temporada** (`crSeriesId#Stemporada`, ex.: `GT00371630#S1`),
o que resolve o caso comum de uma temporada no CR ser uma entrada separada no MAL.

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

- Abra um episódio no Crunchyroll e clique no ícone da extensão.
- **Temporada nova:** busque/escolha o anime no MAL (ou cole a URL/ID), ajuste o nº do
  episódio se precisar, e clique em **Gravar**.
- **Temporada já mapeada:** o popup mostra o alvo no MAL e seu progresso atual; ajuste o nº
  se quiser e clique em **Gravar**. Para fechar a temporada, use **Finalizar**.
- **Ver mapeamentos:** lista tudo que já foi mapeado, com opção de abrir no MAL
  (**MAL ↗**), **re-mapear** ou **apagar**.
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

## Estrutura

```
extension/
  manifest.json
  src/
    background.js   # orquestra: lê o episódio da aba, chama o MAL, guarda o mapa
    content.js      # roda no Crunchyroll: extrai série/temporada/episódio do JSON-LD
    mal.js          # cliente da API do MAL (OAuth PKCE, busca, gravar progresso)
    store.js        # wrapper de chrome.storage (config, tokens, mapa CR→MAL)
    popup.html/js   # a interface (máquina de estados)
  icons/
docs/
  contexto.md       # contexto e plano de implementação
  cr-extraction.md  # investigação da página /watch/ do Crunchyroll (fonte da extração)
```

## Escopo atual

Só Crunchyroll (no Jellyfin, o plugin `jellyfin-ani-sync` já cobre). Sem detecção
automática de fim de episódio, sem score/rewatch, sem publicação na Chrome Web Store —
uso pessoal, carregado unpacked.
