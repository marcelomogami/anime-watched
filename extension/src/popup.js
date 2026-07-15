// popup.js — máquina de estados da interface.
// Estados: setup · fora-de-watch · episódio(pick/target) · gestão de mapeamentos.
// Agnóstico a provider: fala só via mensagens com background.js, que resolve
// tudo contra o provider ativo (MAL/AniList) — ver docs/contexto-providers.md.

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

// Extrai um id numérico de URL "*/anime/{id}/*" (MAL e AniList) ou id colado.
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

// URL de onde criar/gerenciar o app OAuth de cada provider (só usada na tela
// de setup, pro link de registro do redirect URI).
const PROVIDER_APP_URL = {
  mal: 'https://myanimelist.net/apiconfig',
  anilist: 'https://anilist.co/settings/developer',
};

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

// Renderiza a linha de progresso + datas a partir do currentTarget.
function renderProgress() {
  const t = currentTarget;
  if (!t) return;
  const watched = t.currentWatched || 0;
  const base =
    t.inList || watched > 0
      ? t.total
        ? tr('malHasProgressWithTotal', { watched, total: t.total, provider: providerLabel })
        : tr('malHasProgressNoTotal', { watched, provider: providerLabel })
      : t.total
        ? tr('notInListWithTotal', { total: t.total })
        : tr('notInListNoTotal');
  const dt = [
    t.startDate ? tr('startDateLabel', { date: t.startDate }) : '',
    t.finishDate ? tr('finishDateLabel', { date: t.finishDate }) : '',
  ]
    .filter(Boolean)
    .join(' · ');
  $('targetProgress').textContent = dt ? `${base} · ${dt}` : base;
}

// --- estado em memória ---
let currentEpisode = null; // { displayId, seasonNumber, episodeNumber, seriesTitle, mapKey, ... }
let currentTarget = null; // { id, title, total, picture, url, currentWatched }
let forceWrite = false; // confirma gravação que reduz progresso
let remapOnly = false; // re-mapeando pela tela de gestão (não grava episódio)
let providerId = 'mal';
let providerLabel = 'MAL';

const TOP_CARDS = ['setupCard', 'nowatchCard', 'mainCard', 'mappingsCard'];
function showCard(id) {
  for (const c of TOP_CARDS) $(c).classList.toggle('hidden', c !== id);
}

// Reaplica os textos que dependem do provider ativo nos cards já visíveis
// (rodado toda vez que o provider muda ou o status é recarregado).
function applyProviderLabels() {
  $('openMal').textContent = `${providerLabel} ↗`;
  $('saveBtn').textContent = tr('saveBtnLabel', { provider: providerLabel });
  $('searchQuery').placeholder = tr('searchPlaceholder', { provider: providerLabel });
  $('pasteUrlLabel_').textContent = tr('pasteUrlLabel', { provider: providerLabel });
  $('loginBtn').textContent = tr('setupLoginBtn', { provider: providerLabel });
  $('clientIdLabel_').textContent = tr('setupClientIdLabel', { provider: providerLabel });
  $('redirectLabel').innerHTML = tr('setupRedirectLabel', {
    provider: providerLabel,
    url: PROVIDER_APP_URL[providerId] || '#',
  });
}

// ---------- SETUP ----------

async function populateProviderSelect(active) {
  const resp = await send({ type: 'GET_PROVIDERS' });
  const select = $('providerSelect');
  select.innerHTML = '';
  const options = (resp.ok && resp.options) || [{ id: 'mal', label: 'MAL' }];
  for (const opt of options) {
    const el = document.createElement('option');
    el.value = opt.id;
    el.textContent = opt.label;
    select.appendChild(el);
  }
  select.value = active || (resp.ok && resp.active) || 'mal';
}

async function showSetup(status) {
  providerId = status.providerId || providerId;
  providerLabel = status.providerLabel || providerLabel;
  await populateProviderSelect(providerId);
  $('redirectUri').textContent = status.redirectUri || '—';
  $('clientId').value = status.clientId || '';
  $('clientSecret').value = status.clientSecret || '';
  $('clientSecretField').classList.toggle('hidden', status.needsClientSecret === false);
  applyProviderLabels();
  showCard('setupCard');
}

// ---------- EPISÓDIO ----------

