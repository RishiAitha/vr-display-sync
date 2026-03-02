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

async function main() {
  document.body.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  document.body.style.margin = '24px';

  const title = el('h1', { text: 'Settings' });
  const status = el('div', { text: '' });
  status.style.marginTop = '12px';

  const formRow = el('div');
  formRow.style.display = 'flex';
  formRow.style.gap = '12px';
  formRow.style.alignItems = 'center';
  formRow.style.marginTop = '12px';

  const label = el('label', { text: 'Screen geometry:' });
  label.htmlFor = 'screenGeometryMode';

  const select = el('select', { id: 'screenGeometryMode' });
  const optCurved = el('option', { value: 'curved', text: 'Curved LED wall (default)' });
  const optFlat = el('option', { value: 'flat', text: 'Flat plane (testing)' });
  select.append(optCurved, optFlat);

  const applyBtn = el('button', { type: 'button', text: 'Apply' });

  const gameRow = el('div');
  gameRow.style.display = 'flex';
  gameRow.style.gap = '12px';
  gameRow.style.alignItems = 'center';
  gameRow.style.marginTop = '12px';

  const gameLabel = el('label', { text: 'Active game:' });
  gameLabel.htmlFor = 'activeGameId';
  const gameSelect = el('select', { id: 'activeGameId' });
  gameSelect.append(
    el('option', { value: 'balls', text: 'Balls (default)' }),
    el('option', { value: 'paint', text: 'Paint' }),
    el('option', { value: 'draw', text: 'Draw (pinch ray)' })
  );
  gameRow.append(gameLabel, gameSelect);

  const overlayRow = el('div');
  overlayRow.style.display = 'flex';
  overlayRow.style.gap = '12px';
  overlayRow.style.alignItems = 'center';
  overlayRow.style.marginTop = '12px';

  const overlayLabel = el('label', { text: 'Display Overlay:' });
  overlayLabel.htmlFor = 'displayOverlayEnabled';
  const overlayCheckbox = el('input', { id: 'displayOverlayEnabled', type: 'checkbox' });
  overlayRow.append(overlayLabel, overlayCheckbox);

  const handsDebugRow = el('div');
  handsDebugRow.style.display = 'flex';
  handsDebugRow.style.gap = '12px';
  handsDebugRow.style.alignItems = 'center';
  handsDebugRow.style.marginTop = '12px';

  const handsDebugLabel = el('label', { text: 'Hand joints debug:' });
  handsDebugLabel.htmlFor = 'handJointsDebugEnabled';
  const handsDebugCheckbox = el('input', { id: 'handJointsDebugEnabled', type: 'checkbox' });
  handsDebugRow.append(handsDebugLabel, handsDebugCheckbox);

  const handTuningRow = el('div');
  handTuningRow.style.display = 'flex';
  handTuningRow.style.gap = '12px';
  handTuningRow.style.alignItems = 'center';
  handTuningRow.style.marginTop = '12px';

  const handTouchRadiusLabel = el('label', { text: 'Hand touch radius (m):' });
  handTouchRadiusLabel.htmlFor = 'handTouchRadiusMeters';
  const handTouchRadiusInput = el('input', { id: 'handTouchRadiusMeters', type: 'number', step: '0.005', min: '0' });
  handTouchRadiusInput.style.width = '120px';
  handTouchRadiusInput.value = '0.06';

  const handMinSpeedLabel = el('label', { text: 'Hand min swipe speed (m/s):' });
  handMinSpeedLabel.htmlFor = 'handMinSwipeSpeedMetersPerSec';
  const handMinSpeedInput = el('input', { id: 'handMinSwipeSpeedMetersPerSec', type: 'number', step: '0.05', min: '0' });
  handMinSpeedInput.style.width = '120px';
  handMinSpeedInput.value = '0.25';

  const handCooldownLabel = el('label', { text: 'Hand per-ball cooldown (s):' });
  handCooldownLabel.htmlFor = 'handSwipeBallCooldownSec';
  const handCooldownInput = el('input', { id: 'handSwipeBallCooldownSec', type: 'number', step: '0.01', min: '0' });
  handCooldownInput.style.width = '120px';
  handCooldownInput.value = '0.10';

  handTuningRow.append(handTouchRadiusLabel, handTouchRadiusInput, handMinSpeedLabel, handMinSpeedInput, handCooldownLabel, handCooldownInput);

  const gravityRow = el('div');
  gravityRow.style.display = 'flex';
  gravityRow.style.gap = '12px';
  gravityRow.style.alignItems = 'center';
  gravityRow.style.marginTop = '12px';

  const gravityLabel = el('label', { text: 'Gravity multiplier:' });
  gravityLabel.htmlFor = 'gravityMultiplier';
  const gravityInput = el('input', { id: 'gravityMultiplier', type: 'number', step: '0.1', min: '0' });
  gravityInput.style.width = '120px';
  gravityRow.append(gravityLabel, gravityInput);

  const swipeForceRow = el('div');
  swipeForceRow.style.display = 'flex';
  swipeForceRow.style.gap = '12px';
  swipeForceRow.style.alignItems = 'center';
  swipeForceRow.style.marginTop = '12px';

  const swipeForceLabel = el('label', { text: 'Swipe force multiplier:' });
  swipeForceLabel.htmlFor = 'swipeForceMultiplier';
  const swipeForceInput = el('input', { id: 'swipeForceMultiplier', type: 'number', step: '0.1', min: '0' });
  swipeForceInput.style.width = '120px';
  swipeForceRow.append(swipeForceLabel, swipeForceInput);

  formRow.append(label, select);

  const hint = el('div', { text: 'Applies while the server is running. Connected clients will receive updates automatically.' });
  hint.style.marginTop = '12px';
  hint.style.opacity = '0.8';

  const tabsBar = el('div');
  tabsBar.style.display = 'flex';
  tabsBar.style.gap = '8px';
  tabsBar.style.marginTop = '16px';

  const tabGeneralBtn = el('button', { type: 'button', text: 'General' });
  const tabPhysicsBtn = el('button', { type: 'button', text: 'Physics' });
  const tabHandsBtn = el('button', { type: 'button', text: 'Hands' });
  const tabDrawBtn = el('button', { type: 'button', text: 'Draw' });
  tabsBar.append(tabGeneralBtn, tabPhysicsBtn, tabHandsBtn, tabDrawBtn);

  const actionBar = el('div');
  actionBar.style.display = 'flex';
  actionBar.style.gap = '12px';
  actionBar.style.alignItems = 'center';
  actionBar.style.marginTop = '12px';
  actionBar.append(applyBtn);

  const panelGeneral = el('div');
  const panelPhysics = el('div');
  const panelHands = el('div');
  const panelDraw = el('div');

  const panels = [panelGeneral, panelPhysics, panelHands, panelDraw];
  const setActivePanel = (panel) => {
    for (const p of panels) p.style.display = (p === panel ? 'block' : 'none');
  };

  const styleTabButton = (btn, active) => {
    btn.style.padding = '8px 10px';
    btn.style.borderRadius = '8px';
    btn.style.border = '1px solid #ccc';
    btn.style.background = active ? '#111' : '#fff';
    btn.style.color = active ? '#fff' : '#111';
    btn.style.cursor = 'pointer';
  };

  const setActiveTab = (name) => {
    styleTabButton(tabGeneralBtn, name === 'general');
    styleTabButton(tabPhysicsBtn, name === 'physics');
    styleTabButton(tabHandsBtn, name === 'hands');
    styleTabButton(tabDrawBtn, name === 'draw');
    setActivePanel(name === 'general' ? panelGeneral : (name === 'physics' ? panelPhysics : (name === 'hands' ? panelHands : panelDraw)));
  };

  tabGeneralBtn.addEventListener('click', () => setActiveTab('general'));
  tabPhysicsBtn.addEventListener('click', () => setActiveTab('physics'));
  tabHandsBtn.addEventListener('click', () => setActiveTab('hands'));
  tabDrawBtn.addEventListener('click', () => setActiveTab('draw'));

  panelGeneral.append(gameRow, formRow, overlayRow);
  panelPhysics.append(gravityRow, swipeForceRow);
  panelHands.append(handsDebugRow, handTuningRow);

  const drawHint = el('div', { text: 'Used by the Draw game (pinch ray).' });
  drawHint.style.marginTop = '12px';
  drawHint.style.opacity = '0.8';

  const drawColorRow = el('div');
  drawColorRow.style.display = 'flex';
  drawColorRow.style.gap = '12px';
  drawColorRow.style.alignItems = 'center';
  drawColorRow.style.marginTop = '12px';

  const drawColorLabel = el('label', { text: 'Color:' });
  drawColorLabel.htmlFor = 'drawColorHex';
  const drawColorInput = el('input', { id: 'drawColorHex', type: 'color' });
  drawColorInput.value = '#111111';
  drawColorRow.append(drawColorLabel, drawColorInput);

  const drawAlphaRow = el('div');
  drawAlphaRow.style.display = 'flex';
  drawAlphaRow.style.gap = '12px';
  drawAlphaRow.style.alignItems = 'center';
  drawAlphaRow.style.marginTop = '12px';

  const drawAlphaLabel = el('label', { text: 'Alpha (0-1):' });
  drawAlphaLabel.htmlFor = 'drawAlpha';
  const drawAlphaInput = el('input', { id: 'drawAlpha', type: 'number', step: '0.05', min: '0', max: '1' });
  drawAlphaInput.style.width = '120px';
  drawAlphaInput.value = '0.22';
  drawAlphaRow.append(drawAlphaLabel, drawAlphaInput);

  const drawThicknessRow = el('div');
  drawThicknessRow.style.display = 'flex';
  drawThicknessRow.style.gap = '12px';
  drawThicknessRow.style.alignItems = 'center';
  drawThicknessRow.style.marginTop = '12px';

  const drawThicknessLabel = el('label', { text: 'Thickness (px):' });
  drawThicknessLabel.htmlFor = 'drawThicknessPx';
  const drawThicknessInput = el('input', { id: 'drawThicknessPx', type: 'number', step: '1', min: '1' });
  drawThicknessInput.style.width = '120px';
  drawThicknessInput.value = '20';
  drawThicknessRow.append(drawThicknessLabel, drawThicknessInput);

  const drawClearRow = el('div');
  drawClearRow.style.display = 'flex';
  drawClearRow.style.gap = '12px';
  drawClearRow.style.alignItems = 'center';
  drawClearRow.style.marginTop = '12px';

  const drawClearBtn = el('button', { type: 'button', text: 'Clear Canvas' });
  drawClearRow.append(drawClearBtn);

  panelDraw.append(drawHint, drawColorRow, drawAlphaRow, drawThicknessRow, drawClearRow);

  document.body.append(title, tabsBar, actionBar, panelGeneral, panelPhysics, panelHands, panelDraw, hint, status);
  setActiveTab('general');

  try {
    const cfg = await fetchConfig();
    if (typeof cfg?.activeGameId === 'string') gameSelect.value = cfg.activeGameId;
    if (cfg?.screenGeometryMode) select.value = cfg.screenGeometryMode;
    if (typeof cfg?.displayOverlayEnabled === 'boolean') overlayCheckbox.checked = cfg.displayOverlayEnabled;
    if (typeof cfg?.handJointsDebugEnabled === 'boolean') handsDebugCheckbox.checked = cfg.handJointsDebugEnabled;
    if (typeof cfg?.handTouchRadiusMeters === 'number') handTouchRadiusInput.value = String(cfg.handTouchRadiusMeters);
    if (typeof cfg?.handMinSwipeSpeedMetersPerSec === 'number') handMinSpeedInput.value = String(cfg.handMinSwipeSpeedMetersPerSec);
    if (typeof cfg?.handSwipeBallCooldownSec === 'number') handCooldownInput.value = String(cfg.handSwipeBallCooldownSec);
    if (typeof cfg?.gravityMultiplier === 'number') gravityInput.value = String(cfg.gravityMultiplier);
    else if (typeof cfg?.gravityPixelsPerSec2 === 'number') gravityInput.value = String(cfg.gravityPixelsPerSec2 / 980);
    if (typeof cfg?.swipeForceMultiplier === 'number') swipeForceInput.value = String(cfg.swipeForceMultiplier);
    if (typeof cfg?.drawColorHex === 'string') drawColorInput.value = cfg.drawColorHex;
    if (typeof cfg?.drawThicknessPx === 'number') drawThicknessInput.value = String(cfg.drawThicknessPx);
    if (typeof cfg?.drawAlpha === 'number') drawAlphaInput.value = String(cfg.drawAlpha);
    status.textContent = 'Loaded current config.';
  } catch (e) {
    status.textContent = String(e);
  }

  applyBtn.addEventListener('click', async () => {
    status.textContent = 'Applying...';
    try {
      const next = {
        activeGameId: gameSelect.value,
        screenGeometryMode: select.value,
        displayOverlayEnabled: overlayCheckbox.checked,
        handJointsDebugEnabled: handsDebugCheckbox.checked,
        gravityMultiplier: Number(gravityInput.value),
        swipeForceMultiplier: Number(swipeForceInput.value),
        drawColorHex: drawColorInput.value,
        drawThicknessPx: Number(drawThicknessInput.value),
        drawAlpha: Number(drawAlphaInput.value)
      };

      const handTouchRadiusMeters = parseFloat(handTouchRadiusInput.value);
      if (Number.isFinite(handTouchRadiusMeters)) next.handTouchRadiusMeters = handTouchRadiusMeters;
      const handMinSwipeSpeedMetersPerSec = parseFloat(handMinSpeedInput.value);
      if (Number.isFinite(handMinSwipeSpeedMetersPerSec)) next.handMinSwipeSpeedMetersPerSec = handMinSwipeSpeedMetersPerSec;
      const handSwipeBallCooldownSec = parseFloat(handCooldownInput.value);
      if (Number.isFinite(handSwipeBallCooldownSec)) next.handSwipeBallCooldownSec = handSwipeBallCooldownSec;

      const updated = await applyConfig(next);
      status.textContent = `Applied: screenGeometryMode=${updated.screenGeometryMode}, displayOverlayEnabled=${updated.displayOverlayEnabled}, handJointsDebugEnabled=${updated.handJointsDebugEnabled}, gravityMultiplier=${updated.gravityMultiplier}, swipeForceMultiplier=${updated.swipeForceMultiplier}`;
    } catch (e) {
      status.textContent = String(e);
    }
  });

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

main();
