import { GAMES } from './games/index.js';
import { SYSTEM_SETTINGS_METADATA } from './defaultSettings.js';

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'className') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const child of children) node.appendChild(child);
  return node;
}

async function fetchConfig() {
  const res = await fetch('/api/config', { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`Failed to load config: ${res.status}`);
  return res.json();
}

async function applyConfig(next) {
  const res = await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(next)
  });
  if (!res.ok) throw new Error(`Failed to apply config: ${res.status}`);
  return res.json();
}

async function clearDraw() {
  const res = await fetch('/api/draw/clear', {
    method: 'POST',
    headers: { 'Accept': 'application/json' }
  });
  if (!res.ok) throw new Error(`Failed to clear draw: ${res.status}`);
  return res.json();
}

/**
 * Gather all settings metadata from system and all games
 */
function getAllSettingsMetadata() {
  const allSettings = [...SYSTEM_SETTINGS_METADATA];
  
  for (const [gameId, { metadata }] of GAMES) {
    if (metadata.settings && metadata.settings.length > 0) {
      allSettings.push(...metadata.settings);
    }
  }
  
  return allSettings;
}

/**
 * Group settings by tab
 */
function groupSettingsByTab(settings) {
  const grouped = {};
  for (const setting of settings) {
    const tab = setting.tab || 'general';
    if (!grouped[tab]) grouped[tab] = [];
    grouped[tab].push(setting);
  }
  return grouped;
}

/**
 * Create an input control for a setting based on its type
 */
function createInputControl(setting, config) {
  const row = el('div');
  row.style.display = 'flex';
  row.style.gap = '12px';
  row.style.alignItems = 'center';
  row.style.marginTop = '12px';

  const label = el('label', { text: setting.label + ':' });
  label.htmlFor = setting.key;

  let input;
  
  switch (setting.type) {
    case 'boolean':
      input = el('input', { id: setting.key, type: 'checkbox' });
      if (typeof config?.[setting.key] === 'boolean') {
        input.checked = config[setting.key];
      } else {
        input.checked = setting.default || false;
      }
      break;
      
    case 'number':
      input = el('input', { 
        id: setting.key, 
        type: 'number',
        step: String(setting.step || 1),
        min: setting.min !== undefined ? String(setting.min) : undefined,
        max: setting.max !== undefined ? String(setting.max) : undefined
      });
      input.style.width = '120px';
      if (typeof config?.[setting.key] === 'number') {
        input.value = String(config[setting.key]);
      } else {
        input.value = String(setting.default || 0);
      }
      break;
      
    case 'color':
      input = el('input', { id: setting.key, type: 'color' });
      if (typeof config?.[setting.key] === 'string') {
        input.value = config[setting.key];
      } else {
        input.value = setting.default || '#000000';
      }
      break;
      
    case 'select':
      input = el('select', { id: setting.key });
      const options = setting.options || [];
      for (const optValue of options) {
        const optLabel = typeof optValue === 'object' ? optValue.label : optValue;
        const optVal = typeof optValue === 'object' ? optValue.value : optValue;
        input.appendChild(el('option', { value: optVal, text: optLabel }));
      }
      if (typeof config?.[setting.key] === 'string') {
        input.value = config[setting.key];
      } else {
        input.value = setting.default || '';
      }
      break;
      
    default:
      input = el('input', { id: setting.key, type: 'text' });
      if (config?.[setting.key] !== undefined) {
        input.value = String(config[setting.key]);
      } else {
        input.value = String(setting.default || '');
      }
  }

  row.append(label, input);
  
  // Add description if present
  if (setting.description) {
    const desc = el('span', { text: setting.description });
    desc.style.fontSize = '0.9em';
    desc.style.opacity = '0.7';
    row.appendChild(desc);
  }
  
  return { row, input };
}

