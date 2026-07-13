# Extração de dados do player do Prime Video

Investigado ao vivo em 2026-07-12, com Chrome real (via MCP playwright `--browser
chrome`) — o Firefox Nightly usado antes não tem Widevine/DRM instalado e trava o
playback. Testado em:

- `https://www.primevideo.com/region/na/detail/0GMSR5WMNJ6EMYQRQ6Y2587WAF`
  ("De Caipira a Mestre Espadachim", T1)
- `https://www.primevideo.com/region/na/detail/0GZCWV7IOJ8M9624JD5A4HA66B`
  ("De Caipira a Mestre Espadachim II", T2)

## Diferença estrutural fundamental vs. Crunchyroll

O Prime Video **não navega para uma URL de player**. Ao clicar em "Reproduzir", o
player abre como **overlay SPA sobre a própria página `/detail/...`** — a URL não
muda. Isso significa que a estratégia do content script do Crunchyroll (disparar no
`tabs.onUpdated`/match de URL `*watch*`) **não funciona aqui**. É preciso observar o
DOM (`MutationObserver`) para detectar quando o player é montado/desmontado.

## Fonte primária: elementos `.atvwebplayersdk-*` no DOM do overlay

O player injeta elementos com classes de prefixo estável `atvwebplayersdk-*`
(nomenclatura oficial do SDK da Amazon, não hash de build), visíveis assim que o
playback começa:

```html
<div class="atvwebplayersdk-title-text f52hj7o f17cfskt">
  De Caipira a Mestre Espadachim
</div>
<div class="atvwebplayersdk-episode-timing-container f1hbonsi fqjgbtm f1anzkua">
  <span class="atvwebplayersdk-episode-info f6gi9c2">
    T2 Ep.1 O Caipira Assume um Novo Cargo
  </span>
</div>
```

### Campos que usamos

| Dado | De onde | Exemplo |
|------|---------|---------|
| `seriesTitle` | `.atvwebplayersdk-title-text` (texto puro) | `De Caipira a Mestre Espadachim` (**sem** sufixo de temporada, ex. sem "II") |
| `seasonNumber` + `episodeNumber` + `episodeTitle` | `.atvwebplayersdk-episode-info`, regex `/^T(\d+)\s*Ep\.(\d+)\s*(.*)$/` | `T2 Ep.1 O Caipira Assume um Novo Cargo` → temporada `2`, episódio `1`, título `O Caipira Assume um Novo Cargo` |
| `pvDetailId` | ID na URL `/detail/<ID>` da página (não muda com o overlay) | `0GZCWV7IOJ8M9624JD5A4HA66B` |

### Chave de mapeamento PV→MAL

Cada temporada tem o **próprio `/detail/<ID>`** (confirmado: T1 = `0GMSR5WMNJ6EMYQRQ6Y2587WAF`,
T2 = `0GZCWV7IOJ8M9624JD5A4HA66B`, ligados entre si pelo seletor de temporada da página
de detalhe, não pela URL). Diferente do CR, aqui o próprio ID de detalhe **já é
por-temporada**, então a chave de mapeamento pode ser direta:

```
pvDetailId   →   ex.: "0GZCWV7IOJ8M9624JD5A4HA66B"
```

Não precisa compor com `seasonNumber` como no CR, porque o `detail/<ID>` do PV já é
por temporada. `num_watched_episodes` no MAL usa o `episodeNumber` extraído do overlay
(numeração dentro da temporada, como no CR).

## Fonte alternativa: query params de rede (GTI)

Toda requisição de playback (`GetVodPlaybackResources`, `GetWidevineLicense`,
`playerChromeResources`, `StartSession`/`UpdateSession`, todas em
`atv-ps.primevideo.com`) carrega `titleId=amzn1.dv.gti.<uuid>` — o GTI da Amazon,
equivalente ao `crSeriesId`. Também aparece via `serviceToken.gti` (JSON, url-encoded)
na chamada `swift/page/xrayVOD`. **Não foi necessário usar isso** — o DOM já resolve
tudo — mas fica registrado como fallback/cross-check caso o DOM mude:

