# Anime Watched

*[Read this in English](README.md)*

Extensão de Chrome (Manifest V3) que grava, com um clique, o episódio que você acabou de
ver no **Crunchyroll** ou no **Prime Video** direto na sua lista real do **AniList** — sem
mapeamento manual, sem backend de tracking separado pra configurar.

Sem servidor, sem backend: OAuth e as chamadas à API do AniList vivem inteiras dentro da
extensão (`chrome.storage`). Suas listas Watching/Plan to Watch do AniList *são* o dado — a
extensão só lê e grava nelas direto.

Interface disponível em **pt-BR** e **en** (o Chrome escolhe pelo idioma do navegador).

## Screenshots

*(capturas em inglês — a interface em português tem o mesmo layout, só com os textos
traduzidos)*

| Sua lista, de relance | Detalhes do anime — gravar, pausar, dropar | Anime novo? Só buscar |
|---|---|---|
| ![Popup mostrando a lista Watching, com barra de progresso e contagem regressiva](screenshots/popup-panel-en.png) | ![Popup mostrando a tela de detalhes de um anime, com progresso, status e botões de ação](screenshots/popup-detail-en.png) | ![Popup mostrando resultados de busca do AniList pra um anime novo](screenshots/popup-search-en.png) |

## Como funciona

O popup é uma pequena máquina de estados que reage à aba ativa, e sempre lê e grava direto
nas suas **listas reais do AniList** — não existe tabela de mapeamento local fazendo esse
papel.

1. **Extração (por source):**
   - **Crunchyroll:** numa página de episódio (`/watch/...`), lê do JSON-LD da página qual
     é a série, a temporada e o número do episódio. Na página da série (`/series/{id}/...`)
     — sem episódio aberto — lê o ID da série na URL e a temporada direto do seletor de
     temporada da própria página.
   - **Prime Video:** com o player aberto, lê a série/temporada/episódio direto do overlay
     do player. Na página de detalhe (`/detail/{id}`) — sem o player aberto — lê a
     temporada e o título dos metadados da página; o próprio ID de detalhe já é
     por-temporada.
