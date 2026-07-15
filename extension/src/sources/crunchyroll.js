// sources/crunchyroll.js — roda em *.crunchyroll.com
// Extrai dados do episódio atual da página /watch/, ou da série+temporada na página
// /series/{id}/... (sem episódio aberto — ver docs/cr-extraction.md). Responde ao
// background. Fonte primária pro /watch/: JSON-LD TVEpisode. Fallback: og:title.

(function () {
  function parseSeriesId(url) {
    const m = (url || '').match(/\/series\/(G[A-Z0-9]+)/i);
    return m ? m[1] : null;
  }
  function parseEpisodeId(url) {
    const m = (url || '').match(/\/watch\/(G[A-Z0-9]+)/i);
    return m ? m[1] : null;
  }

  // Lê o JSON-LD do tipo TVEpisode, se presente.
  function fromJsonLd() {
    const scripts = document.querySelectorAll(
      'script[type="application/ld+json"]',
    );
    for (const s of scripts) {
      let j;
      try {
        j = JSON.parse(s.textContent);
      } catch {
        continue;
      }
      const items = Array.isArray(j) ? j : [j];
      for (const it of items) {
        if (it && it['@type'] === 'TVEpisode') {
          const season = it.partOfSeason || {};
          const series = it.partOfSeries || season;
          const seriesId =
            parseSeriesId(series['@id']) || parseSeriesId(season['@id']);
          const seasonNumber = Number(season.seasonNumber) || 1;
          const episodeNumber = Number(it.episodeNumber);
          // Prioriza o título REAL da série (partOfSeries.name). O partOfSeason.name
          // costuma ser só o rótulo da temporada ("Season 3") em animes multi-temporada.
          const seriesTitle = series.name || season.name || '';
          if (seriesId && episodeNumber) {
            return {
              source: 'jsonld',
              crSeriesId: seriesId,
              seasonNumber,
              episodeNumber,
              seriesTitle,
              episodeTitle: it.name || '',
            };
          }
        }
      }
    }
    return null;
  }

  // Fallback: parse do og:title "{Série} | E{num} - {Título}".
  function fromOgTitle() {
    const og = document.querySelector('meta[property="og:title"]');
    if (!og) return null;
    const m = og.content.match(/^(.*?)\s*\|\s*E(\d+)\s*-\s*(.*)$/);
    if (!m) return null;
    return {
      source: 'og',
      crSeriesId: parseSeriesId(location.href), // provável null numa /watch/
      seasonNumber: 1,
      episodeNumber: Number(m[2]),
      seriesTitle: m[1].trim(),
      episodeTitle: m[3].trim(),
    };
  }

  // Lê a temporada selecionada no dropdown da página da série (ver docs/cr-extraction.md,
  // seção "Extração na página da série"). Nem toda série segue a convenção "S{n}: título"
  // no rótulo do dropdown — algumas usam só o nome ("Clevatess", "Clevatess II") ou o
  // rótulo genérico do locale ("2ª Temporada"), sem número óbvio. Tenta os dois formatos
  // conhecidos; se nenhum bater (ou o dropdown nem existir — série de temporada única),
  // assume temporada 1 (estado padrão da página ao abrir) em vez de falhar — se o usuário
  // estiver deliberadamente numa temporada seguinte sem conseguirmos ler o número, o
  // "re-mapear" corrige depois.
  function seasonFromSeriesPage() {
    const el = document.querySelector('.season-info');
    if (!el) return 1;
    const text = (el.textContent || '').trim();
    const numbered = text.match(/^S(\d+):/);
    if (numbered) return Number(numbered[1]);
    const worded = text.match(/(\d+)\s*ª?\s*(?:temporada|season)/i);
    if (worded) return Number(worded[1]);
    return 1;
  }

  // Extrai série+temporada da página /series/{id}/..., sem depender de um episódio
  // aberto — usado pra mapear um anime sem a CR registrar que ele foi "aberto".
  function fromSeriesPage() {
    const crSeriesId = parseSeriesId(location.href);
    if (!crSeriesId) return null;
    const og = document.querySelector('meta[property="og:title"]');
    // og:title só aparece depois que o SPA renderiza (mesmo timing do JSON-LD nas
    // páginas /watch/, ver docs/cr-extraction.md). Não decide a temporada (nem
    // assume "sem dropdown = temporada única") antes disso: até lá, `.season-info`
    // pode só estar ausente porque a página ainda não montou, não porque a série
    // tem uma temporada só — resolver cedo demais gravaria a temporada errada.
    if (!og?.content) return null;
    const seriesTitle = og.content.replace(/^Watch\s+/i, '').trim();
    return {
      source: 'series-page',
      crSeriesId,
      seasonNumber: seasonFromSeriesPage(),
      episodeNumber: null,
      seriesTitle,
      episodeTitle: '',
    };
  }

  function extractNow() {
    let data = null;
    if (/\/watch\//.test(location.pathname)) {
      data = fromJsonLd() || fromOgTitle();
    } else if (/\/series\//.test(location.pathname)) {
      data = fromSeriesPage();
    }
    if (!data) return null;
    data.episodeId = /\/watch\//.test(location.pathname)
      ? parseEpisodeId(location.href)
      : null;
    data.mapKey =
      data.crSeriesId && data.seasonNumber
        ? `${data.crSeriesId}#S${data.seasonNumber}`
        : null;
    data.displayId = data.crSeriesId || ''; // id curto pra exibir no popup
    data.site = 'cr';
    data.pageUrl = location.href;
    return data;
  }

  // Espera o SPA renderizar o JSON-LD/og (poll curto).
  function extractWithWait(timeoutMs = 8000) {
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        const data = extractNow();
        if (data && data.mapKey) return resolve(data);
        if (Date.now() - start > timeoutMs) return resolve(data); // pode ser null ou parcial
        setTimeout(tick, 300);
      };
      tick();
    });
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'GET_EPISODE') {
      extractWithWait().then((data) => {
        if (!data) {
          sendResponse({ ok: false, error: 'NOT_A_WATCH_PAGE' });
        } else {
          sendResponse({ ok: true, data });
        }
      });
      return true; // resposta assíncrona
    }
  });
})();
