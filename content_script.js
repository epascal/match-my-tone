(async function() {
  if (window.__pitchShifterAttached) return;
  window.__pitchShifterAttached = true;

  console.log('Match My Tone: Script de conteÃºdo injetado (V10 - Crossfade SUAVE).');

  const WORKLET_NAME = 'soundtouch-processor';
  const WORKLET_PATH = 'audio/processor.js';

  let globalAudioParams = null; // Armazena { pitch, isEnabled }
  let audioContext = null;
  let workletPromise = null;
  
  const processedElements = new WeakMap();
  
  // --- A MUDANÃ‡A ESTÃ� AQUI ---
  // Aumentamos o tempo de fade para 150ms
  const FADE_TIME_S = 0.150; 

  async function initAudioContext() {
    if (audioContext) return;
    console.log('Match My Tone: Inicializando AudioContext...');
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }
    if (!workletPromise) {
      const workletURL = browser.runtime.getURL(WORKLET_PATH);
      workletPromise = audioContext.audioWorklet.addModule(workletURL);
    }
    await workletPromise;
    console.log('Match My Tone: AudioContext e Worklet prontos.');
  }

  /**
   * Conecta o processador ao elemento QUANDO O PLAY Ã‰ DADO.
   * Cria os dois caminhos paralelos (Bypass e Efeito).
   */
  async function connectElement(element) {
    if (processedElements.has(element) || !globalAudioParams) return;

    try {
      await initAudioContext();
      
      const source = audioContext.createMediaElementSource(element);
      const workletNode = new AudioWorkletNode(audioContext, WORKLET_NAME);
      
      // O Mixer
      const bypassGain = audioContext.createGain(); // NÃ³ de volume do Bypass
      const effectGain = audioContext.createGain(); // NÃ³ de volume do Efeito
      
      const now = audioContext.currentTime;
      
      // Configura o processador
      workletNode.parameters.get('pitchSemitones').setValueAtTime(globalAudioParams.pitch, now);
      workletNode.parameters.get('tempo').setValueAtTime(1.0, now);
      
      // Conecta os dois caminhos
      // Caminho A (Bypass): Fonte -> Bypass Gain -> SaÃ­da
      source.connect(bypassGain).connect(audioContext.destination);
      // Caminho B (Efeito): Fonte -> Processador -> Effect Gain -> SaÃ­da
      source.connect(workletNode).connect(effectGain).connect(audioContext.destination);

      // Define os volumes iniciais baseado no estado (SEM FADE)
      if (globalAudioParams.isEnabled) {
        bypassGain.gain.setValueAtTime(0.0, now);
        effectGain.gain.setValueAtTime(1.0, now);
      } else {
        bypassGain.gain.setValueAtTime(1.0, now);
        effectGain.gain.setValueAtTime(0.0, now);
      }
      
      // Armazena todos os nÃ³s
      processedElements.set(element, {
        source: source,
        workletNode: workletNode,
        bypassGain: bypassGain,
        effectGain: effectGain
      });
      
      console.log(`Match My Tone: Conectado (Estado inicial: ${globalAudioParams.isEnabled ? 'LIGADO' : 'DESLIGADO'})`, element);

    } catch (e) {
      console.warn(`Match My Tone: NÃ£o foi possÃ­vel conectar ao elemento.`, e);
    }
  }

  /**
   * Aplica novos parÃ¢metros (do background) a todos os elementos conectados.
   * Esta Ã© a funÃ§Ã£o principal que faz o CROSSFADE SUAVE.
   */
  function updateAllElements(params) {
    const oldParams = globalAudioParams;
    globalAudioParams = params; // Salva os novos parÃ¢metros { pitch, isEnabled }
    
    if (!audioContext) return; // Nada a fazer se o Ã¡udio nÃ£o comeÃ§ou

    const now = audioContext.currentTime;
    
    document.querySelectorAll('audio, video').forEach(element => {
      if (processedElements.has(element)) {
        const data = processedElements.get(element);
        
        // 1. Atualiza o Tom no processador (suavemente)
        data.workletNode.parameters.get('pitchSemitones').linearRampToValueAtTime(params.pitch, now + FADE_TIME_S);

        // 2. Verifica se o estado (Ligar/Desligar) MUDOU
        const stateChanged = oldParams && (oldParams.isEnabled !== params.isEnabled);
        
        if (stateChanged) {
          console.log(`Match My Tone: Crossfade para ${params.isEnabled ? 'LIGADO' : 'DESLIGADO'}`);
          
          // --- A MUDANÃ‡A ESTÃ� AQUI ---
          // Cancela qualquer fade anterior para evitar "clicks"
          data.bypassGain.gain.cancelScheduledValues(now);
          data.effectGain.gain.cancelScheduledValues(now);

          // Define o valor ATUAL para comeÃ§ar a rampa de onde parou
          data.bypassGain.gain.setValueAtTime(data.bypassGain.gain.value, now);
          data.effectGain.gain.setValueAtTime(data.effectGain.gain.value, now);

          if (params.isEnabled) {
            // LIGANDO: Fade-out do Bypass, Fade-in do Efeito
            data.bypassGain.gain.linearRampToValueAtTime(0.0, now + FADE_TIME_S);
            data.effectGain.gain.linearRampToValueAtTime(1.0, now + FADE_TIME_S);
          } else {
            // DESLIGANDO: Fade-in do Bypass, Fade-out do Efeito
            data.bypassGain.gain.linearRampToValueAtTime(1.0, now + FADE_TIME_S);
            data.effectGain.gain.linearRampToValueAtTime(0.0, now + FADE_TIME_S);
          }
        }
      }
    });
  }

  /**
   * Prepara um elemento de mÃ­dia, adicionando listeners.
   */
  function setupElement(element) {
    element.addEventListener('play', () => connectElement(element), { once: true });
    
    if (!element.paused && globalAudioParams) {
      connectElement(element);
    }
  }

  // -------------------------------------------------
  // INICIALIZAÃ‡ÃƒO E LISTENERS
  // -------------------------------------------------
  
  const BASE_HZ = 440.0;

  browser.runtime.onMessage.addListener((message) => {
    if (message.type === 'paramsUpdate') {
      updateAllElements(message.params);
    }
  });

  // Pede ao background os parÃ¢metros (ele vai saber de qual aba estamos)
  try {
    const rawParams = await browser.runtime.sendMessage({ type: 'getParams' });
    
    // Calcula os parÃ¢metros que o Ã¡udio vai usar
    const hzInSemitones = 12 * Math.log2(rawParams.hz / BASE_HZ);
    globalAudioParams = {
      pitch: rawParams.semitons + hzInSemitones,
      isEnabled: rawParams.isEnabled
    };
    
    console.log('Match My Tone: ParÃ¢metros iniciais carregados', globalAudioParams);
  } catch (e) {
    console.error('Match My Tone: NÃ£o foi possÃ­vel obter parÃ¢metros do background.', e);
    globalAudioParams = { pitch: 0, isEnabled: false }; // PadrÃµes
  }

  // Setup inicial
  document.querySelectorAll('audio, video').forEach(setupElement);

  // Observador para novos vÃ­deos (navegaÃ§Ã£o no YouTube)
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.tagName === 'VIDEO' || node.tagName === 'AUDIO') {
          setupElement(node);
        }
        node.querySelectorAll?.('audio, video').forEach(setupElement);
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

})();