async function main() {
  document.body.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  document.body.style.margin = '24px';

  const title = el('h1', { text: 'Settings' });
  const status = el('div', { text: '' });
  status.style.marginTop = '12px';

  const hint = el('div', { text: 'Applies while the server is running. Connected clients will receive updates automatically.' });
  hint.style.marginTop = '12px';
  hint.style.opacity = '0.8';

  // Load current config
  let config;
  try {
    config = await fetchConfig();
    status.textContent = 'Loaded current config.';
  } catch (e) {
    status.textContent = String(e);
    config = {};
  }

  // Get all settings metadata
  const allSettings = getAllSettingsMetadata();
  const settingsByTab = groupSettingsByTab(allSettings);
  
  // Create tabs
  const tabNames = Object.keys(settingsByTab).sort();
  const tabsBar = el('div');
  tabsBar.style.display = 'flex';
  tabsBar.style.gap = '8px';
  tabsBar.style.marginTop = '16px';

  const tabButtons = {};
  const tabPanels = {};
  const inputsByKey = {};
  
  // Create tab buttons and panels
  for (const tabName of tabNames) {
    const btn = el('button', { type: 'button', text: tabName.charAt(0).toUpperCase() + tabName.slice(1) });
    tabButtons[tabName] = btn;
    tabsBar.appendChild(btn);
    
    const panel = el('div');
    panel.style.marginTop = '16px';
    tabPanels[tabName] = panel;
    
    // Create inputs for this tab
    for (const setting of settingsByTab[tabName]) {
      const { row, input } = createInputControl(setting, config);
      panel.appendChild(row);
      inputsByKey[setting.key] = input;
    }
  }
  
  // Add special "Clear Canvas" button for draw tab if it exists
  if (tabPanels.draw) {
    const drawClearRow = el('div');
    drawClearRow.style.display = 'flex';
    drawClearRow.style.gap = '12px';
    drawClearRow.style.alignItems = 'center';
    drawClearRow.style.marginTop = '16px';
    
    const drawClearBtn = el('button', { type: 'button', text: 'Clear Canvas' });
    drawClearRow.append(drawClearBtn);
    tabPanels.draw.appendChild(drawClearRow);
    
    drawClearBtn.addEventListener('click', async () => {
      status.textContent = 'Clearing...';
      try {
        await clearDraw();
        status.textContent = 'Cleared draw canvas.';
      } catch (e) {
        status.textContent = String(e);
      }
    });
  }

  // Tab switching logic
  const styleTabButton = (btn, active) => {
    btn.style.padding = '8px 10px';
    btn.style.borderRadius = '8px';
    btn.style.border = '1px solid #ccc';
    btn.style.background = active ? '#111' : '#fff';
    btn.style.color = active ? '#fff' : '#111';
    btn.style.cursor = 'pointer';
  };

  const setActiveTab = (name) => {
    for (const tabName of tabNames) {
      styleTabButton(tabButtons[tabName], tabName === name);
      tabPanels[tabName].style.display = (tabName === name ? 'block' : 'none');
    }
  };

  for (const tabName of tabNames) {
    tabButtons[tabName].addEventListener('click', () => setActiveTab(tabName));
  }

  // Apply button
  const actionBar = el('div');
  actionBar.style.display = 'flex';
  actionBar.style.gap = '12px';
  actionBar.style.alignItems = 'center';
  actionBar.style.marginTop = '12px';
  
  const applyBtn = el('button', { type: 'button', text: 'Apply' });
  actionBar.appendChild(applyBtn);

  // Assemble page
  document.body.append(title, tabsBar, actionBar);
  for (const tabName of tabNames) {
    document.body.appendChild(tabPanels[tabName]);
  }
  document.body.append(hint, status);

  // Set initial tab
  if (tabNames.length > 0) {
    setActiveTab(tabNames[0]);
  }

  // Apply button handler
  applyBtn.addEventListener('click', async () => {
    status.textContent = 'Applying...';
    try {
      const next = {};
      
      for (const setting of allSettings) {
        const input = inputsByKey[setting.key];
        if (!input) continue;
        
        switch (setting.type) {
          case 'boolean':
            next[setting.key] = input.checked;
            break;
          case 'number':
            next[setting.key] = Number(input.value);
            break;
          default:
            next[setting.key] = input.value;
        }
      }

      const updated = await applyConfig(next);
      status.textContent = `Applied settings successfully. Active game: ${updated.activeGameId}`;
    } catch (e) {
      status.textContent = String(e);
    }
  });
}

main();
