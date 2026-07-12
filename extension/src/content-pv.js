// content-pv.js — roda em *.primevideo.com
// Extrai dados do episódio atual do overlay do player (aberto sobre /detail/...).
// Fonte: elementos .atvwebplayersdk-* injetados pelo próprio player da Amazon
// (ver docs/pv-extraction.md). Extração é sob demanda: só funciona com o player aberto.

(function () {
  function parseDetailId(url) {
    const m = (url || '').match(/\/detail\/([A-Z0-9]+)/i);
    return m ? m[1] : null;
  }

  // Lê temporada/episódio/títulos do overlay do player, se estiver aberto.
  function extractNow() {
    const episodeEl = document.querySelector('.atvwebplayersdk-episode-info');
    if (!episodeEl) return null; // player fechado / nada tocando

    const text = (episodeEl.textContent || '').trim();
    const m = text.match(/^T(\d+)\s*Ep\.(\d+)\s*(.*)$/i);
    if (!m) return null;

    const titleEl = document.querySelector('.atvwebplayersdk-title-text');
    const pvDetailId = parseDetailId(location.href);

    return {
      source: 'pv-player-dom',
      pvDetailId,
      seasonNumber: Number(m[1]),
      episodeNumber: Number(m[2]),
      episodeTitle: (m[3] || '').trim(),
      seriesTitle: (titleEl?.textContent || '').trim(),
      // O detail/<ID> do PV já é por-temporada (confirmado: T1 e T2 têm IDs
      // distintos), então não precisa compor com seasonNumber como no CR.
      mapKey: pvDetailId ? `pv:${pvDetailId}` : null,
      displayId: pvDetailId || '', // id curto pra exibir no popup
      pageUrl: location.href,
    };
  }

  // Espera o player montar o overlay (poll curto) — mesmo padrão do content.js do CR.
  function extractWithWait(timeoutMs = 8000) {
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        const data = extractNow();
        if (data && data.mapKey) return resolve(data);
        if (Date.now() - start > timeoutMs) return resolve(data); // pode ser null
        setTimeout(tick, 300);
      };
      tick();
    });
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'GET_EPISODE') {
      extractWithWait().then((data) => {
        if (!data) {
          sendResponse({ ok: false, error: 'NO_PLAYER_OPEN' });
        } else {
          sendResponse({ ok: true, data });
        }
      });
      return true; // resposta assíncrona
    }
  });
})();
