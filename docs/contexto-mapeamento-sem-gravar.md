# Contexto e Plano — "Plan to watch": mapear anime sem gravar progresso

## Problema

Marcelo quer usar a tela de "mapeamentos salvos" da extensão como um **lançador
rápido**: vê a lista toda dos animes que está acompanhando, clica no que quer ver
agora, e o botão `CR ↗` / `PV ↗` (já implementado) abre a página certa na
plataforma de origem.

Isso já funciona bem — **exceto** para animes que ele ainda não começou a assistir.
Hoje, a única forma de um anime entrar na lista de mapeamentos é gravando progresso
no MAL:

- `writeToMal()` (`extension/src/popup.js:316-361`) sempre chama `UPDATE_EPISODES`
  (grava episódio no MAL) e, na sequência, `SAVE_MAPPING` (grava o vínculo local
  CR/PV↔MAL).
- O único caminho que grava **só** o mapeamento, sem tocar em episódio/MAL, é o
  fluxo `remapOnly` (`popup.js:235-251`) — mas ele só existe pra **trocar** o
  mapeamento de uma entrada que já existe (acessado pelo botão "re-mapear" na
  lista). Não há como usá-lo pra criar uma entrada nova.

Resultado: se o anime está no episódio 1, nunca assistido, e Marcelo só quer
"guardar" ele na lista pra assistir depois, a extensão não deixa — ele seria
forçado a gravar progresso (episódio 0 ou 1) no MAL só pra conseguir o atalho.

## Decisões já fechadas

1. **Rótulo do botão: localizado** — `en: "Plan to watch"` (nome do status no
   MAL), `pt_BR: "Para assistir"` (mais natural que tradução literal). Diferente
   do `MAL ↗` (que fica hardcoded/não traduzido), esse aqui usa o mecanismo de
   i18n normal da extensão.
2. **Depois de clicar:** vai direto pra tela de mapeamentos, mesmo comportamento
   que "re-mapear" já tem hoje. Se não ficar bom na prática, ajusta depois.
3. **Reflete no MAL de verdade:** se o anime **não estiver em nenhuma lista ainda**
   (nem watching, nem completed, etc.), o botão também grava status
   `plan_to_watch` lá no MAL — não é só um bookmark local. Se já estiver em
   qualquer lista, **não mexe no status** (só grava o vínculo local); não faz
   sentido sobrescrever progresso real por "plan to watch".
4. **As duas origens ficam disponíveis:** a página geral do anime (preferida,
   evita registrar "aberto" na plataforma) **e** a página de episódio/player
   (continua funcionando, sem remoção).

Isso muda o nome/escopo da função central: não é mais "salvar só localmente", é
"marcar como plan to watch" — pode envolver uma chamada real à API do MAL.

## Proposta

### 1. `mal.js` — novo helper pra status sem progresso

`updateEpisodes()` (`extension/src/mal.js:247-277`) sempre manda
`num_watched_episodes` e deriva status só entre `watching`/`completed`. Precisa de
uma função irmã, algo como:

```js
// status "plan_to_watch", sem episódios assistidos, sem datas.
export async function setPlanToWatch(animeId) {
  const body = new URLSearchParams({
    num_watched_episodes: '0',
    status: 'plan_to_watch',
  });
  const res = await authedFetch(`${API}/anime/${animeId}/my_list_status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Falha ao gravar no MAL (${res.status}): ${t}`);
  }
  return res.json();
}
```

### 2. `background.js` — novo tipo de mensagem

Um `PLAN_TO_WATCH` (paralelo ao `UPDATE_EPISODES` em `background.js:124`) que
chama `mal.setPlanToWatch(animeId)`.

### 3. `popup.js` — função `planToWatch()`

Substitui a ideia anterior de `saveMappingOnly()`. Reaproveita o `currentTarget`
já carregado por `selectTarget()` (que já chama `GET_LIST_STATUS` e preenche
`currentTarget.inList`, ver `popup.js:270-283`):

```js
async function planToWatch() {
  if (!currentTarget.inList) {
    const resp = await send({ type: 'PLAN_TO_WATCH', animeId: currentTarget.id });
    if (!resp.ok) {
      setMsg(resp.error || tr('errFailedToSave'), 'err');
      return;
    }
  }
  await send({
    type: 'SAVE_MAPPING',
    mapKey: currentEpisode.mapKey,
    value: {
      malAnimeId: currentTarget.id,
      malTitle: currentTarget.title,
      malNumEpisodes: currentTarget.total || 0,
      crSeriesTitle: currentEpisode.seriesTitle,
      site: currentEpisode.site,
      savedAt: Date.now(),
    },
  });
  setMsg(tr('mappedTo', { title: currentTarget.title }), 'ok');
  openMappings();
}
```

O bloco de `SAVE_MAPPING` já existe duplicado em `remapOnly` (`popup.js:236-248`)
e em `writeToMal` (`popup.js:331-343`) — vale extrair pra um helper único que os
três caminhos chamam, em vez de mais uma cópia.

### 4. Botão novo em `targetArea`

Ao lado de "Gravar" / "Finalizar" (`popup.html:167-170`): botão com
`data-i18n="planToWatchBtnLabel"` (ver i18n abaixo), chama `planToWatch()`.

### 5. i18n

Nova chave (ex.: `planToWatchBtnLabel`) em `_locales/pt_BR/messages.json`
(`"Para assistir"`) e `_locales/en/messages.json` (`"Plan to watch"`), seguindo
o padrão de `saveBtnLabel` / `changeAnimeBtn` — botão usa `data-i18n`, igual o
resto da UI (diferente do `MAL ↗`, que é o único rótulo hardcoded hoje).

## Fluxo completo, ponta a ponta

