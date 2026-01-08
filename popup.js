// Script pour l'interface popup de Match My Tone

let currentTabId = null;

// Récupère l'onglet actuel
async function getCurrentTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

// Charge les paramètres de l'onglet actuel
async function loadParams() {
  try {
    const tab = await getCurrentTab();
    currentTabId = tab.id;
    
    const params = await browser.runtime.sendMessage({ type: 'getCurrentTabParams' });
    
    // Met à jour l'interface
    document.getElementById('enabled').checked = params.isEnabled;
    document.getElementById('semitones').value = params.semitons;
    document.getElementById('semitonesValue').textContent = params.semitons.toFixed(1);
    document.getElementById('hz').value = params.hz;
    document.getElementById('hzValue').textContent = params.hz;
  } catch (error) {
    console.error('Erreur lors du chargement des paramètres:', error);
  }
}

// Envoie les paramètres mis à jour au background script
async function updateParams() {
  if (!currentTabId) return;
  
  const params = {
    isEnabled: document.getElementById('enabled').checked,
    semitons: parseFloat(document.getElementById('semitones').value),
    hz: parseFloat(document.getElementById('hz').value)
  };
  
  try {
    await browser.runtime.sendMessage({
      type: 'updateParams',
      tabId: currentTabId,
      params: params
    });
  } catch (error) {
    console.error('Erreur lors de la mise à jour des paramètres:', error);
  }
}

// Écouteurs d'événements
document.getElementById('enabled').addEventListener('change', updateParams);
document.getElementById('semitones').addEventListener('input', (e) => {
  document.getElementById('semitonesValue').textContent = parseFloat(e.target.value).toFixed(1);
  updateParams();
});
document.getElementById('hz').addEventListener('input', (e) => {
  document.getElementById('hzValue').textContent = e.target.value;
  updateParams();
});

// Charge les paramètres au chargement
loadParams();
