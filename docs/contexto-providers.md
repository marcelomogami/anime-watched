# Contexto e Plano — Camada de providers (MAL + AniList selecionável)

## Contexto

Hoje a extensão fala só com o MyAnimeList — `mal.js`, `background.js` e `store.js`
são todos acoplados diretamente à API do MAL (OAuth PKCE, endpoints REST,
`num_watched_episodes`, etc.).

O gatilho pra essa mudança foi discutir o Prime Video: ele traduz muito o nome do
anime na própria página, o que dificulta achar o título certo buscando direto no
MAL (a busca do MAL não tem sinônimos multilíngue). O AniList resolve isso melhor
— tem um campo `synonyms` curado pela comunidade e a maioria das entradas já tem
`idMal` preenchido — mas trocar o MAL pelo AniList de vez jogaria fora uma
integração que já funciona bem hoje (OAuth, busca, gravação de progresso, "plan to
watch", tudo implementado e testado).

**Decisão-chave:** em vez de migrar, o backend de tracking vira **escolhível**.
O usuário configura qual provider quer usar; a extensão passa a falar com um
`provider` genérico em vez de `mal.js` direto. O MAL continua existindo como
primeira implementação; o AniList entra como segunda.

Isso também resolve o problema original do Prime Video como efeito colateral: se o
usuário escolher o AniList como provider, a busca já passa a ser feita lá (com
sinônimos), sem precisar de nenhum mecanismo extra de cross-reference.

## Nomenclatura (decidida)

- **provider** — backend de tracking/lista (MAL, AniList, ...). É "onde grava o
  progresso" e "de onde vem a busca do anime".
- **source** — plataforma de vídeo de onde a extensão extrai metadata do anime
  (Crunchyroll, Prime Video). Era `content.js` / `content-pv.js`; renomeado pra
  `sources/crunchyroll.js` / `sources/primevideo.js` (simétrico à pasta
  `providers/`) já dentro desta mudança.

Os dois eixos são independentes: qualquer source deve poder gravar em qualquer
provider.

## Decisões já fechadas

- **Um provider ativo por vez pra gravação, sem sincronização paralela.** A
  extensão não escreve progresso nos dois ao mesmo tempo — o usuário escolhe
  qual está ativo, e é só esse que recebe `updateEpisodes`/`setPlanToWatch`
  novos. Isso é só sobre *escrita de progresso*; o *vínculo* (qual anime no MAL
  corresponde a qual anime no AniList, pra uma mesma série do Crunchyroll/Prime
  Video) pode existir pros dois ao mesmo tempo — ver "Mapeamento multi-provider"
  abaixo, é o que evita ter que remapear toda vez que troca de provider ativo.
- **Migração de histórico (progresso já gravado no MAL) é responsabilidade do
  usuário, fora da extensão.** Se ele trocar o provider ativo pra AniList e
  quiser levar o que já tinha, usa o import nativo do próprio AniList
  (`anilist.co/settings/import`, aceita XML exportado do MAL) uma vez, fora da
  extensão. Não há necessidade de construir nenhum mecanismo de sync/migração
  de progresso dentro do código — só a migração de *formato* dos mapeamentos
  salvos localmente (ver `store.js` abaixo) é responsabilidade da extensão.

## Estado atual — o que está acoplado ao MAL

| Arquivo | Acoplamento |
|---|---|
| `mal.js` (297 linhas) | Implementação inteira: OAuth PKCE, `searchAnime`, `getAnime`, `getListStatus`, `updateEpisodes`, `setPlanToWatch`, `parseMalId`. |
| `store.js:5-9` | `LOCAL_KEYS` só tem `mal_client_id`, `mal_client_secret`, `mal_tokens` — sem namespace por provider. |
| `store.js:11` | Mapeamento salvo com campos MAL-específicos: `malAnimeId`, `malTitle`, `malNumEpisodes` (visto em `popup.js:176-180`, `244-246`). |
| `background.js:5-15` | Importa e chama as funções do `mal.js` direto, sem indireção. |
| `popup.js:77` | `openMal()` monta URL hardcoded `myanimelist.net/anime/{id}`. |
| `popup.js:466-467`, `popup.html:173` | Botão `MAL ↗` com texto e handler hardcoded. |
| `manifest.json:8-13` | `host_permissions` só lista domínios do MAL. |

## Interface do provider (proposta)

Cada provider implementa o mesmo contrato — o roteador de mensagens do
`background.js` deixa de chamar `mal.js` e passa a chamar `providers[activeProvider]`:

```js
// providers/providerInterface.js (formato, não classe — cada provider exporta essas funções)
{
  id: 'mal' | 'anilist',

  // --- auth ---
  isLoggedIn(): Promise<boolean>,
  login(): Promise<void>,          // fluxo interativo (chrome.identity)
  logout(): Promise<void>,
  getAuthConfig(): Promise<{ clientId, clientSecret?, redirectUri }>, // pro estado 1 do popup
  setAuthConfig({ clientId, clientSecret? }): Promise<void>,

  // --- busca / identificação ---
  searchAnime(query, limit?): Promise<Candidate[]>,
  getAnime(id): Promise<Candidate>,
  parseId(input): number | null,   // extrai id de URL/id colado
  getDisplayUrl(id): string,       // pro botão "<Provider> ↗"

  // --- progresso ---
  getListStatus(id): Promise<{ numWatched, status, inList, numEpisodes, startDate, finishDate }>,
  updateEpisodes(id, numEpisodes, totalEpisodes?, dates?, completed?): Promise<void>,
  setPlanToWatch(id): Promise<void>,
}

// Candidate = { id, title, en, numEpisodes, mediaType, year, picture }
```

Esse shape é literalmente o que `mal.js` já expõe hoje — a interface nasce do
código existente, não de um design novo. `getAuthConfig`/`setAuthConfig`/`getDisplayUrl`
são os únicos acréscimos (hoje isso é implícito/hardcoded em `background.js` e
`popup.js`).

## Mudanças por arquivo

### `providers/mal.js` (era `mal.js`)

Vira a primeira implementação da interface. Nenhuma mudança de comportamento —
só expõe `id: 'mal'`, `getAuthConfig`/`setAuthConfig` (hoje isso é
`store.getClientId`/`getClientSecret`/`setClientId`/`setClientSecret` chamado
direto do `background.js`) e `getDisplayUrl` (hoje é a string montada em
`popup.js:77`).

### `providers/anilist.js` (novo)

- **Auth:** AniList usa Authorization Code Grant (`https://anilist.co/api/v2/oauth/authorize`)
  — mais simples que o PKCE do MAL, mas **precisa decidir**: grant com secret
  (token com refresh) ou implicit grant (`response_type=token`, token direto na
  URL, sem refresh — expira em ~1 ano e exige relogar). A ver na Fase 2, não
  bloqueia o desenho da interface.
- **API:** GraphQL único endpoint (`https://graphql.anilist.co`), diferente do
  REST do MAL — `searchAnime`/`getAnime`/`getListStatus`/`updateEpisodes` viram
  queries/mutations (`Media`, `SaveMediaListEntry`) em vez de chamadas REST, mas
  a *forma* que retornam pro resto da extensão é a mesma (`Candidate`, etc.).
- **IDs:** `mediaId` do AniList é numérico e **não é o mesmo número** que o
  `anime_id` do MAL — não dá pra reusar o mesmo campo de id sem indicar de qual
  provider ele é (ver seção de storage abaixo).

### `store.js` — namespacing, mapeamento multi-provider e migração

Hoje: `mal_client_id`, `mal_client_secret`, `mal_tokens` (chaves fixas,
`store.js:5-9`) e mapeamentos com `malAnimeId`/`malTitle`/`malNumEpisodes`
(`store.js:11`, formato definido em `popup.js:244-246`) — um provider fixo por
mapeamento, código embutido no nome dos campos.

**Auth** vira namespaced por provider: `auth/{providerId}/client_id`,
`auth/{providerId}/client_secret`, `auth/{providerId}/tokens`, mais um
`activeProvider` (`'mal'` por padrão) separado, indicando qual auth é usada
pra gravar progresso agora.

**Mapeamento vira multi-provider por chave.** Em vez de um `providerId` fixo
por entrada, cada mapeamento guarda um alvo por provider já resolvido:

```js
"map:GT00371630#S1": {
  crSeriesTitle: "Yomi no Tsugai",   // metadado da source, comum aos providers
  site: "crunchyroll",
  savedAt: 1752460800000,
  providers: {
    mal:     { animeId: 1234, title: "Yomi no Tsugai", numEpisodes: 24 },
    anilist: { animeId: 9484, title: "Yomi no Tsugai", numEpisodes: 24 }
  }
}
```

Ler um mapeamento pro provider ativo passa a ser
`mapping?.providers?.[activeProvider]` em vez do objeto inteiro. Se a chave do
provider ativo não existir ali (nunca foi mapeado com aquele provider), o
comportamento é **igual ao de "nunca mapeado"** hoje — cai no Estado 3
(busca/escolhe) — só que ao salvar, o resultado **entra como uma chave nova
dentro de `providers`**, sem tocar nas chaves de outros providers que já
existiam pra aquele mapeamento. Trocar de provider ativo nunca apaga nem
sobrescreve o vínculo que já existia com o provider anterior.

**Implementado (Fase 2), nos dois sentidos:** se falta a fatia do provider
ativo mas outro provider da mesma entrada já tem vínculo, tenta resolver
sozinho antes de cair na busca manual (`background.js:resolveSlice`, chamado
por cada provider via `findByCrossRef(otherProviderId, otherAnimeId)`).

- **MAL→AniList:** `providers/anilist.js:findByCrossRef` — busca direto
  `Media(idMal: <id do MAL>)`, já retorna os dados completos numa query só.
- **AniList→MAL:** o MAL não tem um `idAnilist` pra fazer o mesmo sozinho, mas
  o AniList guarda `id` e `idMal` no mesmo registro — então
  `providers/mal.js:findByCrossRef` usa o AniList como "ponte" só pra traduzir
  o id (`providers/shared.js:anilistIdToMalId`, `Media(id: <id do AniList>) {
  idMal }`, chamada pública sem autenticação) e depois busca os dados
  completos na própria API do MAL.

Resultado é persistido no primeiro acesso (por episódio ou pela tela de
mapeamentos), então só paga o custo da chamada extra uma vez por anime.

**Precisa de migração** dos mapeamentos já salvos (`chrome.storage.sync`) —
na primeira leitura depois do update, entradas no formato antigo (têm
`malAnimeId` solto, não têm `providers`) viram
`{ ...resto, providers: { mal: { animeId: malAnimeId, title: malTitle, numEpisodes: malNumEpisodes } } }`,
removendo os campos `mal*` soltos. Sem isso, todo mundo perde os mapeamentos
salvos ao atualizar.

### `background.js` — roteamento por provider ativo

O `switch` de mensagens (`background.js:60-144`) deixa de importar `mal.js`
direto; passa a resolver `const provider = providers[await store.getActiveProvider()]`
e chamar os métodos da interface. Mensagens novas: `GET_PROVIDER`,
`SET_ACTIVE_PROVIDER` (análogas a `SET_CLIENT_ID` hoje, mas indicando *qual*
provider está sendo configurado).

`GET_MAPPING`/`SAVE_MAPPING` (`background.js:95-97`, `111-114`) mudam de
"ler/gravar o mapeamento inteiro" pra "ler/gravar só a fatia do provider
ativo": `GET_MAPPING` retorna `mapping?.providers?.[activeProvider]` (mais os
metadados comuns tipo `crSeriesTitle`), e `SAVE_MAPPING` faz merge —
`store.setMapping` passa a ler o registro existente, atualizar só
`providers[activeProvider]` e regravar o objeto inteiro, em vez de
sobrescrever a chave toda como hoje (`store.js:77-79`).

