(() => {
  'use strict';

  const { DEFAULT_KNOWN_TYPES, DEFAULT_SELECTED_TYPES } = globalThis.Qingliu;

  const master = document.getElementById('master');
  const typesEl = document.getElementById('types');
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

  master.addEventListener('change', () => {
    chrome.storage.local.set({ enabled: master.checked });
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
    if (changes.knownTypes) {
      knownTypes = [...(changes.knownTypes.newValue || [])];
      renderTypes();
    }
    if (changes.selectedTypes) {
      selectedTypes = new Set(changes.selectedTypes.newValue || []);
      renderTypes();
    }
  });

  chrome.storage.local
    .get({
      enabled: true,
      selectedTypes: [...DEFAULT_SELECTED_TYPES],
      knownTypes: [...DEFAULT_KNOWN_TYPES],
    })
    .then((data) => {
      master.checked = !!data.enabled;
      selectedTypes = new Set(data.selectedTypes || []);
      knownTypes = [...(data.knownTypes || [])];
      renderTypes();
      refreshCount();
    });
})();
