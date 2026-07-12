// content.js — roda em *.crunchyroll.com
// Extrai dados do episódio atual da página /watch/ e responde ao background.
// Fonte primária: JSON-LD TVEpisode (ver docs/cr-extraction.md). Fallback: og:title.

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

  function extractNow() {
    if (!/\/watch\//.test(location.pathname)) return null;
    const data = fromJsonLd() || fromOgTitle();
    if (!data) return null;
    data.episodeId = parseEpisodeId(location.href);
    data.mapKey = data.crSeriesId
      ? `${data.crSeriesId}#S${data.seasonNumber}`
      : null;
    data.displayId = data.crSeriesId || ''; // id curto pra exibir no popup
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