const NOWATCH_MESSAGES = {
  NOT_SUPPORTED_SITE: 'errNotSupportedSite',
  NOT_A_WATCH_PAGE: 'errNotAWatchPage',
  NO_PLAYER_OPEN: 'errNoPlayerOpen',
};

async function showEpisode() {
  const resp = await send({ type: 'GET_CURRENT_EPISODE' });
  if (!resp.ok) {
    $('nowatchMsg').textContent = tr(
      NOWATCH_MESSAGES[resp.error] || 'errCouldNotReadEpisode',
    );
    showCard('nowatchCard');
    return;
  }
  currentEpisode = resp.data;
  remapOnly = false;
  $('epTitle').textContent = currentEpisode.seriesTitle || tr('episodeFallback');
  const meta =
    currentEpisode.episodeNumber != null
      ? tr('epMetaFormat', {
          season: currentEpisode.seasonNumber,
          episode: currentEpisode.episodeNumber,
        })
      : currentEpisode.seasonNumber != null
        ? tr('seasonOnlyFormat', { season: currentEpisode.seasonNumber })
        : tr('noEpisodeFormat');
  $('epMeta').textContent =
    meta + (currentEpisode.displayId ? ` · ${currentEpisode.displayId}` : '');
  showCard('mainCard');

  if (!currentEpisode.mapKey) {
    // sem id da série (fallback og do CR): não dá pra mapear por temporada
    $('pickArea').classList.add('hidden');
    $('targetArea').classList.add('hidden');
    setMsg(tr('errCouldNotIdentifySeries'), 'err');
    return;
  }

  const m = await send({ type: 'GET_MAPPING', mapKey: currentEpisode.mapKey });
  if (m.ok && m.mapping?.animeId) {
    selectTarget({
      id: m.mapping.animeId,
      title: m.mapping.title,
      total: m.mapping.numEpisodes || 0,
      picture: '',
      url: m.mapping.url,
    });
  } else {
    showPick();
  }
}

function showPick() {
  $('targetArea').classList.add('hidden');
  $('pickArea').classList.remove('hidden');
  const seed = cleanTitleGuess(currentEpisode.seriesTitle);
  $('searchQuery').value = seed;
  $('malUrl').value = '';
  $('candidates').innerHTML = `<div class="muted">${tr('searching')}</div>`;
  runSearch(seed);
}

async function runSearch(query) {
  if (!query) return;
  $('candidates').innerHTML = `<div class="muted">${tr('searching')}</div>`;
  const resp = await send({ type: 'SEARCH', query });
  if (!resp.ok) {
    $('candidates').innerHTML = `<div class="muted">${escapeHtml(resp.error || tr('errSearchFailed'))}</div>`;
    return;
  }
  renderCandidates(resp.candidates);
}

function renderCandidates(list) {
  const box = $('candidates');
  box.innerHTML = '';
  if (!list || list.length === 0) {
    box.innerHTML = `<div class="muted">${tr('noSearchResults', { provider: providerLabel })}</div>`;
    return;
  }
  for (const c of list) {
    const div = document.createElement('div');
    div.className = 'candidate';
    const sub = [c.en, c.mediaType, c.year, c.numEpisodes ? `${c.numEpisodes} ep` : '']
      .filter(Boolean)
      .join(' · ');
    div.innerHTML = `
      ${c.picture ? `<img src="${escapeHtml(c.picture)}" alt="">` : '<img alt="">'}
      <div class="meta">
        <div class="title">${escapeHtml(c.title)}</div>
        <div class="sub">${escapeHtml(sub)}</div>
      </div>`;
    const btn = document.createElement('button');
    btn.className = 'mal';
    btn.textContent = tr('chooseBtn');
    btn.onclick = () =>
      selectTarget({
        id: c.id,
        title: c.title,
        total: c.numEpisodes || 0,
        picture: c.picture,
        url: c.url,
      });
    div.appendChild(btn);
    box.appendChild(div);
  }
}

// Grava/atualiza o vínculo local source→provider pro episódio/série atual.
function saveMapping(target) {
  return send({
    type: 'SAVE_MAPPING',
    mapKey: currentEpisode.mapKey,
    value: {
      animeId: target.id,
      title: target.title,
      numEpisodes: target.total || 0,
      crSeriesTitle: currentEpisode.seriesTitle,
      site: currentEpisode.site,
      savedAt: Date.now(),
    },
  });
}