### `popup.js` / `popup.html` — UI

- Botão `MAL ↗` (`popup.html:173`, `popup.js:466-467`) vira dinâmico:
  `${provider.label} ↗`, chamando `provider.getDisplayUrl(id)` em vez de
  `openMal()` hardcoded (`popup.js:77`). Como o mapeamento agora pode ter mais
  de um provider salvo, a tela de mapeamentos (`popup.js:453-467`) pode listar
  um botão `↗` por provider já vinculado (ex.: `MAL ↗` e `AniList ↗` lado a
  lado), não só o ativo.
- Estado 1 (configuração, hoje assume só MAL) ganha um seletor de provider
  antes dos campos de Client ID — trocar o provider ativo troca qual auth está
  sendo configurada.
- Resto da UI (busca, `targetArea`) já é agnóstico o suficiente — só o shape
  do mapeamento muda (ver storage acima), a UI sempre trabalha com a fatia
  `providers[activeProvider]` como se fosse o mapeamento inteiro de hoje.

### `manifest.json`

`host_permissions` (linhas 8-13) ganha `https://graphql.anilist.co/*` e
`https://anilist.co/*` quando a Fase 2 entrar.

## Fases (bumps separados, por unidade de trabalho)

1. **Fase 1 — extrair a interface, só com MAL por trás.** Refactor puro:
   `mal.js` → `providers/mal.js` implementando o contrato acima,
   `background.js` passa a rotear por `providers[activeProvider]` (mas só existe
   `'mal'`), `store.js` ganha o namespacing novo com migração das chaves antigas.
   **Sem mudança de comportamento visível** — só reorganização interna. Isso
   valida a interface contra o único provider real que já existe antes de
   escrever o segundo.
