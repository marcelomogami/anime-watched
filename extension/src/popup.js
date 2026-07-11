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

// --- estado em memória ---
let currentEpisode = null; // { crSeriesId, seasonNumber, episodeNumber, seriesTitle, mapKey, ... }
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

async function showEpisode() {
  const resp = await send({ type: 'GET_CURRENT_EPISODE' });
  if (!resp.ok) {
    const msg =
      resp.error === 'NOT_CRUNCHYROLL'
        ? 'Abra um episódio no Crunchyroll.'
        : 'Não consegui ler o episódio nesta página.';
    $('nowatchMsg').textContent = msg;
    showCard('nowatchCard');
    return;
  }
  currentEpisode = resp.data;
  remapOnly = false;
  $('epTitle').textContent = currentEpisode.seriesTitle || 'Episódio';
  $('epMeta').textContent =
    `S${currentEpisode.seasonNumber} · ep ${currentEpisode.episodeNumber}` +
    (currentEpisode.crSeriesId ? ` · ${currentEpisode.crSeriesId}` : '');
  showCard('mainCard');

  if (!currentEpisode.mapKey) {
    // sem crSeriesId (fallback og): não dá pra mapear por temporada
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
    if (!currentTarget.total && ls.listStatus.numEpisodes)
      currentTarget.total = ls.listStatus.numEpisodes;
    const totalTxt = currentTarget.total ? ` de ${currentTarget.total}` : '';
    $('targetProgress').textContent = ls.listStatus.inList
      ? `MAL já tem: ${ls.listStatus.numWatched}${totalTxt} ep (${ls.listStatus.status || '—'})`
      : `ainda não está na sua lista${totalTxt ? ' · ' + currentTarget.total + ' ep' : ''}`;
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

  setMsg('Gravando…');
  const resp = await send({
    type: 'UPDATE_EPISODES',
    animeId: currentTarget.id,
    num,
    total: currentTarget.total || 0,
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
  forceWrite = false;
  updateRegressWarn();
  const totalTxt = currentTarget.total ? ` de ${currentTarget.total}` : '';
  $('targetProgress').textContent = `MAL já tem: ${num}${totalTxt} ep`;
  setMsg(`✓ ${currentTarget.title} — episódio ${num} gravado.`, 'ok');
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
