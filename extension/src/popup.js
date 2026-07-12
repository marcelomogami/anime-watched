// popup.js — máquina de estados da interface.
// Estados: setup · fora-de-watch · episódio(pick/target) · gestão de mapeamentos.

const $ = (id) => document.getElementById(id);

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

// Extrai anime_id de URL do MAL ou id numérico.
function parseMalId(input) {
  const s = (input || '').trim();
  if (/^\d+$/.test(s)) return Number(s);
  const m = s.match(/anime\/(\d+)/);
  return m ? Number(m[1]) : null;
}

// Palpite de título pra busca: remove sufixo localizado após " - " / " | ".
function cleanTitleGuess(title) {
  return (title || '').split(/\s[-|]\s/)[0].trim();
}

// Abre a página do anime no MyAnimeList numa nova aba.
function openMal(animeId) {
  if (!animeId) return;
  chrome.tabs.create({ url: `https://myanimelist.net/anime/${animeId}` });
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
  const totalTxt = t.total ? ` de ${t.total}` : '';
  const base =
    t.inList || (t.currentWatched || 0) > 0
      ? `MAL já tem: ${t.currentWatched || 0}${totalTxt} ep`
      : `ainda não está na sua lista${t.total ? ' · ' + t.total + ' ep' : ''}`;
  const dt = [
    t.startDate ? `início ${t.startDate}` : '',
    t.finishDate ? `fim ${t.finishDate}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  $('targetProgress').textContent = dt ? `${base} · ${dt}` : base;
}

// --- estado em memória ---
let currentEpisode = null; // { displayId, seasonNumber, episodeNumber, seriesTitle, mapKey, ... }
let currentTarget = null; // { id, title, total, picture, currentWatched }
let forceWrite = false; // confirma gravação que reduz progresso
let remapOnly = false; // re-mapeando pela tela de gestão (não grava episódio)

const TOP_CARDS = ['setupCard', 'nowatchCard', 'mainCard', 'mappingsCard'];
function showCard(id) {
  for (const c of TOP_CARDS) $(c).classList.toggle('hidden', c !== id);
}

// ---------- SETUP ----------

async function showSetup(status) {
  $('redirectUri').textContent = status.redirectUri || '—';
  $('clientId').value = status.clientId || '';
  $('clientSecret').value = status.clientSecret || '';
  showCard('setupCard');
}

// ---------- EPISÓDIO ----------

const NOWATCH_MESSAGES = {
  NOT_SUPPORTED_SITE: 'Abra um episódio no Crunchyroll ou no Prime Video.',
  NOT_A_WATCH_PAGE: 'Abra a página de um episódio no Crunchyroll.',
  NO_PLAYER_OPEN: 'Dê play no episódio no Prime Video (o player precisa estar aberto).',
};

async function showEpisode() {
  const resp = await send({ type: 'GET_CURRENT_EPISODE' });
  if (!resp.ok) {
    $('nowatchMsg').textContent =
      NOWATCH_MESSAGES[resp.error] || 'Não consegui ler o episódio nesta página.';
    showCard('nowatchCard');
    return;
  }
  currentEpisode = resp.data;
  remapOnly = false;
  $('epTitle').textContent = currentEpisode.seriesTitle || 'Episódio';
  $('epMeta').textContent =
    `S${currentEpisode.seasonNumber} · ep ${currentEpisode.episodeNumber}` +
    (currentEpisode.displayId ? ` · ${currentEpisode.displayId}` : '');
  showCard('mainCard');

  if (!currentEpisode.mapKey) {
    // sem id da série (fallback og do CR): não dá pra mapear por temporada
    $('pickArea').classList.add('hidden');
    $('targetArea').classList.add('hidden');
    setMsg('Não identifiquei a série do Crunchyroll. Recarregue a página do episódio.', 'err');
    return;
  }

  const m = await send({ type: 'GET_MAPPING', mapKey: currentEpisode.mapKey });
  if (m.ok && m.mapping?.malAnimeId) {
    selectTarget({
      id: m.mapping.malAnimeId,
      title: m.mapping.malTitle,
      total: m.mapping.malNumEpisodes || 0,
      picture: '',
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
  $('candidates').innerHTML = '<div class="muted">Buscando…</div>';
  runSearch(seed);
}

async function runSearch(query) {
  if (!query) return;
  $('candidates').innerHTML = '<div class="muted">Buscando…</div>';
  const resp = await send({ type: 'SEARCH', query });
  if (!resp.ok) {
    $('candidates').innerHTML = `<div class="muted">${escapeHtml(resp.error || 'busca falhou')}</div>`;
    return;
  }
  renderCandidates(resp.candidates);
}

function renderCandidates(list) {
  const box = $('candidates');
  box.innerHTML = '';
  if (!list || list.length === 0) {
    box.innerHTML = '<div class="muted">Nenhum resultado. Tente outro termo ou cole a URL do MAL.</div>';
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
    btn.textContent = 'Escolher';
    btn.onclick = () =>
      selectTarget({ id: c.id, title: c.title, total: c.numEpisodes || 0, picture: c.picture });
    div.appendChild(btn);
    box.appendChild(div);
  }
}

// Alvo escolhido (via busca, URL, ou mapeamento existente).
async function selectTarget(target) {
  currentTarget = { ...target, currentWatched: null };
  forceWrite = false;

  if (remapOnly) {
    // apenas troca o mapeamento, sem gravar episódio
    await send({
      type: 'SAVE_MAPPING',
      mapKey: currentEpisode.mapKey,
      value: {
        malAnimeId: target.id,
        malTitle: target.title,
        malNumEpisodes: target.total || 0,
        crSeriesTitle: currentEpisode.seriesTitle,
        savedAt: Date.now(),
      },
    });
    setMsg(`✓ Mapeado para ${target.title}.`, 'ok');
    openMappings();
    return;
  }

  $('pickArea').classList.add('hidden');
  $('targetArea').classList.remove('hidden');
  $('regressWarn').classList.add('hidden');
  $('saveBtn').textContent = 'Gravar no MyAnimeList';
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
  $('targetProgress').textContent = 'lendo progresso no MAL…';

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
    $('targetProgress').textContent = 'não consegui ler o progresso atual';
  }
}

function updateRegressWarn() {
  const num = parseInt($('epNum').value, 10);
  const cur = currentTarget?.currentWatched;
  const w = $('regressWarn');
  if (Number.isFinite(num) && cur != null && num < cur) {
    w.textContent = `Atenção: o MAL já marca ${cur}. Gravar ${num} vai reduzir seu progresso.`;
    w.classList.remove('hidden');
    if (!forceWrite) $('saveBtn').textContent = 'Gravar mesmo assim';
  } else {
    w.classList.add('hidden');
    if (!forceWrite) $('saveBtn').textContent = 'Gravar no MyAnimeList';
  }
}

// Datas automáticas (só preenche se estiver vazio; nunca sobrescreve):
// - início = hoje quando o MAL está em 0 e você grava um nº > 0 (robusto à numeração do CR)
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

// Grava no MAL (usado por "Gravar" e "Finalizar"). completed força status completed.
async function writeToMal(num, completed) {
  const dates = computeDates(num, completed);
  setMsg(completed ? 'Finalizando…' : 'Gravando…');
  const resp = await send({
    type: 'UPDATE_EPISODES',
    animeId: currentTarget.id,
    num,
    total: currentTarget.total || 0,
    dates,
    completed,
  });
  if (!resp.ok) {
    setMsg(resp.error || 'Falha ao gravar.', 'err');
    return;
  }
  // upsert do mapeamento (garante que fica salvo)
  await send({
    type: 'SAVE_MAPPING',
    mapKey: currentEpisode.mapKey,
    value: {
      malAnimeId: currentTarget.id,
      malTitle: currentTarget.title,
      malNumEpisodes: currentTarget.total || 0,
      crSeriesTitle: currentEpisode.seriesTitle,
      savedAt: Date.now(),
    },
  });
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
  if (dates.start_date) extras.push('início hoje');
  if (dates.finish_date) extras.push('fim hoje');
  if (currentTarget.status === 'completed') extras.push('concluído');
  const suffix = extras.length ? ' · ' + extras.join(' · ') : '';
  setMsg(`✓ ${currentTarget.title} — episódio ${num} gravado${suffix}.`, 'ok');
}

async function onSave() {
  const num = parseInt($('epNum').value, 10);
  if (!Number.isFinite(num) || num < 0) {
    setMsg('Número de episódio inválido.', 'err');
    return;
  }
  const cur = currentTarget.currentWatched;
  if (!forceWrite && cur != null && num < cur) {
    // primeira tentativa de reduzir: exige segundo clique
    forceWrite = true;
    updateRegressWarn();
    setMsg('Clique novamente para confirmar a redução.', '');
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
    setMsg('Número de episódio inválido para finalizar.', 'err');
    return;
  }
  await writeToMal(num, true);
}

// ---------- GESTÃO DE MAPEAMENTOS ----------

async function openMappings() {
  const resp = await send({ type: 'GET_ALL_MAPPINGS' });
  const list = $('mappingsList');
  list.innerHTML = '';
  const entries = Object.entries((resp.ok && resp.mappings) || {});
  if (entries.length === 0) {
    list.innerHTML = '<div class="muted">Nenhum mapeamento ainda.</div>';
  }
  for (const [key, val] of entries) {
    const row = document.createElement('div');
    row.className = 'maprow';
    row.innerHTML = `
      <div class="info">
        <div class="v">${escapeHtml(val.malTitle || '?')}</div>
        <div class="k">${escapeHtml(key)}${val.malNumEpisodes ? ' · ' + val.malNumEpisodes + ' ep' : ''}</div>
      </div>`;
    const actions = document.createElement('div');
    actions.className = 'actions';
    const open = document.createElement('button');
    open.className = 'mal';
    open.textContent = 'MAL ↗';
    open.onclick = () => openMal(val.malAnimeId);
    const remap = document.createElement('button');
    remap.className = 'ghost';
    remap.textContent = 're-mapear';
    remap.onclick = () => startRemap(key, val);
    const del = document.createElement('button');
    del.className = 'danger';
    del.textContent = 'apagar';
    del.onclick = async () => {
      await send({ type: 'REMOVE_MAPPING', mapKey: key });
      openMappings();
    };
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
  currentEpisode = { mapKey, seriesTitle: val.crSeriesTitle || val.malTitle || '' };
  remapOnly = true;
  $('epTitle').textContent = 'Re-mapear';
  $('epMeta').textContent = mapKey;
  $('targetArea').classList.add('hidden');
  showCard('mainCard');
  showPick();
}

// ---------- render inicial ----------

async function render() {
  const s = await send({ type: 'GET_STATUS' });
  if (!s.ok) {
    setMsg(s.error || 'Erro ao obter status.', 'err');
    return;
  }
  $('statusDot').classList.toggle('on', !!s.loggedIn);
  if (!s.clientId || !s.loggedIn) {
    await showSetup(s);
    return;
  }
  await showEpisode();
}

// ---------- listeners ----------

$('saveCreds').onclick = async () => {
  const r1 = await send({ type: 'SET_CLIENT_ID', clientId: $('clientId').value });
  const r2 = await send({ type: 'SET_CLIENT_SECRET', clientSecret: $('clientSecret').value });
  const ok = r1.ok && r2.ok;
  setMsg(ok ? 'Credenciais salvas.' : r1.error || r2.error, ok ? 'ok' : 'err');
};

$('loginBtn').onclick = async () => {
  setMsg('Abrindo login do MAL…');
  const resp = await send({ type: 'LOGIN' });
  if (resp.ok) {
    setMsg('✓ Autenticado.', 'ok');
    render();
  } else {
    setMsg(resp.error || 'Falha no login.', 'err');
  }
};

$('searchBtn').onclick = () => runSearch($('searchQuery').value.trim());
$('searchQuery').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') runSearch($('searchQuery').value.trim());
});

$('useUrlBtn').onclick = async () => {
  const id = parseMalId($('malUrl').value);
  if (!id) {
    setMsg('URL/ID do MAL inválido.', 'err');
    return;
  }
  setMsg('Buscando anime…');
  const resp = await send({ type: 'GET_ANIME', animeId: id });
  if (resp.ok) {
    setMsg('');
    selectTarget({
      id: resp.anime.id,
      title: resp.anime.title,
      total: resp.anime.numEpisodes || 0,
      picture: resp.anime.picture,
    });
  } else {
    setMsg(resp.error || 'Anime não encontrado.', 'err');
  }
};

$('epNum').addEventListener('input', () => {
  forceWrite = false;
  updateRegressWarn();
});
$('saveBtn').onclick = onSave;
$('completeBtn').onclick = onComplete;
$('openMal').onclick = () => openMal(currentTarget?.id);
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
