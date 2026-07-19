// popup.js — máquina de estados da interface, reativa à aba atual.
// AniList é o único backend (v1.0.0, ver docs/1.0.0/contexto.md) — fala só
// via mensagens com background.js. Estados: setup (login) · 1 (busca) ·
// 2 (painel de lista) · 3 (tela de detalhes) · 4 (tela rápida de episódio) —
// ver docs/1.0.0/visao.md § "Como o popup funciona".

const $ = (id) => document.getElementById(id);

// i18n: mensagens vêm de _locales/<lang>/messages.json. Placeholders são {token},
// substituídos aqui (mais simples que o esquema nativo $1/$2 do chrome.i18n pra
// mensagens com várias variáveis).
function tr(key, vars) {
  let s = chrome.i18n.getMessage(key) || key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.split(`{${k}}`).join(v);
    }
  }
  return s;
}

// Preenche todo texto estático marcado com data-i18n* no HTML.
function applyStaticI18n() {
  for (const el of document.querySelectorAll('[data-i18n]')) {
    el.textContent = tr(el.dataset.i18n);
  }
  for (const el of document.querySelectorAll('[data-i18n-html]')) {
    el.innerHTML = tr(el.dataset.i18nHtml);
  }
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) {
    el.placeholder = tr(el.dataset.i18nPlaceholder);
  }
  for (const el of document.querySelectorAll('[data-i18n-title]')) {
    el.title = tr(el.dataset.i18nTitle);
  }
}
applyStaticI18n();

function send(msg) {
  return new Promise((resolve) =>
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(resp);
      }
    }),
  );
}