// Alvo escolhido (via busca, URL, ou mapeamento existente).
async function selectTarget(target) {
  currentTarget = { ...target, currentWatched: null };
  forceWrite = false;

  if (remapOnly) {
    // apenas troca o mapeamento, sem gravar episódio
    await saveMapping(target);
    setMsg(tr('mappedTo', { title: target.title }), 'ok');
    openMappings();
    return;
  }

  $('pickArea').classList.add('hidden');
  $('targetArea').classList.remove('hidden');
  $('regressWarn').classList.add('hidden');
  $('saveBtn').textContent = tr('saveBtnLabel', { provider: providerLabel });
  $('targetTitle').textContent = target.title;
  const img = $('targetImg');
  if (target.picture) {
    img.src = target.picture;
    img.classList.remove('hidden');
  } else {
    img.removeAttribute('src');
    img.classList.add('hidden');
  }
  $('epNum').value = String(currentEpisode.episodeNumber ?? '');
  $('targetProgress').textContent = tr('readingProgress', { provider: providerLabel });

  const ls = await send({ type: 'GET_LIST_STATUS', animeId: target.id });
  if (ls.ok) {
    currentTarget.currentWatched = ls.listStatus.numWatched;
    currentTarget.inList = ls.listStatus.inList;
    currentTarget.status = ls.listStatus.status;
    currentTarget.startDate = ls.listStatus.startDate || '';
    currentTarget.finishDate = ls.listStatus.finishDate || '';
    if (!currentTarget.total && ls.listStatus.numEpisodes)
      currentTarget.total = ls.listStatus.numEpisodes;
    renderProgress();
    updateRegressWarn();
  } else {
    $('targetProgress').textContent = tr('errCouldNotReadProgress');
  }
}

function updateRegressWarn() {
  const num = parseInt($('epNum').value, 10);
  const cur = currentTarget?.currentWatched;
  const w = $('regressWarn');
  if (Number.isFinite(num) && cur != null && num < cur) {
    w.textContent = tr('regressWarning', { cur, num, provider: providerLabel });
    w.classList.remove('hidden');
    if (!forceWrite) $('saveBtn').textContent = tr('saveBtnForce');
  } else {
    w.classList.add('hidden');
    if (!forceWrite) $('saveBtn').textContent = tr('saveBtnLabel', { provider: providerLabel });
  }
}

// Datas automáticas (só preenche se estiver vazio; nunca sobrescreve):
// - início = hoje quando o provider está em 0 e você grava um nº > 0 (robusto à numeração da source)
// - fim = hoje quando completa a temporada (nº >= total) ou ao finalizar explicitamente
function computeDates(num, completed) {
  const dates = {};
  if (!currentTarget.startDate && (currentTarget.currentWatched || 0) === 0 && num >= 1) {
    dates.start_date = todayStr();
  }
  const willComplete = completed || (currentTarget.total > 0 && num >= currentTarget.total);
  if (willComplete && !currentTarget.finishDate) {
    dates.finish_date = todayStr();
  }
  return dates;
}

// Grava no provider ativo (usado por "Gravar" e "Finalizar"). completed força status completed.
async function writeToMal(num, completed) {
  const dates = computeDates(num, completed);
  setMsg(completed ? tr('finishingMsg') : tr('savingMsg'));
  const resp = await send({
    type: 'UPDATE_EPISODES',
    animeId: currentTarget.id,
    num,
    total: currentTarget.total || 0,
    dates,
    completed,
  });
  if (!resp.ok) {
    setMsg(resp.error || tr('errFailedToSave'), 'err');
    return;
  }
  // upsert do mapeamento (garante que fica salvo)
  await saveMapping(currentTarget);
  currentTarget.currentWatched = num;
  currentTarget.inList = true;
  currentTarget.status =
    completed || (currentTarget.total > 0 && num >= currentTarget.total)
      ? 'completed'
      : 'watching';
  if (dates.start_date) currentTarget.startDate = dates.start_date;
  if (dates.finish_date) currentTarget.finishDate = dates.finish_date;
  forceWrite = false;
  updateRegressWarn();
  renderProgress();
  const extras = [];
  if (dates.start_date) extras.push(tr('startedTodayTag'));
  if (dates.finish_date) extras.push(tr('finishedTodayTag'));
  if (currentTarget.status === 'completed') extras.push(tr('completedTag'));
  const suffix = extras.length ? ' · ' + extras.join(' · ') : '';
  setMsg(tr('savedMsg', { title: currentTarget.title, num, suffix }), 'ok');
}