2. **Fase 2 — `providers/anilist.js` + seletor de provider na UI.** OAuth do
   AniList, GraphQL, botão dinâmico, `host_permissions` novo. Aqui sim é feature
   nova visível pro usuário.
3. **Fase 3 — revisitar Prime Video: validada, sem trabalho extra necessário
   (2026-07-15).** Testado ao vivo em `primevideo.com/detail/0GZCWV7IOJ8...`
   ("Katainaka no Ossan, Kensei ni Naru II") — a página mostra o título
   localizado em pt-BR ("De caipira a mestre espadachim"), e a busca no
   AniList (com provider ativo = AniList) achou os candidatos certos mesmo
   assim, graças aos `synonyms` multilíngue do AniList. Confirma a hipótese
   original que motivou toda essa mudança: **não precisa de nenhum mecanismo
   extra de cross-reference pro Prime Video** — só escolher o AniList como
   provider já resolve o problema de título traduzido que o MAL sozinho não
   resolvia.

## Perguntas em aberto (alinhar antes de começar a Fase 1)

1. **AniList: implicit grant (sem refresh) ou authorization code (com secret)?**
   Trade-off simplicidade × ter que relogar 1x/ano. Decidir na Fase 2, não
   bloqueia a Fase 1.
2. **Migração dos mapeamentos salvos** (formato interno `mal*` soltos →
   `providers: { mal: {...} }` aninhado, não o histórico de watch count):
   rodar automático na primeira leitura pós-update — decidido, ver seção
   `store.js` acima.

## Ideias futuras (fora de escopo agora)

- **Notificação de novo episódio via AniList.** `Media.nextAiringEpisode`
  (GraphQL) retorna `episode`, `airingAt` e `timeUntilAiring` — dá pra avisar
  quando um episódio novo sai, mas só funciona com o AniList como provider
  (o MAL não tem campo equivalente, então isso não entra na interface genérica
  do provider, seria exclusivo). Também exige um mecanismo novo de polling
  (`chrome.alarms`, já que o AniList não faz push) — não é extensão natural do
  tracking de progresso, é uma feature à parte. Só faz sentido avaliar depois
  da Fase 2 (AniList como provider) estar rodando de verdade.