2. **Casamento com suas listas:** a extensão mantém um cache local de toda a sua coleção do
   AniList (Watching/Plan to Watch/etc. — `MediaListCollection`, atualizado sozinho a cada
   ~1 semana ou sob demanda). O que é detectado na página é comparado contra esse cache —
   principalmente pelo link de streaming que o AniList tem cadastrado pro anime
   (`externalLinks`), com um fallback por título quando esse link está ausente ou
   desatualizado (ver [Limitações conhecidas](#limitações-conhecidas)).
3. Ao clicar no ícone da extensão, dependendo da página e se achou ou não uma
   correspondência, uma de quatro telas aparece:
   - **Nenhuma correspondência:** busca direto no AniList (por título, ou colando uma
     URL/ID) e você escolhe o anime certo. Escolher a partir da página do anime/série
     adiciona como **Para assistir** (0 episódios — essa página nunca tem um número de
     episódio pra capturar progresso de verdade); escolher a partir da página de episódio já
     grava como **Assistindo**, com o progresso daquele episódio.
   - **Nenhuma página relevante aberta:** o **painel de lista** — abas Assistindo / Para
     assistir, cada card mostrando progresso, contagem regressiva pro próximo episódio
     quando ainda está no ar, e um badge de source que abre direto o Crunchyroll/Prime
     Video.
   - **Página do anime/série, já numa lista:** a **tela de detalhes** — progresso
     (editável), Gravar, Para assistir, Pausar, Dropar, links pro AniList e pra plataforma
     de origem.
   - **Página de episódio, anime já reconhecido:** a **tela rápida** — o número do episódio
     detectado, pronto pra gravar com um clique; um botão **Detalhes** leva pra tela
     completa pra qualquer outra coisa (pausar, dropar, etc.).

## Instalação (unpacked)

1. Abra `chrome://extensions`.
2. Ative o **Modo do desenvolvedor** (canto superior direito).
3. **Carregar sem compactação** → selecione a pasta `extension/` deste repositório.
4. A extensão aparece na barra. Fixe o ícone se quiser.

> O ID da extensão (e portanto o Redirect URI) é estável enquanto a pasta não mudar de
> lugar. Se mover a pasta, o ID muda e o app do AniList precisa do novo Redirect URI.

## Registrar o app no AniList

1. Abra o popup da extensão e copie o **Redirect URI** mostrado na tela de login.
2. Vá em [anilist.co/settings/developer](https://anilist.co/settings/developer) →
   **Create New Application**.
3. Preencha um nome e cole o Redirect URI do passo 1.
4. Salve e copie o **Client ID** (sem secret — o login do AniList usa o fluxo Implicit
   Grant: a extensão recebe o token direto, sem etapa de troca no servidor).
5. No popup da extensão: cole o **Client ID** → **Salvar credenciais** → **Login no
   AniList** e autorize.

Os tokens de acesso do AniList duram cerca de um ano e não têm renovação automática —
quando expirar, é só logar de novo.

## Notas de segurança

O `chrome.storage.local` — onde a autenticação (Client ID, token de acesso) e o cache
local da lista ficam — não é criptografado em disco; é LevelDB puro. Fica isolado de
outras extensões e de qualquer site que você visite, mas não de qualquer coisa com acesso
de leitura local ao seu perfil do Chrome (malware, outro usuário do sistema, etc.).

Se em algum momento suspeitar que um token vazou, revogue o acesso direto em
[anilist.co/settings/developer](https://anilist.co/settings/developer) — isso invalida na
hora, sem precisar mexer na extensão.

## Uso

- **Crunchyroll:** abra um episódio (`/watch/...`) — ou só a página da série
  (`/series/...`), se você só quiser guardar pra depois — e clique no ícone da extensão.
- **Prime Video:** dê play no episódio, ou só abra a página de detalhe do anime
  (`/detail/...`) sem tocar nada, e clique no ícone da extensão.
- **Anime novo:** busque/escolha no AniList (ou cole a URL/ID); o destino (Para assistir vs.
  Assistindo + progresso) depende se você veio da página do anime ou de um episódio.
- **Já está numa lista:** o popup mostra a tela certa automaticamente — gravação rápida pra
  um episódio reconhecido, ou a tela de detalhes completa a partir da página do próprio
  anime.
- **Nenhuma página relevante aberta:** o painel de lista — abas Assistindo / Para assistir,
  com um botão manual **⟳ re-sync** ao lado das configurações caso queira puxar mudanças
  feitas fora da extensão na hora.

### Detalhes de comportamento

- **Não retrocede sozinho:** se o AniList já marca um número maior que o episódio que você
  vai gravar, a extensão avisa e pede um segundo clique antes de reduzir.
- **Ajuste de episódio:** a numeração do Crunchyroll nem sempre bate com a do AniList (ex.:
  cour com numeração absoluta) — por isso o número é editável antes de gravar.
- **Data de início automática:** ao gravar, se o progresso estiver em **0** (e o start date
  vazio), define o início como **hoje**. A trava é o progresso zerado, não o número do
  episódio — assim funciona mesmo quando o Crunchyroll usa numeração sequencial diferente da
  do AniList (ex.: `E25` no CR = `S2E1` lá).
- **Conclusão automática:** o anime completa sozinho — status vira `Completed`, data de fim
  = **hoje** — quando o progresso bate o total de episódios conhecido. Não existe um botão
  "Finalizar" separado pro caso raro de total desconhecido (ex.: simulcast em andamento) —
  lacuna conhecida, não portada da arquitetura anterior.
- **Nunca sobrescreve datas:** início e fim só são preenchidos quando estão vazios; uma data
  já existente no AniList é preservada.
- **Sair de "outras listas" (Completo/Dropado/Pausado/Reassistindo) pede confirmação:**
  gravar progresso ou escolher Para assistir num anime que está atualmente numa dessas
  mostra um aviso com a lista atual primeiro — clique de novo pra confirmar a mudança. Ir de
  Para assistir pra Assistindo é progressão natural e nunca pede confirmação.
- **Sem progresso local:** a extensão não guarda cópia própria de "episódios assistidos" —
  o progresso sempre vive no AniList. O que fica em cache localmente
  (`chrome.storage.local`) é uma cópia de leitura das suas listas, atualizada sozinha
  (a cada ~1 semana, ou manualmente via **⟳**) e corrigida na hora sempre que a própria
  extensão grava alguma coisa.

## Limitações conhecidas

- **O casamento com o Crunchyroll pode falhar pra anime com link desatualizado no
  AniList.** O reconhecimento funciona principalmente casando o ID de série da URL da
  página contra o link de Crunchyroll que o AniList tem cadastrado (`externalLinks`). Uma
  conferência real contra a lista de um usuário achou **202 de 326** links de Crunchyroll
  ainda no formato pré-2018 (`crunchyroll.com/<slug>`, sem ID de série) — esses nunca batem
  por ID. Um fallback por título (comparação exata contra o romaji/inglês ou os sinônimos
  do AniList) cobre a maioria desses casos, mas ainda pode falhar se o título da página do
  Crunchyroll não bater exatamente com nenhum dos três (tradução/grafia diferente). Quando
  isso acontece, o popup cai na tela de busca mesmo o anime já estando na sua lista — é só
  buscar e escolher de novo, não cria duplicata.

## Estrutura

```
extension/
  manifest.json
  _locales/
    pt_BR/messages.json  # strings da interface (idioma padrão)
    en/messages.json     # strings da interface (inglês)
  src/
    background.js  # orquestra: detecta a source, lê o episódio da aba, resolve qual dos 4 estados mostrar, fala com o AniList
    sources/
      crunchyroll.js  # extrai série/temporada/episódio do JSON-LD do Crunchyroll
      primevideo.js   # extrai série/temporada/episódio do overlay do player do Prime Video
    providers/
      anilist.js  # cliente da API do AniList (OAuth Implicit Grant, busca/lista/gravação via GraphQL)
    store.js       # wrapper de chrome.storage (autenticação, cache local da lista, resolução CR/PV → AniList)
    popup.html/js  # a interface (máquina de estados), com strings via chrome.i18n
  icons/
docs/            # notas de design internas (pt-BR), uma pasta por versão major
```

## Escopo atual

Crunchyroll e Prime Video como sources; AniList como único backend de tracking. Sem
detecção automática de fim de episódio, sem score/rewatch, sem publicação na Chrome Web
Store — uso pessoal, carregado unpacked.

## Licença

[MIT](LICENSE) — feito pra uso pessoal, mas fique à vontade pra usar, forkar ou
aproveitar pedaços.