async function onSave() {
  const num = parseInt($('epNum').value, 10);
  if (!Number.isFinite(num) || num < 0) {
    setMsg(tr('errInvalidEpisodeNumber'), 'err');
    return;
  }
  const cur = currentTarget.currentWatched;
  if (!forceWrite && cur != null && num < cur) {
    // primeira tentativa de reduzir: exige segundo clique
    forceWrite = true;
    updateRegressWarn();
    setMsg(tr('confirmReduceMsg'), '');
    return;
  }
  await writeToMal(num, false);
}

// Finaliza a temporada: marca completed + fim = hoje. Usa o total se conhecido.
async function onComplete() {
  let num = parseInt($('epNum').value, 10);
  if (currentTarget.total) {
    num = currentTarget.total;
    $('epNum').value = String(num);
  }
  if (!Number.isFinite(num) || num < 0) {
    setMsg(tr('errInvalidEpisodeNumberComplete'), 'err');
    return;
  }
  await writeToMal(num, true);
}

// "Plan to watch": grava o vínculo local sem gravar episódio. Se o anime ainda
// não está em nenhuma lista do provider, também marca status "plan to watch"
// lá (0 episódios) — se já está (watching, completed, etc.), não mexe no status.
async function onPlanToWatch() {
  if (!currentTarget.inList) {
    setMsg(tr('savingMsg'));
    const resp = await send({ type: 'PLAN_TO_WATCH', animeId: currentTarget.id });
    if (!resp.ok) {
      setMsg(resp.error || tr('errFailedToSave'), 'err');
      return;
    }
  }
  await saveMapping(currentTarget);
  setMsg(tr('mappedTo', { title: currentTarget.title }), 'ok');
  openMappings();
}

// ---------- GESTÃO DE MAPEAMENTOS ----------

// Mapeamentos salvos antes do suporte a múltiplos sites não têm `site` gravado —
// nesse caso só existia Crunchyroll, então cai no fallback pelo formato da chave.
function siteOf(key, val) {
  return val?.site || (key.startsWith('pv:') ? 'pv' : 'cr');
}
const SITE_LABEL = { cr: 'CR', pv: 'PV' };

// Reconstrói a URL da série/detail na plataforma de origem a partir do mapKey
// (CR: "{crSeriesId}#S{n}" → /series/{id}; PV: "pv:{detailId}" → /detail/{id}).
function siteUrl(key, val) {
  const site = siteOf(key, val);
  if (site === 'pv') {
    const id = key.startsWith('pv:') ? key.slice(3) : '';
    return id ? `https://www.primevideo.com/detail/${id}` : null;
  }
  const id = key.split('#')[0];
  return id ? `https://www.crunchyroll.com/series/${id}` : null;
}

async function openMappings() {
  const resp = await send({ type: 'GET_ALL_MAPPINGS' });
  const list = $('mappingsList');
  list.innerHTML = '';
  const entries = Object.entries((resp.ok && resp.mappings) || {});
  if (entries.length === 0) {
    list.innerHTML = `<div class="muted">${tr('noMappingsYet')}</div>`;
  }
  for (const [key, val] of entries) {
    const site = siteOf(key, val);
    const row = document.createElement('div');
    row.className = 'maprow';
    row.innerHTML = `
      <div class="info">
        <div class="v">${escapeHtml(val.title || '?')}</div>
        <div class="k">${escapeHtml(key)}${val.numEpisodes ? ' · ' + val.numEpisodes + ' ep' : ''}</div>
      </div>`;
    const actions = document.createElement('div');
    actions.className = 'actions';
    const url = siteUrl(key, val);
    const openSrc = document.createElement('button');
    openSrc.className = `src ${site}`;
    openSrc.textContent = `${SITE_LABEL[site]} ↗`;
    openSrc.disabled = !url;
    openSrc.onclick = () => openUrl(url);
    const open = document.createElement('button');
    open.className = 'mal';
    open.textContent = `${providerLabel} ↗`;
    open.onclick = () => openUrl(val.url);
    const remap = document.createElement('button');
    remap.className = 'ghost';
    remap.textContent = tr('remapBtn');
    remap.onclick = () => startRemap(key, val);
    const del = document.createElement('button');
    del.className = 'danger';
    del.textContent = tr('deleteBtn');
    del.onclick = async () => {
      await send({ type: 'REMOVE_MAPPING', mapKey: key });
      openMappings();
    };
    actions.appendChild(openSrc);
    actions.appendChild(open);
    actions.appendChild(remap);
    actions.appendChild(del);
    row.appendChild(actions);
    list.appendChild(row);
  }
  showCard('mappingsCard');
}