- GTI do episódio específico (`GetVodPlaybackResources` mais recente, corpo
  `playbackData.result.contentId`) difere do GTI "canônico" da temporada/série (o que
  aparece em `enrichItemMetadata`/links "Assista sem anúncios" da página de detalhe).
- Extrair isso exigiria interceptar `fetch`/`XHR` (via `chrome.webRequest` ou
  monkey-patch de `fetch` injetado pelo content script) — mais complexo que ler o DOM.
  Só vale a pena se o `.atvwebplayersdk-*` deixar de existir em algum device/skin.

## Observações de implementação

- **DRM exige Chrome real.** Firefox Nightly (usado inicialmente no MCP playwright)
  não tem Widevine instalado — o playback trava em "Nightly is installing
  components...". Precisa `--browser chrome` (`google-chrome-stable`, perfil separado).
- **Sem navegação de URL:** trigger do content script não pode ser
  `chrome.tabs.onUpdated` com match de URL. Precisa `MutationObserver` no `document`
  (ou polling curto) esperando `.atvwebplayersdk-episode-info` aparecer/mudar de texto
  — tanto na abertura do player quanto ao trocar de episódio dentro do mesmo overlay
  (autoplay do próximo episódio, por exemplo).
- **Overlay pode ser fechado sem sair da página:** botão "Fechar reprodutor" remove o
  player do DOM mas mantém a URL em `/detail/...`. O `MutationObserver` deve tratar o
  desaparecimento do elemento como "parou de assistir", não como erro.
- **Título da série sem sufixo de temporada:** `.atvwebplayersdk-title-text` traz
  "De Caipira a Mestre Espadachim" tanto para T1 quanto para T2 (a "II" não aparece
  ali — só na página de detalhe/breadcrumb). Pra busca no MAL, isso é aceitável (mesmo
  padrão do CR: título "bom o suficiente", usuário confirma o candidato certo).
- **Título de teste T2 só tinha 1 episódio disponível** no momento do teste (lançamento
  contínuo, "7 de jul. de 2026") — suficiente para confirmar o padrão, mas não testamos
  ainda a transição entre episódios consecutivos dentro do mesmo overlay (autoplay).

## Extração na página de detalhe (`/detail/{id}`, sem abrir o player)

Investigado ao vivo em 2026-07-13 (Playwright), pra viabilizar mapear um anime sem
abrir o player (que a plataforma registra como "começado"). Testado nas mesmas
duas URLs de T1/T2 usadas acima.

Diferente do CR, aqui **não precisa do player pra nada**: o `pvDetailId` já vem
da própria URL (como sempre), e a página de detalhe sozinha já expõe temporada +
título via `<meta name="title">` (não é `og:title` — é um `<meta name="title">`
simples):

```html
<meta name="title"
      content="Assista à temporada 1 de De Caipira a Mestre Espadachim – Prime Video">
```

Confirmado em T1 (`"...temporada 1..."`) e T2 (`"...temporada 2..."`) — o número
bate com o `pvDetailId` de cada URL. Regex (locale pt-BR):
`/temporada\s+(\d+)\s+de\s+(.+?)\s+–\s+Prime Video$/i` → temporada + título limpo,
sem sufixo (equivalente ao `.atvwebplayersdk-title-text` do player, mas sem
precisar abrir nada).

**Cuidado de locale:** essa frase é montada no idioma da própria página da
Amazon (o mesmo servida pro `region=na` no teste), não no idioma da UI da
extensão — em inglês provavelmente vira algo como `"Watch season 1 of ... -
Prime Video"`. A extração final precisa de um regex tolerante a pelo menos
pt-BR/en, ou usar só o dígito da temporada (`/(\d+)/` isolado após validar que a
frase é sobre temporada) como fallback mais robusto a variações de fraseado.

Como o `pvDetailId` já é por-temporada (não precisa compor com `seasonNumber`
pra formar a chave, só usa o número pra exibição/confirmação), esse dado nem é
estritamente necessário pro mapeamento em si — é mais uma checagem de sanidade
e fonte de título pra busca no MAL.