function setMsg(text, kind = '') {
  const el = $('msg');
  el.textContent = text || '';
  el.className = kind;
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

// Extrai um id numérico de URL "*/anime/{id}/*" (AniList) ou id colado.
function parseAnimeId(input) {
  const s = (input || '').trim();
  if (/^\d+$/.test(s)) return Number(s);
  const m = s.match(/anime\/(\d+)/);
  return m ? Number(m[1]) : null;
}

// Palpite de título pra busca: remove sufixo localizado após " - " / " | ".
function cleanTitleGuess(title) {
  return (title || '').split(/\s[-|]\s/)[0].trim();
}

function openUrl(url) {
  if (!url) return;
  chrome.tabs.create({ url });
}

// Data de hoje no formato YYYY-MM-DD (fuso local).
function todayStr() {
  const d = new Date();
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

const TOP_CARDS = ['setupCard', 'mainCard', 'panelCard', 'detailCard', 'quickCard'];
function showCard(id) {
  for (const c of TOP_CARDS) $(c).classList.toggle('hidden', c !== id);
  $('resyncBtn').classList.toggle('hidden', id !== 'panelCard');
}

// ---------- SETUP (login no AniList) ----------

async function showSetup(status) {
  $('redirectUri').textContent = status.redirectUri || '—';
  $('clientId').value = status.clientId || '';
  $('redirectLabel').innerHTML = tr('setupRedirectLabel', {
    provider: 'AniList',
    url: 'https://anilist.co/settings/developer',
  });
  $('clientIdLabel_').textContent = tr('setupClientIdLabel', { provider: 'AniList' });
  $('loginBtn').textContent = tr('setupLoginBtn', { provider: 'AniList' });
  showCard('setupCard');
}

// ---------- [estado 2] PAINEL DE LISTA ----------
// Reaproveita a estilização de `.mapcard` (banner 3:1, fallback pro pôster)
// — ver docs/1.0.0/visao.md § "Painel de lista (estado 2)". Sem Gravar/Plan
// to watch/Dropar/Pausar aqui de propósito — isso fica todo na tela de
// detalhes (estado 3); o botão "ver detalhes" de cada card leva pra lá.

let panelData = null; // { fetchedAt, watching: [...], planning: [...] }
let panelTab = 'watching';

// Segundos → "Xd Xh" / "Xh" / "Xmin", só a maior unidade + a próxima.
function formatCountdown(seconds) {
  if (seconds == null) return '';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}min`;
  return `${mins}min`;
}

// Countdown pro próximo episódio só faz sentido se o episódio SEGUINTE ao seu
// progresso é o que ainda tá pra estrear. Se `nextAiringEpisode.episode` for
// maior que `progress + 1`, já saiu episódio que você não assistiu ainda —
// mostra "novo episódio disponível" em vez da contagem regressiva do próximo
// (achado real: sem isso, ficava mostrando contagem pro episódio N+2 sem
// avisar que o N+1 já tinha saído). Anime que já terminou de exibir
// (`nextAiringEpisode` nulo) mas com progresso atrás do total conhecido cai no
// mesmo caso — hoje não mostrava nada.
function episodeAvailability(entry, media) {
  const nextEp = media.nextAiringEpisode;
  if (nextEp) {
    if (entry.progress + 1 < nextEp.episode) return { available: true };
    return { available: false, countdown: formatCountdown(nextEp.timeUntilAiring) };
  }
  if (media.episodes && entry.progress < media.episodes) return { available: true };
  return null;
}

// Ms desde `fetchedAt` → "Sincronizado há Xh"/"Xd"/"agora mesmo" — pro
// indicador do botão de re-sync.
function formatRelativeTime(fetchedAt) {
  const ms = Date.now() - fetchedAt;
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return tr('timeJustNow');
  if (mins < 60) return tr('timeMinAgo', { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return tr('timeHoursAgo', { n: hours });
  return tr('timeDaysAgo', { n: Math.floor(hours / 24) });
}

const SITE_LABEL = { cr: 'CR', pv: 'PV' };

// Badge de source: só CR ou PV (as duas sources que a extensão de fato
// suporta) — outros STREAMING do externalLinks (Netflix, YouTube, etc.) são
// ignorados aqui, mesmo que venham antes na lista; mostrar um link pra uma
// plataforma que a extensão não integra seria enganoso (docs/1.0.0/visao.md
// § "Painel de lista"; virou ideia de evolução futura registrada lá em
// "Fora de escopo").
function streamingLink(media) {
  for (const link of media.externalLinks || []) {
    if (link.type !== 'STREAMING') continue;
    const url = link.url.toLowerCase();
    if (url.includes('crunchyroll')) return { url: link.url, site: 'cr', label: SITE_LABEL.cr };
    if (url.includes('amazon') || url.includes('primevideo')) {
      return { url: link.url, site: 'pv', label: SITE_LABEL.pv };
    }
  }
  return null;
}

function renderPanelCard(entry) {
  const media = entry.media;
  const title = media.title?.romaji || media.title?.english || '?';
  const bannerSrc = media.bannerImage || media.coverImage?.large || media.coverImage?.medium || '';
  const availability = episodeAvailability(entry, media);
  const availabilityHtml = !availability
    ? ''
    : availability.available
      ? `<div class="countdown available">${escapeHtml(tr('panelNewEpisodeAvailable'))}</div>`
      : `<div class="countdown">${escapeHtml(tr('panelNextEpisodeIn', { time: availability.countdown }))}</div>`;
  const row = document.createElement('div');
  row.className = 'mapcard';
  row.innerHTML = `
    ${bannerSrc ? `<img class="banner" src="${escapeHtml(bannerSrc)}" alt="">` : '<div class="banner"></div>'}
    <div class="info">
      <div class="v">${escapeHtml(title)}</div>
      <div class="subline">
        <div class="k">${media.episodes ? tr('panelProgress', { progress: entry.progress, total: media.episodes }) : tr('panelProgressNoTotal', { progress: entry.progress })}</div>
      </div>
      <div class="progressbar"><div class="fill" style="width: ${media.episodes ? Math.min(100, (entry.progress / media.episodes) * 100) : 0}%"></div></div>
      ${availabilityHtml}
    </div>`;
  const actions = document.createElement('div');
  actions.className = 'actions';
  const details = document.createElement('button');
  details.className = 'details';
  details.textContent = tr('viewDetailsBtn');
  details.onclick = () => showDetail(entry, { fromPanel: true });
  actions.appendChild(details);
  const link = streamingLink(media);
  if (link) {
    const btn = document.createElement('button');
    btn.className = link.site ? `src ${link.site}` : 'ghost';
    btn.textContent = `${link.label} ↗`;
    btn.onclick = () => openUrl(link.url);
    actions.appendChild(btn);
  }
  row.appendChild(actions);
  return row;
}

function renderPanelTab() {
  $('tabWatching').classList.toggle('active', panelTab === 'watching');
  $('tabPlanning').classList.toggle('active', panelTab === 'planning');
  const list = $('panelList');
  list.innerHTML = '';
  const entries = (panelTab === 'watching' ? panelData?.watching : panelData?.planning) || [];
  if (entries.length === 0) {
    const key = panelTab === 'watching' ? 'panelEmptyWatching' : 'panelEmptyPlanning';
    list.innerHTML = `<div class="muted">${tr(key)}</div>`;
    return;
  }
  for (const entry of entries) list.appendChild(renderPanelCard(entry));
}

async function showPanel() {
  showCard('panelCard');
  $('panelList').innerHTML = `<div class="muted">${tr('panelLoading')}</div>`;
  const resp = await send({ type: 'GET_PANEL_ENTRIES' });
  if (!resp.ok) {
    $('panelList').innerHTML = `<div class="muted">${escapeHtml(resp.error || tr('panelErrLoading'))}</div>`;
    return;
  }
  panelData = resp;
  $('panelSyncInfo').textContent = tr('panelSyncedAgo', { time: formatRelativeTime(resp.fetchedAt) });
  renderPanelTab();
}

// Re-sync manual — refaz a MediaListCollection inteira e substitui o cache
// (docs/1.0.0/design.md § "Cache local"); o gatilho automático de 7 dias
// mora em `getPanelEntries()` (background.js).
async function onResync() {
  const btn = $('resyncBtn');
  btn.disabled = true;
  $('panelSyncInfo').textContent = tr('panelSyncingMsg');
  const resp = await send({ type: 'RESYNC_LIST' });
  btn.disabled = false;
  if (!resp.ok) {
    setMsg(resp.error || tr('panelResyncErr'), 'err');
    $('panelSyncInfo').textContent = tr('panelSyncedAgo', { time: formatRelativeTime(panelData?.fetchedAt || 0) });
    return;
  }
  panelData = resp;
  $('panelSyncInfo').textContent = tr('panelSyncedAgo', { time: formatRelativeTime(resp.fetchedAt) });
  setMsg(tr('panelResyncedMsg'), 'ok');
  renderPanelTab();
}

// ---------- [estado 3] TELA DE DETALHES ----------
// Sobre um anime só, sem relação com nenhum episódio específico — reaberta
// automaticamente (aba na página do anime/série já numa lista) ou
// manualmente (botão "ver detalhes" no painel, ou "Detalhes" na tela
// rápida) — ver docs/1.0.0/visao.md § "Tela de detalhes (estado 3)".
// Gravar/Plan to watch e Dropar/Pausar usam a mesma mutation (SAVE_ENTRY →
// providers/anilist.js:saveEntry), só muda o `status` alvo.

// Status que exigem confirmação expressa pra sair (docs/1.0.0/visao.md §
// "Anime que está em 'outras listas'") — a extensão nunca usa REPEATING
// como destino (só como status de origem que pode aparecer aqui).
const OUTRAS_LISTAS = ['COMPLETED', 'DROPPED', 'PAUSED', 'REPEATING'];
const STATUS_LABEL_KEY = {
  CURRENT: 'panelTabWatching',
  PLANNING: 'panelTabPlanning',
  COMPLETED: 'statusCompleted',
  DROPPED: 'statusDropped',
  PAUSED: 'statusPaused',
  REPEATING: 'statusRepeating',
};

let detailEntry = null; // entrada atual (media + status/progress)
let detailFromPanel = false;
let detailPending = null; // ação aguardando confirmação (segundo clique): 'save' | 'plan' | 'drop' | 'pause'

function resetDetailConfirm() {
  detailPending = null;
  $('detailWarn').classList.add('hidden');
}

function showDetail(entry, opts = {}) {
  detailEntry = entry;
  detailFromPanel = !!opts.fromPanel;
  resetDetailConfirm();

  const media = entry.media;
  const title = media.title?.romaji || media.title?.english || '?';
  $('detailBack').classList.toggle('hidden', !detailFromPanel);
  const img = $('detailImg');
  const bannerSrc = media.bannerImage || media.coverImage?.large || media.coverImage?.medium || '';
  if (bannerSrc) img.src = bannerSrc;
  else img.removeAttribute('src');
  $('detailTitle').textContent = title;
  $('detailProgress').value = String(entry.progress ?? 0);
  $('detailTotal').textContent = media.episodes ? tr('epOfTotal', { total: media.episodes }) : '';

  const statusLabel = STATUS_LABEL_KEY[entry.status];
  $('detailStatus').classList.toggle('hidden', !statusLabel);
  if (statusLabel) $('detailStatus').textContent = tr('detailInStatus', { status: tr(statusLabel) });

  const countdown = $('detailCountdown');
  const availability = episodeAvailability(entry, media);
  countdown.classList.toggle('available', !!availability?.available);
  if (!availability) {
    countdown.classList.add('hidden');
  } else {
    countdown.textContent = availability.available
      ? tr('panelNewEpisodeAvailable')
      : tr('panelNextEpisodeIn', { time: availability.countdown });
    countdown.classList.remove('hidden');
  }

  const link = streamingLink(media);
  const sourceBtn = $('detailSourceBtn');
  if (link) {
    sourceBtn.className = link.site ? `src ${link.site}` : 'ghost';
    sourceBtn.textContent = `${link.label} ↗`;
    sourceBtn.onclick = () => openUrl(link.url);
  } else {
    sourceBtn.className = 'ghost hidden';
  }
  $('detailAnilistBtn').onclick = () => openUrl(media.siteUrl);

  showCard('detailCard');
}

// Regra da v0.1.1, portada da versão anterior: completa sozinho quando o
// progresso bate o total conhecido do anime — sem precisar de um botão
// "Finalizar" separado (não existe nas telas novas; lacuna conhecida se o
// total for desconhecido, ex. simulcast — caso raro, sem solução aqui).
function computeTargetStatus(entry, progress, fallback) {
  const total = entry.media.episodes;
  return total && progress >= total ? 'COMPLETED' : fallback;
}

// Mesma regra da v0.1.1: início = hoje só na primeira vez que o progresso
// sai de 0 (nunca sobrescreve se `entry` já tinha `startedAt`); fim = hoje
// só ao completar, também sem sobrescrever. Só se aplica a Gravar — Plan to
// watch nunca mexe em datas.
function computeAutoDates(entry, progress, targetStatus) {
  const dates = {};
  if (!entry.startedAt?.year && (entry.progress || 0) === 0 && progress >= 1) {
    dates.startDate = todayStr();
  }
  if (targetStatus === 'COMPLETED' && !entry.completedAt?.year) {
    dates.finishDate = todayStr();
  }
  return dates;
}

// Envia a mutation e atualiza a tela em cima da resposta real (não do palpite
// local) — status/progress finais vêm de `saveEntry` (background.js), que já
// devolve `media` completo, então dá pra chamar `showDetail` de novo direto.
async function saveDetail(status, progress, dates = {}) {
  setMsg(tr('savingMsg'));
  const resp = await send({
    type: 'SAVE_ENTRY',
    mediaId: detailEntry.media.id,
    status,
    progress,
    startDate: dates.startDate,
    finishDate: dates.finishDate,
  });
  if (!resp.ok) {
    setMsg(resp.error || tr('detailErrSave'), 'err');
    return;
  }
  setMsg(tr('detailSavedMsg'), 'ok');
  showDetail(resp.entry, { fromPanel: detailFromPanel });
}

// Gravar/Plan to watch: se o status atual for uma das "outras listas", pede
// confirmação (segundo clique) antes de mandar a mutation — PLANNING →
// CURRENT é progressão natural, sem confirmação. Só "Gravar" auto-completa
// e mexe em datas (ver `computeTargetStatus`/`computeAutoDates` acima).
async function onDetailAction(action) {
  const progress = parseInt($('detailProgress').value, 10);
  if (!Number.isFinite(progress) || progress < 0) {
    setMsg(tr('errInvalidEpisodeNumber'), 'err');
    return;
  }
  const targetStatus =
    action === 'save' ? computeTargetStatus(detailEntry, progress, 'CURRENT') : 'PLANNING';
  const needsConfirm = OUTRAS_LISTAS.includes(detailEntry.status);
  if (needsConfirm && detailPending !== action) {
    detailPending = action;
    $('detailWarn').textContent = tr('detailConfirmMove', {
      status: tr(STATUS_LABEL_KEY[detailEntry.status]),
    });
    $('detailWarn').classList.remove('hidden');
    return;
  }
  resetDetailConfirm();
  const dates = action === 'save' ? computeAutoDates(detailEntry, progress, targetStatus) : {};
  await saveDetail(targetStatus, progress, dates);
}

// Dropar/Pausar sempre pedem confirmação — não mexem em `progress` (a
// mutation recebe `progress: undefined`, que o GraphQL trata como "não
// mudar esse campo").
async function onDetailStatusOnly(action, targetStatus, confirmMsgKey) {
  if (detailPending !== action) {
    detailPending = action;
    $('detailWarn').textContent = tr(confirmMsgKey);
    $('detailWarn').classList.remove('hidden');
    return;
  }
  resetDetailConfirm();
  await saveDetail(targetStatus, undefined);
}

// ---------- [estado 4] TELA RÁPIDA ----------
// Página de episódio, anime já reconhecido — ver docs/1.0.0/visao.md § "Como
// o popup funciona", item 4. Só um botão de ação (Gravar, sempre `CURRENT`
// ou `COMPLETED` se completar) — sem Plan to watch/Dropar/Pausar aqui, isso
// fica na tela de detalhes (estado 3), acessível pelo botão Detalhes. Mesma
// regra de confirmação de "outras listas" que a tela de detalhes, só que o
// progresso vem do campo de episódio detectado, não de ajuste manual.

let quickEntry = null;
let quickSource = null; // { seasonNumber, episodeNumber } detectado na aba
let quickPending = false;

function resetQuickConfirm() {
  quickPending = false;
  $('quickWarn').classList.add('hidden');
}

function showQuick(entry, source) {
  quickEntry = entry;
  quickSource = source;
  resetQuickConfirm();

  const media = entry.media;
  const title = media.title?.romaji || media.title?.english || '?';
  const img = $('quickImg');
  const bannerSrc = media.bannerImage || media.coverImage?.large || media.coverImage?.medium || '';
  if (bannerSrc) img.src = bannerSrc;
  else img.removeAttribute('src');
  $('quickTitle').textContent = title;
  $('quickMeta').textContent = tr('epMetaFormat', {
    season: source.seasonNumber,
    episode: source.episodeNumber,
  });
  $('quickEpNum').value = String(source.episodeNumber ?? '');
  $('quickTotal').textContent = media.episodes ? tr('epOfTotal', { total: media.episodes }) : '';

  const statusLabel = STATUS_LABEL_KEY[entry.status];
  $('quickStatus').classList.toggle('hidden', !statusLabel);
  if (statusLabel) $('quickStatus').textContent = tr('detailInStatus', { status: tr(statusLabel) });

  showCard('quickCard');
}

async function onQuickSave() {
  const progress = parseInt($('quickEpNum').value, 10);
  if (!Number.isFinite(progress) || progress < 0) {
    setMsg(tr('errInvalidEpisodeNumber'), 'err');
    return;
  }
  const needsConfirm = OUTRAS_LISTAS.includes(quickEntry.status);
  if (needsConfirm && !quickPending) {
    quickPending = true;
    $('quickWarn').textContent = tr('detailConfirmMove', {
      status: tr(STATUS_LABEL_KEY[quickEntry.status]),
    });
    $('quickWarn').classList.remove('hidden');
    return;
  }
  resetQuickConfirm();
  const targetStatus = computeTargetStatus(quickEntry, progress, 'CURRENT');
  const dates = computeAutoDates(quickEntry, progress, targetStatus);
  setMsg(tr('savingMsg'));
  const resp = await send({
    type: 'SAVE_ENTRY',
    mediaId: quickEntry.media.id,
    status: targetStatus,
    progress,
    startDate: dates.startDate,
    finishDate: dates.finishDate,
  });
  if (!resp.ok) {
    setMsg(resp.error || tr('detailErrSave'), 'err');
    return;
  }
  setMsg(tr('detailSavedMsg'), 'ok');
  showQuick(resp.entry, { seasonNumber: quickSource?.seasonNumber, episodeNumber: progress });
}

// ---------- [estado 1] BUSCA ----------
// Reaproveita o HTML/CSS de busca (`pickArea`, dentro do `mainCard`,
// `.candidate`) — busca direto no AniList (`SEARCH_ANIME`/`GET_ANIME_BY_ID`).
// Ver docs/1.0.0/visao.md § "Como o popup funciona", item 1.

let state1Source = null; // dado bruto detectado na aba (vindo do GET_STATE)

function showSearchState1(source) {
  state1Source = source;
  $('epTitle').textContent = source.seriesTitle || tr('episodeFallback');
  $('epMeta').textContent =
    source.episodeNumber != null
      ? tr('epMetaFormat', { season: source.seasonNumber, episode: source.episodeNumber })
      : tr('seasonOnlyFormat', { season: source.seasonNumber });
  $('searchQuery').placeholder = tr('searchPlaceholderAnilist');
  $('pasteUrlLabel_').textContent = tr('pasteUrlLabelAnilist');
  showCard('mainCard');

  const seed = cleanTitleGuess(source.seriesTitle);
  $('searchQuery').value = seed;
  $('malUrl').value = '';
  runSearchState1(seed);
}

async function runSearchState1(query) {
  if (!query) return;
  $('candidates').innerHTML = `<div class="muted">${tr('searching')}</div>`;
  const resp = await send({ type: 'SEARCH_ANIME', query });
  if (!resp.ok) {
    $('candidates').innerHTML = `<div class="muted">${escapeHtml(resp.error || tr('errSearchFailed'))}</div>`;
    return;
  }
  renderCandidatesState1(resp.candidates);
}

function renderCandidatesState1(list) {
  const box = $('candidates');
  box.innerHTML = '';
  if (!list || list.length === 0) {
    box.innerHTML = `<div class="muted">${tr('noSearchResultsAnilist')}</div>`;
    return;
  }
  for (const c of list) {
    const div = document.createElement('div');
    div.className = 'candidate';
    const sub = [c.en, c.mediaType, c.year, c.numEpisodes ? `${c.numEpisodes} ep` : '']
      .filter(Boolean)
      .join(' · ');
    const bannerSrc = c.banner || c.picture || '';
    div.innerHTML = `
      ${bannerSrc ? `<img class="banner" src="${escapeHtml(bannerSrc)}" alt="">` : '<div class="banner"></div>'}
      <div class="meta">
        <div class="title">${escapeHtml(c.title)}</div>
        <div class="sub">${escapeHtml(sub)}</div>
      </div>`;
    const btn = document.createElement('button');
    btn.className = 'mal';
    btn.textContent = tr('chooseBtn');
    btn.onclick = () => onPickState1(c.id);
    div.appendChild(btn);
    box.appendChild(div);
  }
}

// Grava direto na lista real — PLANNING se veio da página do anime (nunca
// tem episódio pra capturar progresso de verdade), CURRENT + episódio
// detectado se veio da página de episódio, indo direto pra tela do estado 4
// depois (sem passo extra — ver docs/1.0.0/design.md § "Anime ainda não
// está em nenhuma lista, na página de episódio (estado 1)").
async function onPickState1(mediaId) {
  setMsg(tr('savingMsg'));
  const fromEpisode = state1Source.episodeNumber != null;
  const resp = await send({
    type: 'SAVE_ENTRY',
    mediaId,
    status: fromEpisode ? 'CURRENT' : 'PLANNING',
    progress: fromEpisode ? state1Source.episodeNumber : undefined,
  });
  if (!resp.ok) {
    setMsg(resp.error || tr('errFailedToSave'), 'err');
    return;
  }
  setMsg(tr('detailSavedMsg'), 'ok');
  if (fromEpisode) showQuick(resp.entry, state1Source);
  else showDetail(resp.entry, { fromPanel: false });
}

async function onUseUrlState1() {
  const id = parseAnimeId($('malUrl').value);
  if (!id) {
    setMsg(tr('errInvalidAnilistUrl'), 'err');
    return;
  }
  setMsg(tr('searchingAnime'));
  const resp = await send({ type: 'GET_ANIME_BY_ID', animeId: id });
  if (!resp.ok) {
    setMsg(resp.error || tr('errAnimeNotFound'), 'err');
    return;
  }
  setMsg('');
  await onPickState1(resp.anime.id);
}

// ---------- render inicial ----------

async function render() {
  const s = await send({ type: 'GET_STATUS' });
  if (!s.ok) {
    setMsg(s.error || tr('errCouldNotGetStatus'), 'err');
    return;
  }
  $('statusDot').classList.toggle('on', !!s.loggedIn);
  if (!s.clientId || !s.loggedIn) {
    await showSetup(s);
    return;
  }

  const state = await send({ type: 'GET_STATE' });
  if (!state.ok) {
    setMsg(state.error || tr('errCouldNotGetStatus'), 'err');
    return;
  }
  if (state.state === 2) return showPanel();
  if (state.state === 3) return showDetail(state.entry, { fromPanel: false });
  if (state.state === 4) return showQuick(state.entry, state.source);
  return showSearchState1(state.source);
}

// ---------- listeners ----------

$('openSettings').onclick = async () => {
  const s = await send({ type: 'GET_STATUS' });
  await showSetup(s);
};

$('saveCreds').onclick = async () => {
  const resp = await send({ type: 'SET_CLIENT_ID', clientId: $('clientId').value });
  setMsg(resp.ok ? tr('credsSaved') : resp.error, resp.ok ? 'ok' : 'err');
};

$('loginBtn').onclick = async () => {
  setMsg(tr('openingLogin', { provider: 'AniList' }));
  const resp = await send({ type: 'LOGIN' });
  if (resp.ok) {
    setMsg(tr('authenticated'), 'ok');
    render();
  } else {
    setMsg(resp.error || tr('errLoginFailed'), 'err');
  }
};

$('searchBtn').onclick = () => runSearchState1($('searchQuery').value.trim());
$('searchQuery').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') runSearchState1($('searchQuery').value.trim());
});
$('useUrlBtn').onclick = onUseUrlState1;

$('tabWatching').onclick = () => {
  panelTab = 'watching';
  renderPanelTab();
};
$('tabPlanning').onclick = () => {
  panelTab = 'planning';
  renderPanelTab();
};
$('resyncBtn').onclick = onResync;

$('detailBack').onclick = () => showPanel();
$('detailProgress').addEventListener('input', resetDetailConfirm);
$('detailSaveBtn').onclick = () => onDetailAction('save');
$('detailPlanBtn').onclick = () => onDetailAction('plan');
$('detailPauseBtn').onclick = () => onDetailStatusOnly('pause', 'PAUSED', 'detailConfirmPause');
$('detailDropBtn').onclick = () => onDetailStatusOnly('drop', 'DROPPED', 'detailConfirmDrop');

$('quickEpNum').addEventListener('input', resetQuickConfirm);
$('quickSaveBtn').onclick = onQuickSave;
$('quickDetailsBtn').onclick = () => showDetail(quickEntry, { fromPanel: false });

render();