// Re-mapear pela tela de gestão: reusa o pick, mas só troca o alvo (não grava episódio).
function startRemap(mapKey, val) {
  currentEpisode = {
    mapKey,
    seriesTitle: val.crSeriesTitle || val.title || '',
    site: siteOf(mapKey, val),
  };
  remapOnly = true;
  $('epTitle').textContent = tr('remapTitle');
  $('epMeta').textContent = mapKey;
  $('targetArea').classList.add('hidden');
  showCard('mainCard');
  showPick();
}

// ---------- render inicial ----------

async function render() {
  const s = await send({ type: 'GET_STATUS' });
  if (!s.ok) {
    setMsg(s.error || tr('errCouldNotGetStatus'), 'err');
    return;
  }
  providerId = s.providerId || providerId;
  providerLabel = s.providerLabel || providerLabel;
  $('statusDot').classList.toggle('on', !!s.loggedIn);
  if (!s.clientId || !s.loggedIn) {
    await showSetup(s);
    return;
  }
  applyProviderLabels();
  await showEpisode();
}

// ---------- listeners ----------

$('providerSelect').onchange = async () => {
  await send({ type: 'SET_ACTIVE_PROVIDER', providerId: $('providerSelect').value });
  const s = await send({ type: 'GET_STATUS' });
  await showSetup(s);
};

$('openSettings').onclick = async () => {
  const s = await send({ type: 'GET_STATUS' });
  await showSetup(s);
};

$('saveCreds').onclick = async () => {
  const r1 = await send({ type: 'SET_CLIENT_ID', clientId: $('clientId').value });
  const r2 = await send({ type: 'SET_CLIENT_SECRET', clientSecret: $('clientSecret').value });
  const ok = r1.ok && r2.ok;
  setMsg(ok ? tr('credsSaved') : r1.error || r2.error, ok ? 'ok' : 'err');
};

$('loginBtn').onclick = async () => {
  setMsg(tr('openingLogin', { provider: providerLabel }));
  const resp = await send({ type: 'LOGIN' });
  if (resp.ok) {
    setMsg(tr('authenticated'), 'ok');
    render();
  } else {
    setMsg(resp.error || tr('errLoginFailed'), 'err');
  }
};

$('searchBtn').onclick = () => runSearch($('searchQuery').value.trim());
$('searchQuery').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') runSearch($('searchQuery').value.trim());
});

$('useUrlBtn').onclick = async () => {
  const id = parseAnimeId($('malUrl').value);
  if (!id) {
    setMsg(tr('errInvalidMalUrl', { provider: providerLabel }), 'err');
    return;
  }
  setMsg(tr('searchingAnime'));
  const resp = await send({ type: 'GET_ANIME', animeId: id });
  if (resp.ok) {
    setMsg('');
    selectTarget({
      id: resp.anime.id,
      title: resp.anime.title,
      total: resp.anime.numEpisodes || 0,
      picture: resp.anime.picture,
      url: resp.anime.url,
    });
  } else {
    setMsg(resp.error || tr('errAnimeNotFound'), 'err');
  }
};

$('epNum').addEventListener('input', () => {
  forceWrite = false;
  updateRegressWarn();
});
$('saveBtn').onclick = onSave;
$('completeBtn').onclick = onComplete;
$('planToWatchBtn').onclick = onPlanToWatch;
$('openMal').onclick = () => openUrl(currentTarget?.url);
$('remapLink').onclick = () => {
  remapOnly = false;
  showPick();
};
$('showMappings').onclick = openMappings;
$('nw_showMappings').onclick = openMappings;
$('nw_setup').onclick = async () => {
  const s = await send({ type: 'GET_STATUS' });
  showSetup(s);
};
$('backFromMappings').onclick = () => render();

render();
