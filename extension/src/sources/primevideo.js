// sources/primevideo.js — roda em *.primevideo.com
// Extrai dados do episódio atual do overlay do player (aberto sobre /detail/...), ou
// da própria página /detail/... sem o player aberto (ver docs/pv-extraction.md).
// Fonte com player: elementos .atvwebplayersdk-* injetados pelo SDK da Amazon.
// Fonte sem player: <meta name="title"> da página de detalhe.

(function () {
  function parseDetailId(url) {
    const m = (url || '').match(/\/detail\/([A-Z0-9]+)/i);
    return m ? m[1] : null;
  }

  // Lê temporada/episódio/títulos do overlay do player, se estiver aberto.
  function fromPlayerOverlay() {
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
      site: 'pv',
      pageUrl: location.href,
    };
  }

  // Lê série+temporada só da página de detalhe, sem precisar abrir o player — usado
  // pra mapear um anime sem a Amazon registrar que ele foi "começado". O `pvDetailId`
  // já é por-temporada, então a temporada extraída aqui é só pra exibição/checagem,
  // não é necessária pra montar a chave de mapeamento.
  function fromDetailPage() {
    const pvDetailId = parseDetailId(location.href);
    if (!pvDetailId) return null;

    const meta = document.querySelector('meta[name="title"]')?.content || '';
    // Formato confirmado (pt-BR): "Assista à temporada {N} de {Título} – Prime Video".
    // Outros locales da própria Amazon podem frasear diferente — regex tolerante a
    // pt/en, com fallback pro <title> da página se não bater (ver docs/pv-extraction.md).
    const m = meta.match(
      /(?:temporada|season)\s+(\d+)\s+(?:de|of)\s+(.+?)\s*[–-]\s*Prime Video\s*$/i,
    );
    const seasonNumber = m ? Number(m[1]) : null;
    const seriesTitle = m
      ? m[2].trim()
      : document.title.replace(/^Prime Video:\s*/i, '').trim();
    if (!seriesTitle) return null; // página ainda não renderizou

    return {
      source: 'pv-detail-page',
      pvDetailId,
      seasonNumber,
      episodeNumber: null,
      episodeTitle: '',
      seriesTitle,
      mapKey: `pv:${pvDetailId}`,
      displayId: pvDetailId,
      site: 'pv',
      pageUrl: location.href,
    };
  }

  function extractNow() {
    return fromPlayerOverlay() || fromDetailPage();
  }

  // Espera o player montar o overlay (poll curto) — mesmo padrão do sources/crunchyroll.js.
  // Fora de /detail/{id}, nem o overlay do player nem a página de detalhe têm como
  // aparecer (o PV sempre abre o player em cima da própria /detail/, nunca numa URL
  // separada) — resolve na hora em vez de pollar 8s à toa (mesmo bug do CR).
  function extractWithWait(timeoutMs = 8000) {
    return new Promise((resolve) => {
      if (!parseDetailId(location.href)) {
        return resolve(null);
      }
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
