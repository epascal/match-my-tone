// Background script pour gérer les paramètres de Match My Tone

// Paramètres par défaut
const DEFAULT_PARAMS = {
  hz: 440.0,           // Fréquence de base (A4)
  semitons: 0,         // Décalage en demi-tons
  isEnabled: false     // État activé/désactivé
};

// Stockage des paramètres par onglet
const tabParams = new Map();

// Initialise les paramètres pour un onglet
function initTabParams(tabId) {
  if (!tabParams.has(tabId)) {
    tabParams.set(tabId, { ...DEFAULT_PARAMS });
  }
  return tabParams.get(tabId);
}

// Récupère les paramètres d'un onglet
function getTabParams(tabId) {
  return initTabParams(tabId);
}

// Met à jour les paramètres d'un onglet et notifie le content script
function updateTabParams(tabId, newParams) {
  const params = initTabParams(tabId);
  Object.assign(params, newParams);
  
  // Envoie la mise à jour au content script
  browser.tabs.sendMessage(tabId, {
    type: 'paramsUpdate',
    params: {
      pitch: calculatePitch(params.semitons, params.hz),
      isEnabled: params.isEnabled
    }
  }).catch(() => {
    // L'onglet n'a peut-être pas encore de content script chargé
    // Ce n'est pas grave, les paramètres seront récupérés au chargement
  });
}

// Calcule le pitch en demi-tons à partir des paramètres
function calculatePitch(semitons, hz) {
  const BASE_HZ = 440.0;
  const hzInSemitones = 12 * Math.log2(hz / BASE_HZ);
  return semitons + hzInSemitones;
}

// Gestion des messages du content script et du popup
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'getParams') {
    // Le content script demande les paramètres
    const tabId = sender.tab?.id;
    if (tabId) {
      const params = getTabParams(tabId);
      sendResponse(params);
    } else {
      sendResponse(DEFAULT_PARAMS);
    }
    return true; // Réponse asynchrone
  }
  
  if (message.type === 'updateParams') {
    // Le popup met à jour les paramètres
    const tabId = message.tabId;
    if (tabId) {
      updateTabParams(tabId, message.params);
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: 'No tab ID' });
    }
    return true;
  }
  
  if (message.type === 'getCurrentTabParams') {
    // Le popup demande les paramètres de l'onglet actuel
    browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
      if (tabs[0]) {
        const params = getTabParams(tabs[0].id);
        sendResponse(params);
      } else {
        sendResponse(DEFAULT_PARAMS);
      }
    });
    return true;
  }
});

// Nettoie les paramètres quand un onglet est fermé
browser.tabs.onRemoved.addListener((tabId) => {
  tabParams.delete(tabId);
});

// Réinitialise les paramètres quand un onglet est rechargé
browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    // Les paramètres sont conservés, mais on peut les réinitialiser si nécessaire
    // initTabParams(tabId);
  }
});
