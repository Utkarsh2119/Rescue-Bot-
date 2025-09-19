(function() {
  const state = {
    isRunning: false,
    useMock: false,
    timerId: null,
    ws: null,
    lastSample: null,
    history: [],
  };

  // Elements
  const endpointInput = document.getElementById('endpoint');
  const protocolSelect = document.getElementById('protocol');
  const intervalInput = document.getElementById('interval');
  const mockToggle = document.getElementById('mockToggle');
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const clearBtn = document.getElementById('clearBtn');
  const cardsEl = document.getElementById('cards');
  const historyBody = document.getElementById('historyBody');
  const historyCount = document.getElementById('historyCount');
  const connectionDot = document.getElementById('connectionDot');
  const connectionText = document.getElementById('connectionText');
  const connectivityCard = document.getElementById('connectivityCard');
  const connectivityDotEl = connectivityCard ? connectivityCard.querySelector('.conn-dot') : null;
  const connectivityTextEl = connectivityCard ? connectivityCard.querySelector('.conn-text') : null;
  const cameraVideo = document.getElementById('cameraVideo');
  const cameraPlaceholder = document.getElementById('cameraPlaceholder');
  const cameraStartBtn = document.getElementById('cameraStartBtn');
  const cameraStopBtn = document.getElementById('cameraStopBtn');
  const cameraUrlInput = document.getElementById('cameraUrl');
  const cameraConnectBtn = document.getElementById('cameraConnectBtn');
  const useCameraHostBtn = document.getElementById('useCameraHostBtn');
  const toastEl = document.getElementById('toast');

  const SENSOR_DEFS = [
    { key: 'temperature', label: 'Temperature', unit: '°C', min: -10, max: 60 },
    { key: 'gps', label: 'GPS', unit: '', min: 0, max: 1 },
    { key: 'thermal', label: 'Thermal', unit: '°C', min: -10, max: 120 },
    { key: 'gas', label: 'Gas', unit: 'ppm', min: 0, max: 1000 },
    { key: 'battery', label: 'Battery', unit: '%', min: 0, max: 100 },
    { key: 'botStatus', label: 'Bot Status', unit: '', min: 0, max: 1 },
  ];

  function showToast(message, kind = 'info') {
    toastEl.textContent = message;
    toastEl.classList.add('show');
    if (kind === 'error') toastEl.style.borderColor = '#ff5d5d';
    else toastEl.style.borderColor = '#223066';
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toastEl.classList.remove('show'), 1800);
  }

  function setConnectionStatus(status) {
    const cls = (status === 'connected' ? 'dot-connected' : status === 'error' ? 'dot-error' : 'dot-disconnected');
    if (connectionDot) connectionDot.className = 'dot ' + cls;
    if (connectionText) connectionText.textContent = status.charAt(0).toUpperCase() + status.slice(1);
    if (connectivityDotEl) connectivityDotEl.className = 'conn-dot ' + cls;
    if (connectivityTextEl) connectivityTextEl.textContent = status.charAt(0).toUpperCase() + status.slice(1);
  }

  function renderCards(sample) {
    if (!cardsEl.dataset.initialized) {
      cardsEl.innerHTML = SENSOR_DEFS.map(def => (
        '<article class="card" data-key="' + def.key + '">' +
          '<div class="title">' + def.label + '</div>' +
          '<div class="value"><span class="num">--</span>' + (def.unit ? '<span class="unit">' + def.unit + '</span>' : '') + '<span class="trend" hidden></span></div>' +
          '<div class="health"><span style="width:0%"></span></div>' +
        '</article>'
      )).join('');
      cardsEl.dataset.initialized = '1';
    }

    if (!sample) return;

    SENSOR_DEFS.forEach(def => {
      let value = sample[def.key];
      const card = cardsEl.querySelector('[data-key="' + def.key + '"]');
      const numEl = card.querySelector('.num');
      const trendEl = card.querySelector('.trend');
      const healthBar = card.querySelector('.health > span');

      const prev = state.lastSample ? state.lastSample[def.key] : undefined;
      if (def.key === 'gps') {
        if (value && typeof value === 'object' && 'lat' in value) {
          numEl.textContent = value.lat.toFixed(5) + ', ' + value.lng.toFixed(5);
        } else { numEl.textContent = '--'; }
        trendEl.hidden = true; healthBar.style.width = '0%';
      } else if (def.key === 'botStatus') {
        const txt = value || 'Idle';
        numEl.textContent = txt;
        trendEl.hidden = true; healthBar.style.width = '0%';
      } else if (typeof value === 'number') {
        numEl.textContent = formatNumber(value);
        const trend = prev === undefined ? 0 : value - prev;
        if (trend > 0.001) { trendEl.textContent = '▲'; trendEl.className = 'trend up'; trendEl.hidden = false; }
        else if (trend < -0.001) { trendEl.textContent = '▼'; trendEl.className = 'trend down'; trendEl.hidden = false; }
        else { trendEl.hidden = true; }

        const pct = clamp(((value - def.min) / (def.max - def.min)) * 100, 0, 100);
        healthBar.style.width = pct + '%';
      } else {
        numEl.textContent = '--';
        trendEl.hidden = true;
        healthBar.style.width = '0%';
      }
    });
  }

  function appendHistory(sample) {
    state.history.push(sample);
    if (state.history.length > 300) state.history.shift();
    if (historyCount) historyCount.textContent = state.history.length + ' records';

    if (historyBody) {
      const tr = document.createElement('tr');
      tr.innerHTML = [
        new Date(sample.timestamp).toLocaleTimeString(),
        sample.temperature?.toFixed?.(2) ?? '--',
        sample.humidity?.toFixed?.(2) ?? '--',
        sample.pressure?.toFixed?.(1) ?? '--',
        sample.light?.toFixed?.(0) ?? '--',
      ].map(v => '<td>' + v + '</td>').join('');
      historyBody.prepend(tr);
      // Keep table light
      while (historyBody.rows.length > 100) historyBody.deleteRow(-1);
    }
  }

  function formatNumber(num) {
    if (Math.abs(num) >= 1000 && Math.abs(num) < 100000) return num.toFixed(0);
    if (Math.abs(num) < 10) return num.toFixed(2);
    return num.toFixed(1);
  }

  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

  function getConfig() {
    const url = endpointInput ? endpointInput.value.trim() : '';
    const mode = protocolSelect ? protocolSelect.value : 'auto';
    const interval = Math.max(250, Number(intervalInput ? intervalInput.value : 1000) || 1000);
    const useMock = mockToggle ? mockToggle.checked : true;
    return { url, mode, interval, useMock };
  }

  function setRunning(running) {
    state.isRunning = running;
    if (startBtn) startBtn.disabled = running;
    if (stopBtn) stopBtn.disabled = !running;
    if (endpointInput) endpointInput.disabled = running;
    if (protocolSelect) protocolSelect.disabled = running;
    if (intervalInput) intervalInput.disabled = running;
    if (mockToggle) mockToggle.disabled = running;
  }

  function start() {
    const cfg = getConfig();
    state.useMock = cfg.useMock;
    if (!cfg.useMock && !cfg.url) {
      showToast('Please provide an endpoint or enable Mock data', 'error');
      return;
    }

    if (cfg.useMock) {
      setRunning(true);
      setConnectionStatus('connected');
      showToast('Mock data started');
      state.timerId = setInterval(() => {
        const sample = generateMockSample();
        onSample(sample);
      }, cfg.interval);
      return;
    }

    // Auto select protocol if needed
    const wantsWs = cfg.mode === 'ws' || (cfg.mode === 'auto' && cfg.url.startsWith('ws'));
    if (wantsWs) connectWebSocket(cfg.url);
    else startHttpPolling(cfg.url, cfg.interval);
  }

  function stop() {
    setRunning(false);
    if (state.timerId) { clearInterval(state.timerId); state.timerId = null; }
    if (state.ws) { try { state.ws.close(); } catch (_) {} state.ws = null; }
    setConnectionStatus('disconnected');
    showToast('Stopped');
  }

  function clearHistory() {
    state.history = [];
    if (historyBody) historyBody.innerHTML = '';
    if (historyCount) historyCount.textContent = '0 records';
    state.lastSample = null;
    renderCards(null);
  }

  function connectWebSocket(url) {
    try {
      const ws = new WebSocket(url);
      state.ws = ws;
      ws.onopen = () => {
        setRunning(true);
        setConnectionStatus('connected');
        showToast('WebSocket connected');
      };
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          onSample(withTimestamp(data));
        } catch (e) {
          setConnectionStatus('error');
          showToast('Invalid WS message', 'error');
        }
      };
      ws.onerror = () => {
        setConnectionStatus('error');
        showToast('WebSocket error', 'error');
      };
      ws.onclose = () => {
        setRunning(false);
        setConnectionStatus('disconnected');
        showToast('WebSocket closed');
      };
    } catch (e) {
      setConnectionStatus('error');
      showToast('Failed to open WebSocket', 'error');
    }
  }

  function startHttpPolling(url, interval) {
    setRunning(true);
    setConnectionStatus('connected');
    showToast('HTTP polling started');
    const poll = async () => {
      if (!state.isRunning) return;
      try {
        const res = await fetch(url, { cache: 'no-store' });
        const data = await res.json();
        onSample(withTimestamp(data));
      } catch (e) {
        setConnectionStatus('error');
        showToast('HTTP fetch failed', 'error');
      }
    };
    poll();
    state.timerId = setInterval(poll, interval);
  }

  function onSample(sample) {
    state.lastSample = sample;
    renderCards(sample);
    appendHistory(sample);
  }

  function withTimestamp(obj) {
    return { ...obj, timestamp: Date.now() };
  }

  // Mock generator
  const mockState = { t: 24.5, thermal: 30, gas: 120, battery: 85, lat: 28.6139, lng: 77.2090 };
  function generateMockSample() {
    mockState.t = drift(mockState.t, 0.15, 22, 40);
    mockState.thermal = drift(mockState.thermal, 0.3, 25, 90);
    mockState.gas = Math.max(0, mockState.gas + (Math.random() - 0.5) * 10);
    mockState.battery = clamp(mockState.battery - Math.random() * 0.1, 5, 100);
    const jitterLat = mockState.lat + (Math.random() - 0.5) * 0.0001;
    const jitterLng = mockState.lng + (Math.random() - 0.5) * 0.0001;
    const statuses = ['Idle', 'Moving', 'Charging', 'Error'];
    const botStatus = statuses[Math.floor(Math.random() * statuses.length)];
    return withTimestamp({ 
      temperature: mockState.t,
      gps: { lat: jitterLat, lng: jitterLng },
      thermal: mockState.thermal,
      gas: mockState.gas,
      battery: mockState.battery,
      botStatus
    });
  }
  function drift(value, step, min, max) {
    const delta = (Math.random() - 0.5) * step * 2;
    let next = value + delta;
    if (next < min) next = min + (min - next) * 0.3;
    if (next > max) next = max - (next - max) * 0.3;
    return next;
  }

  // Event bindings
  if (startBtn) startBtn.addEventListener('click', start);
  if (stopBtn) stopBtn.addEventListener('click', stop);
  if (clearBtn) clearBtn.addEventListener('click', clearHistory);
  if (mockToggle) mockToggle.addEventListener('change', () => {
    if (state.isRunning) { stop(); start(); }
  });

  if (cameraStartBtn && cameraStopBtn) {
    cameraStartBtn.addEventListener('click', async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        cameraVideo.srcObject = stream;
        cameraVideo.style.display = 'block';
        cameraPlaceholder.style.display = 'none';
        cameraStartBtn.disabled = true;
        cameraStopBtn.disabled = false;
      } catch (e) {
        showToast('Camera access denied', 'error');
      }
    });
    cameraStopBtn.addEventListener('click', () => {
      const stream = cameraVideo.srcObject;
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
        cameraVideo.srcObject = null;
      }
      cameraVideo.style.display = 'none';
      cameraPlaceholder.style.display = 'grid';
      cameraStartBtn.disabled = false;
      cameraStopBtn.disabled = true;
    });
  }

  // Remote camera: support MJPEG streams by using an <img> overlay if URL provided
  if (cameraConnectBtn && cameraUrlInput) {
    let mjpegImg;
    cameraConnectBtn.addEventListener('click', () => {
      const url = (cameraUrlInput.value || '').trim();
      if (!url) { showToast('Enter camera URL', 'error'); return; }
      // If it's an MJPEG HTTP stream, render with <img>. For others, try <video>.
      if (/^https?:\/\//i.test(url)) {
        if (!mjpegImg) {
          mjpegImg = document.createElement('img');
          mjpegImg.style.width = '100%';
          mjpegImg.style.height = '100%';
          mjpegImg.style.objectFit = 'cover';
          mjpegImg.alt = 'Camera stream';
          cameraVideo.parentElement.appendChild(mjpegImg);
        }
        if (cameraVideo.srcObject) {
          cameraVideo.srcObject.getTracks().forEach(t => t.stop());
          cameraVideo.srcObject = null;
        }
        cameraVideo.style.display = 'none';
        cameraPlaceholder.style.display = 'none';
        mjpegImg.src = url;
        showToast('Camera stream connected');
      } else if (/^ws:|^wss:|^rtsp:/i.test(url)) {
        showToast('RTSP/WS streams need a gateway to HLS/MP4/MJPEG', 'error');
      } else {
        showToast('Unsupported camera URL', 'error');
      }
    });

    if (useCameraHostBtn) {
      useCameraHostBtn.addEventListener('click', () => {
        const url = (cameraUrlInput.value || '').trim();
        try {
          const u = new URL(url);
          if (endpointInput) {
            const wsCandidate = 'ws://' + u.hostname + ':8080';
            endpointInput.value = wsCandidate;
            showToast('Sensor endpoint set to ' + wsCandidate);
          }
        } catch (_) {
          showToast('Enter a valid camera URL first', 'error');
        }
      });
    }
  }

  // Defaults
  if (endpointInput) endpointInput.value = 'ws://localhost:8080';
  renderCards(null);
})();