**Origem A — página do anime (preferida):**

1. Marcelo abre a página que lista os episódios — `/series/...` no CR,
   `/detail/...` no PV — **sem** abrir um episódio específico nem o player.
   Evita que a plataforma registre "aberto/começado" pra um anime que ele nem
   assistiu ainda.
2. Sem mapeamento existente → busca (`pickArea`) → escolhe o anime certo →
   `targetArea`.
3. Clica "Plan to watch" em vez de "Gravar".
4. Se o anime não estava em nenhuma lista do MAL, a extensão grava status
   `plan_to_watch` lá (0 episódios assistidos). Se já estava (watching,
   completed, etc.), não mexe no status.
5. Grava o vínculo local e volta pra tela de mapeamentos — o anime já aparece
   com `CR ↗` / `PV ↗` prontos.

**Origem B — página de episódio/player (mantida):**

Mesmo fluxo, mas partindo de `/watch/...` (CR) ou do player aberto (PV) — como
já funciona hoje pra "Gravar". O botão "Plan to watch" fica disponível ali
também.

## Extração precisa mudar: hoje só entende "episódio aberto"

Pra origem A funcionar, a extração precisa reconhecer a **página do anime** como
origem válida, além da página de episódio/player que já existe:

- **`content.js` (CR):** hoje só extrai em `/watch/...`
  (`extractNow()` checa `/\/watch\//.test(location.pathname)`,
  `extension/src/content.js:72`). Precisa reconhecer também `/series/{crSeriesId}/...`
  e extrair `crSeriesId` (trivial, vem da URL) + título da série (JSON-LD
  `TVSeries`) + temporada (`.season-info`, ver seção de investigação abaixo).
- **`content-pv.js` (PV):** hoje só extrai lendo o overlay do player
  (`.atvwebplayersdk-episode-info`, só existe com o player aberto,
  `extension/src/content-pv.js:14`). Como o `pvDetailId` já vem da própria URL
  `/detail/{id}` (confirmado em `docs/pv-extraction.md:43` — o ID já é
  por-temporada), a extração pela página de detalhe **não depende do player**:
  título + temporada vêm de `<meta name="title">` (ver seção de investigação
  abaixo), sem precisar do `.atvwebplayersdk-title-text`.
- **Popup (`popup.js`):** `showEpisode()` hoje sempre assume que existe um
  "episódio atual" (usa `episodeNumber`/`seasonNumber` pra montar o cabeçalho do
  `mainCard`, ex. `S{season} · ep {episode}`, `popup.js:154-156`). Precisa de um
  modo novo pra quando a origem é a página do anime, sem episódio aberto —
  cabeçalho diferente (ex. só o título da série), e o campo de número de
  episódio em `targetArea` (hoje pré-preenchido com `currentEpisode.episodeNumber`)
  fica vazio — sem problema pro "Plan to watch" (que ignora esse campo), mas
  ainda dá pra preencher na mão se quiser usar "Gravar" a partir dali.

## Investigação ao vivo — concluída (2026-07-13)

Feita via Playwright, mesmo método dos docs existentes. Resultado completo em
`docs/cr-extraction.md` (seção "Extração na página da série") e
`docs/pv-extraction.md` (seção "Extração na página de detalhe"). Resumo:

- **CR:** o número da temporada **é extraível** do DOM da página `/series/{id}`,
  via um elemento estável `.season-info` (formato `"S{N}: {Título}"`). Esse
  elemento só existe quando a série tem mais de uma temporada — quando tem só
  uma, ele nem aparece, e nesse caso é seguro assumir temporada 1. O texto
  reflete a temporada **atualmente selecionada no dropdown da página** (a URL
  não muda ao trocar de temporada), então o usuário precisa estar com a
  temporada certa escolhida na UI da CR antes de clicar "Plan to watch". Único
  caso sem saída automática: conteúdo bônus sem número de temporada (OADs,
  filme recorte) — nesses, não dá pra mapear por essa origem.
- **PV:** o título (com número de temporada embutido) vem de
  `<meta name="title">` na própria página de detalhe, sem precisar abrir o
  player — confirmado nas duas temporadas de teste. Não muda a necessidade de
  `pvDetailId` (já vem da URL, como sempre).

**Conclusão: não precisa de campo manual de temporada.** A extração automática
cobre os casos reais (série de 1 temporada ou N temporadas com dropdown). Fica
só a exceção de conteúdo bônus sem temporada, que simplesmente não entra por
essa origem (o usuário ainda pode mapear pelo fluxo de episódio/player nesses
casos raros, se fizer sentido).

Isso fecha as perguntas em aberto anteriores sobre a origem "página do anime" —
não há mais bloqueio de investigação pra essa parte do plano.

## Bug pós-implementação (2026-07-13): nem toda série usa `S{N}:`

Em uso real, o anime "Clevatess" (2 temporadas, `"Clevatess"` /
`"Clevatess II"` no dropdown — sem prefixo numérico, e `"2ª Temporada"` em
pt-BR) quebrou a suposição de que só existe `S{N}: título` ou "sem dropdown".
A extração de temporada em `content.js` (`seasonFromSeriesPage()`) ganhou um
segundo regex pra rótulos por extenso (`/(\d+)\s*ª?\s*(temporada|season)/i`) e,
quando nem esse bate, **assume temporada 1** em vez de falhar — troca "nunca
mapeia série sem `S{N}:`" por "mapeia certo no caso comum (temporada 1, padrão
da página) e erra só se o usuário estiver deliberadamente numa temporada
seguinte com rótulo não reconhecido" (corrigível via "re-mapear"). Detalhes
completos e a alternativa de API interna descartada (token preso ao locale da
sessão) em `docs/cr-extraction.md`.
