(() => {
  'use strict';

  const { DEFAULT_KNOWN_TYPES, DEFAULT_SELECTED_TYPES, DEFAULT_MODE, migrateSettings, parseKeywords, STORAGE_DEFAULTS } = globalThis.Qingliu;

  const master = document.getElementById('master');
  const typesEl = document.getElementById('types');
  const modeEl = document.getElementById('mode');
  const keywordsEl = document.getElementById('keywords');
  const countEl = document.getElementById('count');

  let knownTypes = [...DEFAULT_KNOWN_TYPES];
  let selectedTypes = new Set(DEFAULT_SELECTED_TYPES);

  function renderTypes() {
    typesEl.innerHTML = '';
    for (const t of knownTypes) {
      const label = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = selectedTypes.has(t);
      cb.addEventListener('change', () => {
        if (cb.checked) selectedTypes.add(t);
        else selectedTypes.delete(t);
        chrome.storage.local.set({ selectedTypes: [...selectedTypes] });
      });
      const span = document.createElement('span');
      span.textContent = t;
      label.append(cb, span);
      typesEl.appendChild(label);
    }
  }

  function setMode(value) {
    const input = modeEl.querySelector(`input[value="${value}"]`);
    if (input) input.checked = true;
  }

  modeEl.addEventListener('change', (e) => {
    if (e.target.name === 'mode') {
      chrome.storage.local.set({ mode: e.target.value });
    }
  });

  master.addEventListener('change', () => {
    chrome.storage.local.set({ enabled: master.checked });
  });

  keywordsEl.addEventListener('input', () => {
    chrome.storage.local.set({ keywords: parseKeywords(keywordsEl.value) });
  });

  async function refreshCount() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const resp = await chrome.tabs.sendMessage(tab.id, { type: 'GET_STATE' });
      const n = resp && typeof resp.filteredCount === 'number' ? resp.filteredCount : 0;
      countEl.textContent = `本页已过滤 ${n} 个视频`;
    } catch (e) {
      countEl.textContent = '本页已过滤 — 个视频';
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.enabled) master.checked = !!changes.enabled.newValue;
    if (changes.mode) setMode(changes.mode.newValue);
    if (changes.knownTypes) {
      knownTypes = [...(changes.knownTypes.newValue || [])];
      renderTypes();
    }
    if (changes.selectedTypes) {
      selectedTypes = new Set(changes.selectedTypes.newValue || []);
      renderTypes();
    }
    if (changes.keywords && document.activeElement !== keywordsEl) {
      keywordsEl.value = (changes.keywords.newValue || []).join('\n');
    }
  });

  chrome.storage.local
    .get(STORAGE_DEFAULTS)
    .then((raw) => {
      const data = migrateSettings(raw);
      if (data !== raw) {
        chrome.storage.local.set({
          schemaVersion: data.schemaVersion,
          mode: data.mode,
          selectedTypes: data.selectedTypes,
          knownTypes: data.knownTypes,
        });
      }
      master.checked = !!data.enabled;
      setMode(data.mode || DEFAULT_MODE);
      selectedTypes = new Set(data.selectedTypes || []);
      knownTypes = [...(data.knownTypes || [])];
      keywordsEl.value = (data.keywords || []).join('\n');
      renderTypes();
      refreshCount();
    });
})();
