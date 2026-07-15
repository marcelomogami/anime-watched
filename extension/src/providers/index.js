// providers/index.js — registro dos providers disponíveis.
// Cada módulo implementa o contrato descrito em docs/contexto-providers.md
// (auth, busca, progresso).

import * as mal from './mal.js';
import * as anilist from './anilist.js';

export const providers = { mal, anilist };

// Ordem de exibição no seletor da UI.
export const providerOrder = ['mal', 'anilist'];
