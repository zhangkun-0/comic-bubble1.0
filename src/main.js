const svgNS = 'http://www.w3.org/2000/svg';

const elements = {
  importButton: document.getElementById('import-image'),
  hiddenImageInput: document.getElementById('hidden-image-input'),
  bubbleType: document.getElementById('bubble-type'),
  strokeWidth: document.getElementById('stroke-width'),
  insertBubble: document.getElementById('insert-bubble'),
  removeBubble: document.getElementById('remove-bubble'),
  viewport: document.getElementById('viewport'),
  scene: document.getElementById('scene'),
  bubbleLayer: document.getElementById('bubble-layer'),
  baseImage: document.getElementById('base-image'),
  placeholder: document.getElementById('placeholder'),
  selectionOverlay: document.getElementById('selection-overlay'),
  inlineEditor: document.getElementById('inline-editor'),
  zoomIndicator: document.getElementById('zoom-indicator'),
  positionIndicator: document.getElementById('position-indicator'),
  fontFamily: document.getElementById('font-family'),
  fontSize: document.getElementById('font-size'),
  toggleBold: document.getElementById('toggle-bold'),
  textContent: document.getElementById('text-content'),
  undo: document.getElementById('undo'),
  exportFormat: document.getElementById('export-format'),
  exportButton: document.getElementById('export'),
  measureBox: document.getElementById('measure-box'),
};

const HANDLE_DIRECTIONS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const CONTROL_PADDING = 28;
const MIN_BODY_SIZE = 80;

const state = {
  canvas: { width: 1200, height: 1600 },
  image: { src: '', width: 0, height: 0 },
  viewport: { zoom: 1, offsetX: 0, offsetY: 0 },
  bubbles: [],
  nextBubbleId: 1,
  selectedBubbleId: null,
  defaultStrokeWidth: 2,
  fontFamily: elements.fontFamily.value,
  fontSize: 24,
  bold: false,
  history: [],
  historyIndex: -1,
  interaction: null,
  inlineEditingBubbleId: null,
  pro5_textPaddingPreset: 3,    // 0~3 共四挡，默认 1（适中）
  pro5_autoWrapEnabled: true,   // 默认自动换行 开
  pro5_charsPerLine: 5,         // 4~10，默认 5（中文“字数”，标点不计数）
};

const overlay = {
  box: null,
  handles: new Map(),
  tailHandle: null,
  pro5Handles: {
    apex: null,
    aim: null,
  },
};
 // === pro5_: 把四挡 padding 换算成像素（相对当前字号，更稳妥） ===
 function pro5_computeTextPaddingFromPreset(bubble) {
   if (!bubble) return { padX: 12, padY: 10 };
   const fontSize = Math.max(10, bubble.fontSize || 20);
     // 三档：紧凑(1) / 适中(3) / 宽松(5)
   const preset = Math.max(1, Math.min(5, state.pro5_textPaddingPreset|0));
   const scaleMap = {1: 0.7, 3: 1.0, 5: 1.4};
   const scale = scaleMap[preset] || 1.0;
   return { padX: Math.round(fontSize * 0.6 * scale), padY: Math.round(fontSize * 0.5 * scale) };
 }
// === pro5_: 简单双字宽换行（中文），标点尽量落行尾 ===
function pro5_wrapTextChinese(text, charsPerLine = 5) {
  const cpl = Math.max(4, Math.min(10, charsPerLine|0));
  const lines = [];
  let buf = '';
  let cnt = 0;
  for (const ch of String(text || '')) {
    const isPunc = /[，。,．\.、！？!?；;]/.test(ch);
    if (isPunc) { buf += ch; lines.push(buf); buf = ''; cnt = 0; continue; }
    buf += ch; cnt += 1;
    if (cnt >= cpl) { lines.push(buf); buf = ''; cnt = 0; }
  }
  if (buf) lines.push(buf);
  return lines;
}
// === pro5_: 获取“显示文本”版本（与编辑端一致，用于导出） ===
function getBubbleDisplayText(bubble) {
  if (!bubble || !bubble.text) return '';
  if (!state.pro5_autoWrapEnabled) {
    // 手动换行：保持原始换行
    return String(bubble.text);
  }
  // 自动换行：调用你已有的 DOM 计算逻辑
  if (typeof pro5_domWrapLines === 'function') {
    const lines = pro5_domWrapLines(
      bubble.text,
      bubble.fontFamily,
      bubble.fontSize,
      bubble.bold,
      getTextRect(bubble).width,
      true
    );
    return lines.join('\n');
  }
  // 兜底逻辑（防止 pro5_domWrapLines 不可用）
  return pro5_wrapTextChinese(String(bubble.text || ''), state.pro5_charsPerLine).join('\n');
}
 // === pro5_: 在右侧挂载三个控件（四挡间距、自动换行、每行字数） ===
function pro5_mountRightPanelControls() {
  if (document.getElementById('pro5-panel')) return;

  const panel = document.createElement('div');
  panel.id = 'pro5-panel';
  // 放进右侧控制栏，采用普通流式布局，不会遮挡按钮
  const host = document.getElementById('right-panel') || document.body;
  panel.style.cssText = 'margin:12px 0 16px 0;padding:10px 12px;background:#ffffff14;border:1px solid rgba(255,255,255,0.08);border-radius:10px;font:12px/1.4 sans-serif;color:#e9edf4;';
  panel.innerHTML = `
    <div style="font-weight:600;margin-bottom:6px">文本排版</div>
    <label style="display:block;margin:6px 0 2px">文字距边框（四挡）</label>
    <input id="pro5-pad" type="range" min="1" max="5" step="2" value="${state.pro5_textPaddingPreset}" style="width:100%">
    <label style="display:block;margin:8px 0 2px">
      <input id="pro5-wrap" type="checkbox" ${state.pro5_autoWrapEnabled ? 'checked':''}> 自动换行
    </label>
    <label style="display:block;margin:6px 0 2px">每行字数（4~10）</label>
    <input id="pro5-cpl" type="range" min="4" max="10" step="1" value="${state.pro5_charsPerLine}" style="width:100%">
  `;
  host.appendChild(panel);

  const pad = panel.querySelector('#pro5-pad');
  const wrap = panel.querySelector('#pro5-wrap');
  const cpl = panel.querySelector('#pro5-cpl');

  pad.addEventListener('input', () => {
    state.pro5_textPaddingPreset = Number(pad.value);
    render();
  });
  wrap.addEventListener('change', () => {
    state.pro5_autoWrapEnabled = !!wrap.checked;
    const b = getSelectedBubble && getSelectedBubble();
    if (b) autoFitBubbleToText(b);
    render();
  });
}


let imagePickerInFlight = false;

function init() {
  setupSelectionOverlay();
  attachEvents();
  elements.strokeWidth.value = state.defaultStrokeWidth; // ← 让UI初始显示 2
  updateSceneSize(state.canvas.width, state.canvas.height);
  fitViewport();
  updateSceneTransform();
  pushHistory();
  render();
  pro5_mountRightPanelControls();
}

function setupSelectionOverlay() {
  overlay.box = document.createElement('div');
  overlay.box.className = 'selection-box';
  elements.selectionOverlay.appendChild(overlay.box);

  HANDLE_DIRECTIONS.forEach((dir) => {
    const handle = document.createElement('div');
    handle.className = 'handle';
    handle.dataset.direction = dir;
    handle.addEventListener('pointerdown', (event) => startResize(event, dir));
    elements.selectionOverlay.appendChild(handle);
    overlay.handles.set(dir, handle);
  });

  overlay.tailHandle = document.createElement('div');
  overlay.tailHandle.id = 'tail-handle';
  overlay.tailHandle.addEventListener('pointerdown', startTailDrag);
  elements.selectionOverlay.appendChild(overlay.tailHandle);
}

function attachEvents() {
  elements.importButton.addEventListener('click', handleImportButtonClick);
  elements.hiddenImageInput.addEventListener('change', handleImageSelection);
  elements.insertBubble.addEventListener('click', insertBubbleFromControls);
  elements.removeBubble.addEventListener('click', removeSelectedBubble);
  elements.strokeWidth.addEventListener('change', handleStrokeChange);
  elements.fontFamily.addEventListener('change', handleFontFamilyChange);
  elements.fontSize.addEventListener('change', handleFontSizeChange);
  elements.toggleBold.addEventListener('click', toggleBold);
  elements.textContent.addEventListener('input', handleTextInput);
  elements.undo.addEventListener('click', undo);
  elements.exportButton.addEventListener('click', pro5_exportPNG);

  elements.viewport.addEventListener('wheel', handleWheel, { passive: false });
  elements.viewport.addEventListener('pointerdown', handleViewportPointerDown);
  elements.viewport.addEventListener('dblclick', handleViewportDoubleClick);
  window.addEventListener('pointermove', handlePointerMove);
  window.addEventListener('pointerup', handlePointerUp);

  elements.bubbleLayer.addEventListener('pointerdown', handleBubblePointerDown);
  elements.bubbleLayer.addEventListener('dblclick', handleBubbleDoubleClick);

  document.addEventListener('keydown', handleKeyDown);
}

function handleImportButtonClick() {
  openImagePicker();
}

function handleViewportDoubleClick(event) {
  const target = event.target;
  if (target instanceof Element && target.closest('[data-bubble-id]')) {
    return;
  }
  if (state.inlineEditingBubbleId) {
    return;
  }
  openImagePicker();
}

function handleImageSelection(event) {
  const [file] = event.target.files;
  event.target.value = '';
  if (!file) return;
  readFileAsDataURL(file)
    .then((dataUrl) => loadImage(dataUrl))
    .catch((error) => {
      console.error('读取图片失败', error);
    });
}

function openImagePicker() {
  if (imagePickerInFlight) {
    return;
  }
  imagePickerInFlight = true;
  try {
    const input = elements.hiddenImageInput;
    if (!input) {
      return;
    }
    input.value = '';
    let pickerShown = false;
    if (typeof input.showPicker === 'function') {
      try {
        input.showPicker();
        pickerShown = true;
      } catch (error) {
        if (error?.name === 'AbortError') {
          return;
        }
        console.warn('showPicker 不可用，回退到 click()', error);
      }
    }
    if (!pickerShown) {
      input.click();
    }
  } finally {
    imagePickerInFlight = false;
  }
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') {
        resolve(result);
      } else {
        reject(new Error('无法解析为 DataURL'));
      }
    };
    reader.onerror = () => {
      reject(reader.error || new Error('文件读取失败'));
    };
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl) {
  const img = new Image();
  img.onload = () => {
    state.image = { src: dataUrl, width: img.naturalWidth, height: img.naturalHeight };
    elements.baseImage.src = dataUrl;
    elements.baseImage.width = img.naturalWidth;
    elements.baseImage.height = img.naturalHeight;
    updateSceneSize(img.naturalWidth, img.naturalHeight);
    fitViewport();
    elements.placeholder.style.display = 'none';
    pushHistory();
    render();
  };
  img.src = dataUrl;
}

function updateSceneSize(width, height) {
  state.canvas.width = width;
  state.canvas.height = height;
  elements.scene.style.width = `${width}px`;
  elements.scene.style.height = `${height}px`;
  elements.bubbleLayer.setAttribute('width', width);
  elements.bubbleLayer.setAttribute('height', height);
  elements.bubbleLayer.setAttribute('viewBox', `0 0 ${width} ${height}`);
}

function fitViewport() {
  const { clientWidth, clientHeight } = elements.viewport;
  const scaleX = clientWidth / state.canvas.width;
  const scaleY = clientHeight / state.canvas.height;
  const zoom = Math.min(scaleX, scaleY) * 0.9;
  state.viewport.zoom = clamp(zoom || 1, 0.1, 4);
  const offsetX = (clientWidth - state.canvas.width * state.viewport.zoom) / 2;
  const offsetY = (clientHeight - state.canvas.height * state.viewport.zoom) / 2;
  state.viewport.offsetX = offsetX;
  state.viewport.offsetY = offsetY;
  updateSceneTransform();
}

function updateSceneTransform() {
  const { zoom, offsetX, offsetY } = state.viewport;
  elements.scene.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${zoom})`;
  elements.zoomIndicator.textContent = `缩放：${Math.round(zoom * 100)}%`;
  updateSelectionOverlay();
}

function worldToScreen(point) {
  const { zoom, offsetX, offsetY } = state.viewport;
  return {
    x: offsetX + point.x * zoom,
    y: offsetY + point.y * zoom,
  };
}

function screenDeltaToWorld(deltaX, deltaY) {
  const { zoom } = state.viewport;
  return {
    x: deltaX / zoom,
    y: deltaY / zoom,
  };
}

function clientToWorldPoint(event) {
  const svg = elements.bubbleLayer;
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) {
    return { x: 0, y: 0 };
  }
  const inverted = ctm.inverse();
  const result = point.matrixTransform(inverted);
  return { x: result.x, y: result.y };
}

function normToAbs(bubble, point) {
  return {
    x: bubble.x + bubble.width * point.nx,
    y: bubble.y + bubble.height * point.ny,
  };
}

function absToNorm(bubble, point) {
  return {
    nx: (point.x - bubble.x) / bubble.width,
    ny: (point.y - bubble.y) / bubble.height,
  };
}

function ellipseFromBubble(bubble) {
  const inset = Math.max(1, bubble.strokeWidth * 0.5);
  const rx = Math.max(8, bubble.width / 2 - inset);
  const ry = Math.max(8, bubble.height / 2 - inset);
  const cx = bubble.x + bubble.width / 2;
  const cy = bubble.y + bubble.height / 2;
  return { cx, cy, rx, ry };
}

function rot(ux, uy, radians) {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: ux * cos - uy * sin,
    y: ux * sin + uy * cos,
  };
}

function rayIntersectEllipse(px, py, ux, uy, cx, cy, rx, ry) {
  const length = Math.hypot(ux, uy) || 1;
  const dxNorm = ux / length;
  const dyNorm = uy / length;
  const dx = px - cx;
  const dy = py - cy;
  const A = (dxNorm * dxNorm) / (rx * rx) + (dyNorm * dyNorm) / (ry * ry);
  const B =
    (2 * dx * dxNorm) / (rx * rx) +
    (2 * dy * dyNorm) / (ry * ry);
  const C = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) - 1;
  const D = B * B - 4 * A * C;
  if (D < 0) return null;
  const sqrtD = Math.sqrt(D);
  const t1 = (-B - sqrtD) / (2 * A);
  const t2 = (-B + sqrtD) / (2 * A);
  const candidates = [t1, t2].filter((t) => t > 0);
  if (candidates.length === 0) return null;
  const t = Math.min(...candidates);
  return {
    x: px + dxNorm * t,
    y: py + dyNorm * t,
    t,
  };
}
// === pro5_: 根据自动换行后的文本尺寸，动态调整 bubble.width / height ===
function pro5_fitBubbleToText(bubble) {
  if (!state.pro5_autoWrapEnabled) return;
  if (!bubble || !bubble.text) return;
  // 1) 计算行
  const raw = String(bubble.text || '');
  const cpl = Math.max(4, Math.min(10, state.pro5_charsPerLine|0));
  const lines = (typeof pro5_wrapTextChinese === 'function')
    ? pro5_wrapTextChinese(raw, cpl)
    : raw.split('\n');
  // 2) 量宽度
  const fontSize = Math.max(10, bubble.fontSize || 20);
  const lineHeight = Math.round(fontSize * 1.2);
  const cvs = pro5_fitBubbleToText._c || (pro5_fitBubbleToText._c = document.createElement('canvas'));
  const ctx = cvs.getContext('2d');
  ctx.font = `${bubble.bold ? 'bold ' : ''}${fontSize}px ${bubble.fontFamily}`;
  let maxW = 0;
  for (const line of lines) {
    maxW = Math.max(maxW, ctx.measureText(line).width);
  }
  // 3) 叠加内边距（原 padding + 四挡 padding）
  const basePad = Math.max(20, bubble.padding|0);
  const extra = (typeof pro5_computeTextPaddingFromPreset === 'function')
    ? pro5_computeTextPaddingFromPreset(bubble)
    : { padX: 0, padY: 0 };
  const padX = basePad + (extra.padX||0);
  const padY = basePad + (extra.padY||0);
  // 4) 得到目标尺寸（保底 40）
  const wantW = Math.max(40, Math.ceil(maxW + padX * 2));
  const wantH = Math.max(40, Math.ceil(lines.length * lineHeight + padY * 2));
  // 5) 只在变更时写回，避免无意义重绘
  if (wantW !== bubble.width || wantH !== bubble.height) {
    bubble.width = wantW;
    bubble.height = wantH;
  }
}
// === pro5_: 简单双字宽换行（中文），标点尽量落行尾 ===
function pro5_wrapTextChinese(text, charsPerLine = 5) {
  const cpl = Math.max(4, Math.min(10, charsPerLine|0));
  const lines = []; let buf = ''; let cnt = 0;
  for (const ch of String(text || '')) {
    const isPunc = /[，。,．\.、！？!?；;]/.test(ch);
    if (isPunc) { buf += ch; lines.push(buf); buf=''; cnt=0; continue; }
    buf += ch; cnt += 1;
    if (cnt >= cpl) { lines.push(buf); buf=''; cnt=0; }
  }
  if (buf) lines.push(buf);
  return lines;
}
// === pro5_: 基础清洗（去零宽、统一换行、合并多空白） ===
function pro5_sanitizeText(text) {
  let s = String(text ?? '');
  s = s.replace(/[\u200B-\u200D\uFEFF]/g, '');
  s = s.replace(/\r\n?/g, '\n');
  s = s.replace(/[ \t\u3000]+/g, ' ');
  s = s.replace(/^\s+|\s+$/g, '');
  return s;
}
// === pro5_: 用与编辑端相同的 CSS 在隐藏 DOM 中获得逐行文本（所见即所得） ===
function pro5_domWrapLines(text, fontFamily, fontSize, bold, maxWidth, autoWrapEnabled) {
  const host = document.createElement('div');
  host.style.cssText = `
    position:absolute;left:-99999px;top:0;visibility:hidden;
    width:${Math.max(1, Math.floor(maxWidth))}px;
    font-family:${fontFamily}; font-size:${fontSize}px; font-weight:${bold ? 700 : 400};
    line-height:${Math.round(fontSize * 1.2)}px; text-align:left;
    white-space:${autoWrapEnabled ? 'pre-wrap' : 'pre'};
    word-break:${autoWrapEnabled ? 'break-word' : 'normal'};
  `;
  host.textContent = pro5_sanitizeText(text);
  document.body.appendChild(host);
  const range = document.createRange();
  const lines = [];
  let start = 0;
  while (start < host.textContent.length) {
    // 逐字符扩展，直到下一字符导致换行（offsetTop 变化）
    const baseTop = host.firstChild ? (function () {
      range.setStart(host.firstChild, start);
      range.setEnd(host.firstChild, start + 1);
      return range.getBoundingClientRect().top;
    }()) : 0;
    let i = start + 1, lastTop = baseTop;
    for (; i <= host.textContent.length; i++) {
      range.setStart(host.firstChild, start);
      range.setEnd(host.firstChild, i);
      const rect = range.getBoundingClientRect();
      if (rect.top !== lastTop) break; // 换行了
      lastTop = rect.top;
    }
    lines.push(host.textContent.slice(start, i - 1));
    start = i - 1;
    if (host.textContent[start] === '\n') start++; // 跳过显式换行
  }
  document.body.removeChild(host);
  return lines;
}


// === pro5_: 按给定最大宽度做“自然换行”（自动换行=开）；自动换行=关时只按 \n 分行 ===
function pro5_wrapByWidth(text, ctx, maxWidth, autoWrapEnabled) {
  const raw = pro5_sanitizeText(text);
  if (!autoWrapEnabled) return raw.split('\n'); // 手动换行：只尊重 \n

  const lines = [];
  let buf = '';
  for (const ch of raw) {
    if (ch === '\n') { lines.push(buf); buf = ''; continue; }
    const test = buf + ch;
    if (ctx.measureText(test).width <= maxWidth) {
      buf = test;
    } else {
      if (buf === '') { lines.push(ch); }   // 单字符也过宽，硬切
      else { lines.push(buf); buf = ch; }
    }
  }
  if (buf) lines.push(buf);
  return lines;
}

// === pro5_: 用隐藏 DOM 测量指定宽度下文本需要的高度（与编辑端样式一致） ===
function pro5_measureTextHeight(text, fontFamily, fontSize, fontWeight, maxWidth, autoWrapEnabled) {
  const probe = document.createElement('div');
  probe.style.position = 'absolute';
  probe.style.left = '-99999px';
  probe.style.top = '0';
  probe.style.width = `${Math.max(1, Math.floor(maxWidth))}px`;
  probe.style.fontFamily = fontFamily;
  probe.style.fontSize = `${fontSize}px`;
  probe.style.fontWeight = fontWeight ? '700' : '400';
  probe.style.whiteSpace = autoWrapEnabled ? 'pre-wrap' : 'pre';
  probe.style.wordBreak  = autoWrapEnabled ? 'break-word' : 'normal';
  probe.style.lineHeight = Math.round(fontSize * 1.2) + 'px';
  probe.style.visibility = 'hidden';
  probe.textContent = pro5_sanitizeText(text);
  document.body.appendChild(probe);
  const h = probe.scrollHeight;
  document.body.removeChild(probe);
  return h;
}

// === pro5_: 在“文本或换行模式变更”时，只增大 bubble.height 以完全容纳文本（不改宽度） ===
function pro5_autoFitHeightOnText(bubble) {
  if (!bubble) return;
  // 文字实际可用矩形
  const rect = getTextRect(bubble);
  const needH = pro5_measureTextHeight(
    bubble.text, bubble.fontFamily, bubble.fontSize, bubble.bold,
    rect.width, state.pro5_autoWrapEnabled
  );
  // 若装不下，则把 bubble.height 增到恰好装下（保持当前宽度不变）
  if (needH > rect.height) {
    const padY = rect.y - bubble.y;                 // 顶部内边距
    const newHeight = Math.ceil(needH + padY * 2);  // 还原到外框高度
    bubble.height = Math.max(bubble.height, newHeight);
  }
}


function tailPath5deg(bubble) {
  if (!bubble.tail || !bubble.tail.apex || !bubble.tail.aim) {
    return { d: '' };
  }
  const angleDeg = bubble.tail?.angleDeg ?? 15;
  const halfAngle = ((angleDeg * Math.PI) / 180) / 2;
  const ellipse = ellipseFromBubble(bubble);
  const apex = normToAbs(bubble, bubble.tail.apex);
  const aim = normToAbs(bubble, bubble.tail.aim);

  const dir = { x: aim.x - apex.x, y: aim.y - apex.y };
  const length = Math.hypot(dir.x, dir.y) || 1;
  const unit = { x: dir.x / length, y: dir.y / length };
  const ray1 = rot(unit.x, unit.y, halfAngle);
  const ray2 = rot(unit.x, unit.y, -halfAngle);

  let base1 = rayIntersectEllipse(
    apex.x,
    apex.y,
    ray1.x,
    ray1.y,
    ellipse.cx,
    ellipse.cy,
    ellipse.rx,
    ellipse.ry,
  );
  let base2 = rayIntersectEllipse(
    apex.x,
    apex.y,
    ray2.x,
    ray2.y,
    ellipse.cx,
    ellipse.cy,
    ellipse.rx,
    ellipse.ry,
  );

  if (!base1 || !base2) {
    const fallbackDir = { x: ellipse.cx - apex.x, y: ellipse.cy - apex.y };
    const fallbackLength = Math.hypot(fallbackDir.x, fallbackDir.y) || 1;
    const fallbackUnit = { x: fallbackDir.x / fallbackLength, y: fallbackDir.y / fallbackLength };
    const fallbackRay1 = rot(fallbackUnit.x, fallbackUnit.y, halfAngle);
    const fallbackRay2 = rot(fallbackUnit.x, fallbackUnit.y, -halfAngle);
    base1 = rayIntersectEllipse(
      apex.x,
      apex.y,
      fallbackRay1.x,
      fallbackRay1.y,
      ellipse.cx,
      ellipse.cy,
      ellipse.rx,
      ellipse.ry,
    );
    base2 = rayIntersectEllipse(
      apex.x,
      apex.y,
      fallbackRay2.x,
      fallbackRay2.y,
      ellipse.cx,
      ellipse.cy,
      ellipse.rx,
      ellipse.ry,
    );
  }

  if (!base1 || !base2) {
    return { d: '' };
  }

  return {
    d: `M ${base1.x} ${base1.y} L ${apex.x} ${apex.y} L ${base2.x} ${base2.y} Z`, 
    base1, base2
  };
}
// === pro5_: 取得/创建 <defs> 容器（用于 clipPath） ===
function pro5_getDefs() {
  const svg = elements.bubbleLayer && elements.bubbleLayer.closest('svg');
  if (!svg) return null;
  let defs = svg.querySelector('defs#pro5-defs');
  if (!defs) {
    defs = document.createElementNS(svgNS, 'defs');
    defs.id = 'pro5-defs';
    svg.insertBefore(defs, svg.firstChild);
  }
  return defs;
}

// === pro5_: 直角矩形对话框之间的接缝覆盖（只对 type==='rectangle' 生效） ===
function pro5_drawRectSeams() {
  const layer = elements.bubbleLayer;
  if (!layer) return;

  // 清理旧接缝与旧 clipPath
  [...layer.querySelectorAll('.pro5-rect-seam')].forEach(n => n.remove());
  const defs = pro5_getDefs();
  if (!defs) return;
  [...defs.querySelectorAll('.pro5-rect-clip')].forEach(n => n.remove());

  // 仅参与的对象：纯直角矩形对话框
  const rects = state.bubbles.filter(b => b && b.type === 'rectangle');
  if (rects.length < 2) return;

  // 与现有黑描边一致，略粗一点盖缝
  const baseSW = (getSelectedBubble()?.strokeWidth || state.defaultStrokeWidth);
  const seamSW = baseSW * 2.0; // 若仍见细灰，可调 2.2~2.4

  // 生成 path 字符串要与主体一致：直接复用现有的 createRectanglePath(bubble)
  function pathOfRect(b) {
    return createRectanglePath(b);
  }

  // 为 B 建 clipPath，ID 唯一
  function ensureClipFor(b) {
    const id = `pro5-rect-clip-${b.id}`;
    let cp = defs.querySelector(`#${id}`);
    if (!cp) {
      cp = document.createElementNS(svgNS, 'clipPath');
      cp.id = id;
      cp.setAttribute('class', 'pro5-rect-clip');
      const p = document.createElementNS(svgNS, 'path');
      p.setAttribute('d', pathOfRect(b));
      cp.appendChild(p);
      defs.appendChild(cp);
    } else {
      // 同步形状（矩形被拉伸后）
      const p = cp.firstElementChild;
      if (p) p.setAttribute('d', pathOfRect(b));
    }
    return `url(#${id})`;
  }

  // 对每对矩形 (A,B)，把 A 的边框用白色粗描边画一遍，但 clip 到 B 的内部，
  // 这样只“擦掉”落在 B 内部的那一段黑线，外侧黑线保持不变。
  for (let i = 0; i < rects.length; i += 1) {
    const A = rects[i];
    const dA = pathOfRect(A);
    for (let j = 0; j < rects.length; j += 1) {
      if (i === j) continue;
      const B = rects[j];

      // 建 B 的 clipPath
      const clipRef = ensureClipFor(B);

      // 画一条沿 A 边框的白线，并裁剪到 B 的内部区域
      const seam = document.createElementNS(svgNS, 'path');
      seam.setAttribute('d', dA);
      seam.setAttribute('fill', 'none');
      seam.setAttribute('stroke', '#ffffff');
      seam.setAttribute('stroke-width', seamSW);
      seam.setAttribute('vector-effect', 'non-scaling-stroke');
      seam.setAttribute('stroke-linecap', 'round');
      seam.setAttribute('stroke-linejoin', 'round');
      seam.setAttribute('paint-order', 'stroke');
      seam.setAttribute('shape-rendering', 'geometricPrecision');
      seam.setAttribute('clip-path', clipRef);     // 关键：仅擦掉 A 在 B 内部的那一段
      seam.setAttribute('class', 'pro5-seam pro5-rect-seam');
      layer.appendChild(seam); // 置于最上层覆盖
    }
  }
}

/* === [1] 新增：合并椭圆+尖角为同一条路径  (放在 tailPath5deg(bubble) 附近) === */
function pro5_mergedEllipseTailPath(bubble) {
  const { cx, cy, rx, ry } = ellipseFromBubble(bubble);
  const { base1, base2 } = tailPath5deg(bubble); // 你已改过：返回 { d, base1, base2 }
  if (!base1 || !base2) return '';

  const apex = normToAbs(bubble, bubble.tail.apex);

  // 取 base2 → base1 的“长弧”，保证外圈一笔连回，不在尖角处重复描边
  const aFrom = Math.atan2(base2.y - cy, base2.x - cx);
  const aTo   = Math.atan2(base1.y - cy, base1.x - cx);
  let delta = aTo - aFrom;
  while (delta <= -Math.PI) delta += Math.PI * 2;
  while (delta >   Math.PI) delta -= Math.PI * 2;
  const sweep = (delta < 0) ? 1 : 0; // 与最短方向相反 → large-arc

  return [
    `M ${base1.x} ${base1.y}`,
    `L ${apex.x} ${apex.y}`,
    `L ${base2.x} ${base2.y}`,
    `A ${rx} ${ry} 0 1 ${sweep} ${base1.x} ${base1.y}`,
    `Z`,
  ].join(' ');
}

function insertBubbleFromControls() {
  const type = elements.bubbleType.value;
  insertBubble(type);
}

function insertBubble(type) {
   // thought-circle 初始 1:1，其它维持原来比例
  const isThoughtCircle = (type === 'thought-circle');
  const baseW = Math.max(320, state.canvas.width * 0.3);
  const baseH = Math.max(220, state.canvas.height * 0.2);
  const width  = isThoughtCircle ? Math.max(260, baseW) : baseW;
  const height = isThoughtCircle ? width : baseH;

  const x = (state.canvas.width - width) / 2;
  const y = (state.canvas.height - height) / 2;
  const bubble = {
    id: `bubble-${state.nextBubbleId++}`,
    type,
    x,
    y,
    width,
    height,
    padding: Math.max(28, Math.min(width, height) * 0.12),
    strokeWidth: Number(elements.strokeWidth.value) || state.defaultStrokeWidth,
    fontFamily: state.fontFamily,
    fontSize: state.fontSize,
    bold: state.bold,
    text: '',
    tail: createDefaultTail(type, x, y, width, height),
  };
  state.bubbles.push(bubble);
  setSelectedBubble(bubble.id);
  pushHistory();
  render();
}

function createDefaultTail(type, x, y, width, height) {
  if (type === 'combo-circle') return null; // 组合框无尾巴
  if (type === 'shout-burst') return null; // 喊叫框默认无尾巴
  if (type === 'speech-pro-5deg') {
    return createDefaultTailPro5(x, y, width, height);
  }
  const base = { anchor: { x: 0.5, y: 1 }, offset: { x: 0, y: 0.45 } };
  if (type === 'speech-left') {
    base.anchor = { x: 0, y: 0.15 };
    base.offset = { x: -0.45, y: 0.2 };
  } else if (type === 'speech-right') {
    base.anchor = { x: 1, y: 0.15 };
    base.offset = { x: 0.45, y: 0.2 };
  } else if (type === 'thought') {
    base.anchor = { x: 0.5, y: 1 };
    base.offset = { x: 0, y: 0.55 };
  } else if (type === 'thought-left') {
    base.anchor = { x: 0.15, y: 1 };
    base.offset = { x: -0.55, y: 0.35 };
  } else if (type === 'thought-right') {
    base.anchor = { x: 0.85, y: 1 };
    base.offset = { x: 0.55, y: 0.35 };
  } else if (type === 'thought-circle') {
    // 新增：圆形思考气泡默认尾巴（可拖拽，方向可变）
  return pro5_createDefaultThoughtCircleTail(x, y, width, height);
  }
  if (type.startsWith('speech') || type.startsWith('thought')) {
    return base;
  }
  return null;
}
// === pro5_: 喊叫对话框路径（把给定 SVG 点列缩放到 bubble 的矩形内） ===
function pro5_createShoutPath(bubble) {
  const pts = [
    [300.00, 70.00],[314.88,136.98],[351.25, 58.75],[341.33,150.22],[385.50,101.91],
    [370.96,165.43],[444.78,128.51],[391.45,197.20],[494.52,179.20],[408.95,225.85],
    [461.38,235.88],[407.90,254.71],[491.45,283.76],[398.71,283.99],[490.72,351.41],
    [387.78,314.95],[420.92,370.92],[363.53,335.85],[392.96,424.82],[334.38,349.85],
    [331.26,427.27],[304.82,360.29],[281.96,456.21],[277.40,351.93],[243.36,405.61],
    [247.64,344.46],[175.88,408.86],[225.14,321.04],[145.18,358.41],[203.14,300.42],
    [139.31,308.49],[195.16,270.38],[87.73,257.41],[195.08,238.05],[126.13,203.41],
    [198.76,205.98],[135.14,146.98],[221.21,181.51],[192.40,121.76],[244.38,157.43],
    [224.48, 63.08],[279.62,145.16],[300.00, 70.00]
  ];
  let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
  for (const [x,y] of pts) { if (x<minX) minX=x; if (y<minY) minY=y; if (x>maxX) maxX=x; if (y>maxY) maxY=y; }
  const srcW = maxX - minX || 1, srcH = maxY - minY || 1;
  const sx = bubble.width / srcW, sy = bubble.height / srcH;
  const ox = bubble.x - minX * sx, oy = bubble.y - minY * sy;
  let d = `M ${ox + pts[0][0]*sx} ${oy + pts[0][1]*sy}`;
  for (let i=1; i<pts.length; i++) {
    const [x,y] = pts[i];
    d += ` L ${ox + x*sx} ${oy + y*sy}`;
  }
  d += ' Z';
  return d;
}
// === pro5_: thought-circle 默认尾巴（使用现有 anchor/offset 体系，可拖拽改变方向） ===
function pro5_createDefaultThoughtCircleTail(x, y, width, height) {
  // 基点：下侧略偏右；偏移：沿基点向外（右下）一点
  return {
    anchor: { x: 0.62, y: 1.0 },   // 0~1 相对圆主体
    offset: { x: 0.12, y: 0.35 },  // 正值向外，便于直接看到三颗小泡泡
  };
}

function createDefaultTailPro5(x, y, width, height) {
  return {
    mode: 'fixedAngle',
    angleDeg: 15,
    apex: { nx: 0.37, ny: 1.35 },
    aim: { nx: 0.33, ny: 0.95 },
  };
}

function cloneTail(tail) {
  if (!tail) return null;
  const cloned = { ...tail };
  if (tail.anchor) {
    cloned.anchor = { ...tail.anchor };
  }
  if (tail.offset) {
    cloned.offset = { ...tail.offset };
  }
  if (tail.apex) {
    cloned.apex = { ...tail.apex };
  }
  if (tail.aim) {
    cloned.aim = { ...tail.aim };
  }
  return cloned;
}

function setSelectedBubble(id) {
  if (state.inlineEditingBubbleId && state.inlineEditingBubbleId !== id) {
    elements.inlineEditor.blur();
  }
  state.selectedBubbleId = id;
  updateControlsFromSelection();
  render();
}

function getSelectedBubble() {
  return state.bubbles.find((bubble) => bubble.id === state.selectedBubbleId) || null;
}

function removeSelectedBubble() {
  const bubble = getSelectedBubble();
  if (!bubble) return;
  state.bubbles = state.bubbles.filter((item) => item.id !== bubble.id);
  state.selectedBubbleId = null;
  pushHistory();
  render();
  updateControlsFromSelection();
}

function handleStrokeChange() {
  const value = Number(elements.strokeWidth.value) || state.defaultStrokeWidth;
  state.defaultStrokeWidth = value;
  const bubble = getSelectedBubble();
  if (bubble) {
    bubble.strokeWidth = value;
    pushHistory();
    render();
  }
}

function handleFontFamilyChange() {
  state.fontFamily = elements.fontFamily.value;
  const bubble = getSelectedBubble();
  if (bubble) {
    bubble.fontFamily = state.fontFamily;
    autoFitBubbleToText(bubble);
    pushHistory();
    render();
  }
}

function handleFontSizeChange() {
  const size = clamp(Number(elements.fontSize.value) || state.fontSize, 10, 200);
  elements.fontSize.value = state.fontSize;
  state.fontSize = size;
  const bubble = getSelectedBubble();
  if (bubble) {
    bubble.fontSize = size;
    autoFitBubbleToText(bubble);
    pushHistory();
    render();
  }
}

function toggleBold() {
  state.bold = !state.bold;
  elements.toggleBold.dataset.active = state.bold ? 'true' : 'false';
  const bubble = getSelectedBubble();
  if (bubble) {
    bubble.bold = state.bold;
    autoFitBubbleToText(bubble);
    pushHistory();
    render();
  }
}

function handleTextInput() {
  const bubble = getSelectedBubble();
  if (!bubble) return;
  bubble.text = elements.textContent.value;
  autoFitBubbleToText(bubble);
  render();
  scheduleHistoryCommit();
}

let historyCommitTimer = null;
function scheduleHistoryCommit() {
  clearTimeout(historyCommitTimer);
  historyCommitTimer = setTimeout(() => {
    pushHistory();
  }, 400);
}

function handleWheel(event) {
  event.preventDefault();
  if (!state.canvas.width || !state.canvas.height) return;
  const { offsetX, offsetY, deltaY } = event;
  const currentZoom = state.viewport.zoom;
  const factor = Math.exp(-deltaY * 0.0015);
  const newZoom = clamp(currentZoom * factor, 0.1, 6);
  const worldX = (offsetX - state.viewport.offsetX) / currentZoom;
  const worldY = (offsetY - state.viewport.offsetY) / currentZoom;
  state.viewport.zoom = newZoom;
  state.viewport.offsetX = offsetX - worldX * newZoom;
  state.viewport.offsetY = offsetY - worldY * newZoom;
  updateSceneTransform();
}

function handleViewportPointerDown(event) {
  if (event.button !== 0) return;
  const target = event.target;
  if (target.closest('[data-bubble-id]')) {
    return;
  }
  if (state.selectedBubbleId) {
    setSelectedBubble(null);
  }
  if (state.inlineEditingBubbleId) {
    elements.inlineEditor.blur();
  }
  state.interaction = {
    type: 'pan',
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    offsetX: state.viewport.offsetX,
    offsetY: state.viewport.offsetY,
  };
  elements.viewport.setPointerCapture(event.pointerId);
}

function handleBubblePointerDown(event) {
  if (event.button !== 0) return;
  const bubbleElement = event.target.closest('[data-bubble-id]');
  if (!bubbleElement) return;
  event.stopPropagation();
  const bubbleId = bubbleElement.dataset.bubbleId;
  const bubble = state.bubbles.find((item) => item.id === bubbleId);
  if (!bubble) return;
  setSelectedBubble(bubble.id);
  state.interaction = {
    type: 'move-bubble',
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    bubbleId: bubble.id,
    bubbleStart: { x: bubble.x, y: bubble.y },
  };
  window.getSelection()?.removeAllRanges();
  elements.viewport.setPointerCapture(event.pointerId);
}

function handleBubbleDoubleClick(event) {
  const bubbleElement = event.target.closest('[data-bubble-id]');
  if (!bubbleElement) return;
  event.stopPropagation();
  const bubbleId = bubbleElement.dataset.bubbleId;
  const bubble = state.bubbles.find((item) => item.id === bubbleId);
  if (!bubble) return;
  setSelectedBubble(bubble.id);
  openInlineEditor(bubble);
}

function startResize(event, direction) {
  event.preventDefault();
  event.stopPropagation();
  const bubble = getSelectedBubble();
  if (!bubble) return;
  state.interaction = {
    type: 'resize',
    pointerId: event.pointerId,
    direction,
    bubbleId: bubble.id,
    bubbleStart: { x: bubble.x, y: bubble.y, width: bubble.width, height: bubble.height },
    startX: event.clientX,
    startY: event.clientY,
    tailSnapshot: bubble.tail ? cloneTail(bubble.tail) : null,
  };
  elements.viewport.setPointerCapture(event.pointerId);
}

function startTailDrag(event) {
  event.preventDefault();
  event.stopPropagation();
  const bubble = getSelectedBubble();
  if (!bubble || !bubble.tail || bubble.type === 'speech-pro-5deg') return;
  state.interaction = {
    type: 'tail',
    pointerId: event.pointerId,
    bubbleId: bubble.id,
    startX: event.clientX,
    startY: event.clientY,
    originalTail: getTailTip(bubble),
  };
  elements.viewport.setPointerCapture(event.pointerId);
}

function handlePointerMove(event) {
  if (!state.interaction || state.interaction.pointerId !== event.pointerId) return;
  if (state.interaction.type === 'pan') {
    const dx = event.clientX - state.interaction.startX;
    const dy = event.clientY - state.interaction.startY;
    state.viewport.offsetX = state.interaction.offsetX + dx;
    state.viewport.offsetY = state.interaction.offsetY + dy;
    updateSceneTransform();
  } else if (state.interaction.type === 'move-bubble') {
    const bubble = state.bubbles.find((item) => item.id === state.interaction.bubbleId);
    if (!bubble) return;
    const { x: deltaX, y: deltaY } = screenDeltaToWorld(
      event.clientX - state.interaction.startX,
      event.clientY - state.interaction.startY,
    );
    bubble.x = state.interaction.bubbleStart.x + deltaX;
    bubble.y = state.interaction.bubbleStart.y + deltaY;
    render();
  } else if (state.interaction.type === 'resize') {
    const bubble = state.bubbles.find((item) => item.id === state.interaction.bubbleId);
    if (!bubble) return;
    const delta = screenDeltaToWorld(
      event.clientX - state.interaction.startX,
      event.clientY - state.interaction.startY,
    );
    applyResize(bubble, state.interaction.direction, delta);
    render();
  } else if (state.interaction.type === 'tail') {
    const bubble = state.bubbles.find((item) => item.id === state.interaction.bubbleId);
    if (!bubble || !bubble.tail) return;
    const { x: deltaX, y: deltaY } = screenDeltaToWorld(
      event.clientX - state.interaction.startX,
      event.clientY - state.interaction.startY,
    );
    const newTip = {
      x: state.interaction.originalTail.x + deltaX,
      y: state.interaction.originalTail.y + deltaY,
    };
    setTailTip(bubble, newTip.x, newTip.y);
    render();
  } else if (state.interaction.type === 'pro5-handle') {
    const bubble = state.bubbles.find((item) => item.id === state.interaction.bubbleId);
    if (!bubble || !bubble.tail) return;
    const worldPoint = clientToWorldPoint(event);
    if (state.interaction.handle === 'apex') {
      bubble.tail.apex = absToNorm(bubble, worldPoint);
    } else if (state.interaction.handle === 'aim') {
      bubble.tail.aim = absToNorm(bubble, worldPoint);
    }
    render();
  }
}

function handlePointerUp(event) {
  if (!state.interaction || state.interaction.pointerId !== event.pointerId) return;
  if (
    state.interaction.type === 'move-bubble' ||
    state.interaction.type === 'resize' ||
    state.interaction.type === 'tail' ||
    state.interaction.type === 'pro5-handle'
  ) {
    pushHistory();
  }
  if (state.interaction.type === 'pan') {
    updateSceneTransform();
  }
  try {
    elements.viewport.releasePointerCapture(event.pointerId);
  } catch (error) {
    // ignore
  }
  state.interaction = null;
}

function applyResize(bubble, direction, delta) {
  let { x, y, width, height } = state.interaction.bubbleStart;
  const minSize = MIN_BODY_SIZE;
  if (direction.includes('n')) {
    const newHeight = clamp(height - delta.y, minSize, Infinity);
    const diff = (newHeight - height);
    y = y - diff;
    height = newHeight;
  }
  if (direction.includes('s')) {
    height = clamp(height + delta.y, minSize, Infinity);
  }
  if (direction.includes('w')) {
    const newWidth = clamp(width - delta.x, minSize, Infinity);
    const diff = (newWidth - width);
    x = x - diff;
    width = newWidth;
  }
  if (direction.includes('e')) {
    width = clamp(width + delta.x, minSize, Infinity);
  }
  bubble.x = x;
  bubble.y = y;
  bubble.width = width;
  bubble.height = height;
  if (state.interaction.tailSnapshot) {
    bubble.tail = cloneTail(state.interaction.tailSnapshot);
  }
}

function getTailBase(bubble) {
  if (!bubble.tail) return null;
  if (bubble.type === 'speech-pro-5deg' && bubble.tail.aim) {
    return normToAbs(bubble, bubble.tail.aim);
  }
  const { anchor } = bubble.tail;
  return {
    x: bubble.x + bubble.width * anchor.x,
    y: bubble.y + bubble.height * anchor.y,
  };
}

function getTailTip(bubble) {
  if (!bubble.tail) return null;
  if (bubble.type === 'speech-pro-5deg' && bubble.tail.apex) {
    return normToAbs(bubble, bubble.tail.apex);
  }
  const base = getTailBase(bubble);
  if (!base) return null;
  return {
    x: base.x + bubble.width * bubble.tail.offset.x,
    y: base.y + bubble.height * bubble.tail.offset.y,
  };
}

function setTailTip(bubble, x, y) {
  if (!bubble.tail) return;
  if (bubble.type === 'speech-pro-5deg') {
    bubble.tail.apex = absToNorm(bubble, { x, y });
    return;
  }
  const centerX = bubble.x + bubble.width / 2;
  const centerY = bubble.y + bubble.height / 2;
  const dx = x - centerX;
  const dy = y - centerY;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  if (absDx > absDy) {
    bubble.tail.anchor.x = dx < 0 ? 0 : 1;
    bubble.tail.anchor.y = clamp((y - bubble.y) / bubble.height, 0.15, 0.85);
  } else {
    bubble.tail.anchor.y = dy < 0 ? 0 : 1;
    bubble.tail.anchor.x = clamp((x - bubble.x) / bubble.width, 0.15, 0.85);
  }
  const base = getTailBase(bubble);
  bubble.tail.offset.x = (x - base.x) / bubble.width;
  bubble.tail.offset.y = (y - base.y) / bubble.height;
}

function autoFitBubbleToText(bubble, options = {}) {
   if (!bubble) return;
  const rect = getTextRect(bubble);
  // 按当前宽度测量文本需要的高度
  const measure = elements.measureBox;
  measure.style.position = 'absolute';
  measure.style.left = '-99999px';
  measure.style.top = '0';
  measure.style.width = Math.max(1, Math.floor(rect.width)) + 'px';
  measure.style.fontFamily = bubble.fontFamily;
  measure.style.fontSize = `${bubble.fontSize}px`;
  measure.style.fontWeight = bubble.bold ? '700' : '400';
   // 用“显示文本”（已按规则转成 \n）测量；这里统一只按 \n 换，不再额外折行
  const displayText = pro5_sanitizeText(getBubbleDisplayText(bubble) || '');
  measure.textContent = displayText;
  measure.style.whiteSpace = 'pre-line';  // 只把 \n 当换行
  measure.style.wordBreak  = 'normal';
  measure.style.lineHeight = Math.round(bubble.fontSize * 1.2) + 'px';
  measure.style.visibility = 'hidden';
  document.body.appendChild(measure);

  const textHeight = measure.scrollHeight;
  document.body.removeChild(measure);

  const padY = rect.y - bubble.y;
  const needHeight = Math.ceil(textHeight + padY * 2);
  if (needHeight > bubble.height) {
    bubble.height = needHeight; // 只增高，不改宽度
  } 
}

function updateControlsFromSelection() {
  const bubble = getSelectedBubble();
  const hasSelection = Boolean(bubble);
  elements.removeBubble.disabled = !hasSelection;
  if (!bubble) {
    elements.textContent.value = '';
    elements.positionIndicator.textContent = '';
    return;
  }
  elements.strokeWidth.value = bubble.strokeWidth;
  elements.fontFamily.value = bubble.fontFamily;
  elements.fontSize.value = bubble.fontSize;
  elements.toggleBold.dataset.active = bubble.bold ? 'true' : 'false';
  elements.textContent.value = bubble.text;
  elements.positionIndicator.textContent = `位置：(${bubble.x.toFixed(0)}, ${bubble.y.toFixed(0)}) 尺寸：${bubble.width.toFixed(0)}×${bubble.height.toFixed(0)}`;
}

function openInlineEditor(bubble) {
  const textRect = getTextRect(bubble);
  const topLeft = worldToScreen({ x: textRect.x, y: textRect.y });
  const bottomRight = worldToScreen({ x: textRect.x + textRect.width, y: textRect.y + textRect.height });
  const width = bottomRight.x - topLeft.x;
  const height = bottomRight.y - topLeft.y;
  const editor = elements.inlineEditor;
  editor.value = bubble.text;
  editor.style.left = `${topLeft.x}px`;
  editor.style.top = `${topLeft.y}px`;
  editor.style.width = `${width}px`;
  editor.style.height = `${height}px`;
  editor.style.fontFamily = bubble.fontFamily;
  editor.style.fontSize = `${bubble.fontSize}px`;
  editor.style.fontWeight = bubble.bold ? '700' : '400';
  editor.classList.remove('hidden');
  editor.focus();
  editor.setSelectionRange(editor.value.length, editor.value.length);
  state.inlineEditingBubbleId = bubble.id;
}

elements.inlineEditor.addEventListener('blur', () => {
  if (!state.inlineEditingBubbleId) return;
  const bubble = state.bubbles.find((item) => item.id === state.inlineEditingBubbleId);
  if (!bubble) return;
  bubble.text = elements.inlineEditor.value;
  autoFitBubbleToText(bubble);
  elements.inlineEditor.classList.add('hidden');
  state.inlineEditingBubbleId = null;
  elements.textContent.value = bubble.text;
  pushHistory();
  render();
});

elements.inlineEditor.addEventListener('input', () => {
  if (!state.inlineEditingBubbleId) return;
  const bubble = state.bubbles.find((item) => item.id === state.inlineEditingBubbleId);
  if (!bubble) return;
  bubble.text = elements.inlineEditor.value;
  autoFitBubbleToText(bubble);
  elements.textContent.value = bubble.text;
  render();
});

elements.inlineEditor.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    elements.inlineEditor.blur();
  }
});

function getTextRect(bubble) {
  const padding = Math.max(20, bubble.padding);
  // === pro5_: 喊叫对话框的专属缩小文字区 ===
  if (bubble.type === 'shout-burst') {
    // 让文字区域缩进更多，使其在内层（红框）区域
    const shrinkX = bubble.width * 0.28;   // 左右各缩 22%
    const shrinkY = bubble.height * 0.32;  // 上下各缩 25%
    const width = Math.max(20, bubble.width - shrinkX * 2);
    const height = Math.max(20, bubble.height - shrinkY * 2);
    return {
      x: bubble.x + shrinkX,
      y: bubble.y + shrinkY,
      width,
      height,
    };
  }
  // === pro5_: 额外四挡内边距 ===
  const padInfo = pro5_computeTextPaddingFromPreset
    ? pro5_computeTextPaddingFromPreset(bubble)
    : { padX: 0, padY: 0 };
  const padX = padInfo.padX || 0;
  const padY = padInfo.padY || 0;

  const width = Math.max(20, bubble.width - padding * 2 - padX * 2);
  const height = Math.max(20, bubble.height - padding * 2 - padY * 2);

  return {
    x: bubble.x + padding + padX,
    y: bubble.y + padding + padY,
    width,
    height,
  };
}

function render() {
  renderBubbles();
  updateSelectionOverlay();
}

function renderBubbles() {
  elements.bubbleLayer.innerHTML = '';
  state.bubbles.forEach((bubble) => {
   // 文本变化后：按当前宽度只增高到能容纳全部文本（不改宽度/比例）
    pro5_autoFitHeightOnText(bubble);
    const group = document.createElementNS(svgNS, 'g');
    group.dataset.bubbleId = bubble.id;
    group.classList.add('bubble');

    const body = createBodyShape(bubble);
    body.classList.add('bubble-body');
    body.setAttribute('stroke-width', bubble.strokeWidth);
    group.appendChild(body);

    const tailElement = createTailShape(bubble);
    if (tailElement) {
      tailElement.classList.add('bubble-tail');
      tailElement.setAttribute('stroke-width', bubble.strokeWidth);
      group.appendChild(tailElement);
    }

    const textRect = getTextRect(bubble);
    const outline = document.createElementNS(svgNS, 'rect');
    outline.setAttribute('class', 'bubble-outline');
    outline.setAttribute('x', textRect.x);
    outline.setAttribute('y', textRect.y);
    outline.setAttribute('width', textRect.width);
    outline.setAttribute('height', textRect.height);
    group.appendChild(outline);

    const textNode = document.createElementNS(svgNS, 'foreignObject');
    textNode.setAttribute('x', textRect.x);
    textNode.setAttribute('y', textRect.y);
    textNode.setAttribute('width', Math.max(1, textRect.width));
    textNode.setAttribute('height', Math.max(1, textRect.height));
    textNode.setAttribute('class', 'text-layer');

    const div = document.createElement('div');
    div.className = 'bubble-text-display';
    div.style.fontFamily = bubble.fontFamily;
    div.style.fontSize = `${bubble.fontSize}px`;
    div.style.fontWeight = bubble.bold ? '700' : '400';
      // pro5_: 改为“自动换行可开关 + 左对齐”，不再按字数硬拆行
    div.style.whiteSpace = state.pro5_autoWrapEnabled ? 'pre-wrap' : 'pre';
    div.style.wordBreak  = state.pro5_autoWrapEnabled ? 'break-word' : 'normal';
    div.style.textAlign  = 'left';
    div.textContent      = pro5_sanitizeText(bubble.text);

    textNode.appendChild(div);
    group.appendChild(textNode);

    elements.bubbleLayer.appendChild(group);
  });
    // pro5_: 组合框与其他圆形气泡的交界改为白色（缝合线）
  pro5_drawComboSeams();
  pro5_drawRectSeams();
}

// === pro5_: 将 bubble 近似为圆（cx, cy, r）。组合框/思想气泡准确为圆；Figma 椭圆取平均半径近似 ===
function pro5_circleFromBubble(b) {
  if (!b) return null;
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  if (b.type === 'combo-circle' || b.type === 'thought-circle') {
    const r = Math.min(b.width, b.height) / 2;
    return { cx, cy, r, type: b.type };
  }
  if (b.type === 'speech-pro-5deg') {
    const e = ellipseFromBubble(b);
    const r = (e.rx + e.ry) / 2; // 简单近似
    return { cx: e.cx, cy: e.cy, r, type: b.type };
  }
  return null;
}

// === pro5_: 两圆求交，返回位于重叠区域内、且 ≤ π 的小弧（在 cA 上）===
 function pro5_circleIntersect(cA, cB) {
   if (!cA || !cB) return null;
   const dx = cB.cx - cA.cx, dy = cB.cy - cA.cy;
   const d  = Math.hypot(dx, dy);
   const r0 = cA.r, r1 = cB.r;
   // 无交、内含或外离都不画缝
   if (d <= 0 || d >= r0 + r1 || d <= Math.abs(r0 - r1)) return null;

   // 交点角
   const a0  = Math.atan2(dy, dx);
   const cos = (r0*r0 + d*d - r1*r1) / (2 * r0 * d);
   const phi = Math.acos(Math.max(-1, Math.min(1, cos)));
   let t1 = a0 - phi;
   let t2 = a0 + phi;

   // 选择“落在重叠区域”的那一段（用中点判定是否同时在两圆内）
   const mid1 = (t1 + t2) / 2;
   const mx1  = cA.cx + r0 * Math.cos(mid1);
   const my1  = cA.cy + r0 * Math.sin(mid1);
   const inside1 = Math.hypot(mx1 - cB.cx, my1 - cB.cy) <= r1 + 1e-6;

   // 另一段的中点（t2→t1），用于对比
   const mid2 = mid1 + Math.PI;
   const mx2  = cA.cx + r0 * Math.cos(mid2);
   const my2  = cA.cy + r0 * Math.sin(mid2);
   const inside2 = Math.hypot(mx2 - cB.cx, my2 - cB.cy) <= r1 + 1e-6;

   // 只要有一段在重叠区，就选那一段；避免选到 > π 的大弧
   let start, end;
   if (inside1 && !inside2) {
     start = t1; end = t2;
   } else if (!inside1 && inside2) {
     start = t2; end = t1;
   } else {
     // 极少数数值边界：不画
     return null;
   }

   // 归一化到 [-π, π]，并确保弧长 ≤ π
   const norm = (a) => Math.atan2(Math.sin(a), Math.cos(a));
   start = norm(start); end = norm(end);
   let span = norm(end - start);
   if (Math.abs(span) > Math.PI) {
     // 取补弧（一定 ≤ π）
     const tmp = start; start = end; end = tmp;
     span = norm(end - start);
   }

   // 轻微收缩，避免端帽外溢
   const eps = 0.02; // ~1.15°
   if (span > 2 * eps) {
     start += Math.sign(span) * eps;
     end   -= Math.sign(span) * eps;
   }

   return { start, end };
 }

// === pro5_: 组合框与其它“椭圆类气泡”的接缝覆盖（任意椭圆，顺序无关）===
function pro5_drawComboSeams() {
  const layer = elements.bubbleLayer;

  // 清理旧接缝
  [...layer.querySelectorAll('.pro5-seam')].forEach(n => n.remove());

  // 组合框
  const combos = state.bubbles.filter(b => b.type === 'combo-circle');
  if (!combos.length) return;

  // 允许与这两类相交：figma 椭圆尖角 / 思想椭圆
  const candidates = state.bubbles.filter(b =>
    b.type === 'speech-pro-5deg' || b.type === 'thought-circle'
  );
  if (!candidates.length) return;

  const baseSW = (getSelectedBubble()?.strokeWidth || state.defaultStrokeWidth);
  const seamSW = baseSW * 2; // 若仍见细灰，可调到 2.2~2.4

  combos.forEach((combo) => {
    // ✅ 用 combo 自身生成“椭圆参数”
    const EA = ellipseFromBubble(combo);
    if (!EA) return;

    candidates.forEach((other) => {
      if (other.id === combo.id) return;

      // ✅ 对方也转为椭圆参数（无论它现在是正圆还是椭圆）
      const EB = ellipseFromBubble(other);
      if (!EB) return;

      // ✅ 在组合框椭圆 EA 上找与 EB 的重叠弧段（小段可能有多段）
      const ranges = pro5_sampleOverlapRanges(EA, EB);
      if (!ranges || !ranges.length) return;

      // ✅ 逐段画“与 EA 完全同轨迹”的白色粗弧，盖住交界黑线
      ranges.forEach(([t0, t1]) => {
        const d = pro5_ellipseArcPath(EA, t0, t1); // 返回 A rx ry… 的 A 命令
        const p = document.createElementNS(svgNS, 'path');
        p.setAttribute('d', d);
        p.setAttribute('fill', 'none');
        p.setAttribute('stroke', '#ffffff');
        p.setAttribute('stroke-width', seamSW);
        p.setAttribute('vector-effect', 'non-scaling-stroke');
        p.setAttribute('stroke-linecap', 'round');
        p.setAttribute('stroke-linejoin', 'round');
        p.setAttribute('paint-order', 'stroke');
        p.setAttribute('shape-rendering', 'geometricPrecision');
        p.setAttribute('class', 'pro5-seam');
        layer.appendChild(p);
      });
    });
  });
}

// === pro5_: 从 bubble 取椭圆参数（任意宽高）===
function pro5_ellipseFromBubble(b) {
const cx = b.x + b.width / 2;
const cy = b.y + b.height / 2;
const rx = Math.max(1, b.width / 2);
const ry = Math.max(1, b.height / 2);
return { cx, cy, rx, ry };
}
// === pro5_: 椭圆隐式函数值（点在内部<0，边界=0，外部>0）===
function pro5_ellipseF(E, x, y) {
const dx = (x - E.cx) / E.rx;
const dy = (y - E.cy) / E.ry;
 return dx * dx + dy * dy - 1;   // ✅ 修正拼写：dxdx → dx * dx
}
 // === pro5_: 椭圆参数化：给定 t，取在椭圆 E 上的点 ===
 function pro5_ellipsePointAt(E, t) {
   return {
     x: E.cx + E.rx * Math.cos(t),
     y: E.cy + E.ry * Math.sin(t),
   };
 }

 // === pro5_: 求“组合框椭圆 A 与 椭圆 B”的两交点在 A 上的参数角 [t1,t2]
 // 采样 + 二分细化：既稳又简单，足够 UI 使用
 function pro5_ellipseIntersectOnA(EA, EB) {
   const N = 720;                     // 0.5° 取样
   let lastT = 0;
   let lastV = pro5_ellipseF(EB, ...Object.values(pro5_ellipsePointAt(EA, 0)));
   const roots = [];
   for (let i = 1; i <= N; i++) {
     const t = (i / N) * Math.PI * 2;
     const P = pro5_ellipsePointAt(EA, t);
     const v = pro5_ellipseF(EB, P.x, P.y);
     if ((lastV <= 0 && v >= 0) || (lastV >= 0 && v <= 0)) {
       // 在 [lastT, t] 内有一次过零，用二分逼近
       let lo = lastT, hi = t;
       for (let k = 0; k < 18; k++) { // 2^-18 ≈ 0.000004 周期精度
         const mid = (lo + hi) / 2;
         const M = pro5_ellipsePointAt(EA, mid);
         const mv = pro5_ellipseF(EB, M.x, M.y);
         if ((lastV <= 0 && mv >= 0) || (lastV >= 0 && mv <= 0)) hi = mid; else lo = mid;
       }
       roots.push((lo + hi) / 2);
       if (roots.length === 2) break;
     }
     lastT = t; lastV = v;
   }
   if (roots.length < 2) return null;
   // 归一化到 [0,2π)，并保证按顺序（小弧）
   let [t1, t2] = roots.map(t => (t % (2*Math.PI) + 2*Math.PI) % (2*Math.PI)).sort((a,b)=>a-b);
   // 判断哪段是“小弧”，用时再设置 largeArcFlag
   const smallArc = ((t2 - t1) <= Math.PI) ? [t1, t2] : [t2, t1 + 2*Math.PI];
   return smallArc;
 }
// === pro5_: 沿椭圆 A 取样，找出“落在椭圆 B 内”的弧段 [t0, t1]（弧度）===
function pro5_sampleOverlapRanges(A, B) {
const N = 540; // 取样点数（越大越准）
const TWO_PI = Math.PI * 2;
const pts = [];
for (let i = 0; i <= N; i++) {
const t = (i / N) * TWO_PI;
const x = A.cx + A.rx * Math.cos(t);
const y = A.cy + A.ry * Math.sin(t);
const inside = pro5_ellipseF(B, x, y) <= 0; // 在 B 内视为重叠
pts.push({ t, inside });
}
// 收集连续 inside 的区间
const ranges = [];
let s = null;
for (let i = 0; i < pts.length; i++) {
const cur = pts[i], prev = pts[(i-1+pts.length)%pts.length];
if (cur.inside && !prev.inside) s = cur.t;
if (!cur.inside && prev.inside && s !== null) { ranges.push([s, prev.t]); s = null; }
}
// 首尾连通的情况
if (s !== null) ranges.push([s, pts[pts.length-1].t]);
// 规范化
return ranges.map(([a,b]) => (a<=b ? [a,b] : [a, b+TWO_PI]));
}
// === pro5_: 生成椭圆弧 Path（大圆弧标志自动判定）===
function pro5_ellipseArcPath(E, t0, t1) {
const fx = (v) => +v.toFixed(2);
const x0 = fx(E.cx + E.rx * Math.cos(t0));
const y0 = fx(E.cy + E.ry * Math.sin(t0));
const x1 = fx(E.cx + E.rx * Math.cos(t1));
const y1 = fx(E.cy + E.ry * Math.sin(t1));
const dt = (t1 - t0) % (Math.PI*2);
const large = Math.abs(dt) > Math.PI ? 1 : 0;
const sweep = 1;
return `M ${x0} ${y0} A ${fx(E.rx)} ${fx(E.ry)} 0 ${large} ${sweep} ${x1} ${y1}`;
}

function createBodyShape(bubble) {
  // pro5_: 组合框允许任意椭圆（可自由拉伸）
  if (bubble.type === 'combo-circle') {
    const ellipse = document.createElementNS(svgNS, 'ellipse');
    const { cx, cy, rx, ry } = ellipseFromBubble(bubble);
    ellipse.setAttribute('cx', cx);
    ellipse.setAttribute('cy', cy);
    ellipse.setAttribute('rx', rx);
    ellipse.setAttribute('ry', ry);
    return ellipse;
  }
  if (bubble.type === 'shout-burst') {
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', pro5_createShoutPath(bubble));
    path.setAttribute('stroke-linejoin', 'miter'); // 与给定 SVG 一致
    return path;
  }
  if (bubble.type === 'speech-pro-5deg') {
    const path = document.createElementNS(svgNS, 'path');
    const d = pro5_mergedEllipseTailPath(bubble);
    if (!d) {
      const ellipse = document.createElementNS(svgNS, 'ellipse');
      const { cx, cy, rx, ry } = ellipseFromBubble(bubble);
      ellipse.setAttribute('cx', cx);
      ellipse.setAttribute('cy', cy);
      ellipse.setAttribute('rx', rx);
      ellipse.setAttribute('ry', ry);
      return ellipse;
    }
    path.setAttribute('d', d);
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('stroke-linecap', 'round');
    return path;
  }
  if (bubble.type === 'rectangle' || bubble.type === 'speech-left' || bubble.type === 'speech-right') {
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', createRectanglePath(bubble));
    return path;
  }
  if (bubble.type.startsWith('thought')) {
    const ellipse = document.createElementNS(svgNS, 'ellipse');
    ellipse.setAttribute('cx', bubble.x + bubble.width / 2);
    ellipse.setAttribute('cy', bubble.y + bubble.height / 2);
    ellipse.setAttribute('rx', bubble.width / 2);
    ellipse.setAttribute('ry', bubble.height / 2);
    return ellipse;
  }
  // speech bubble default oval
  const path = document.createElementNS(svgNS, 'path');
  path.setAttribute('d', createRoundedRectPath(bubble.x, bubble.y, bubble.width, bubble.height, Math.min(bubble.width, bubble.height) * 0.45));
  return path;
}

function createTailShape(bubble) {
  if (!bubble.tail) return null;
  if (bubble.type === 'shout-burst') return null; // 喊叫框无尾巴
  if (bubble.type === 'combo-circle') return null; // 组合框无尾巴
  if (bubble.type === 'speech-pro-5deg') {
    return null;
  }
   // === thought-circle：按“外→内指向主体中心”的 3 小圆规则 ===
  if (bubble.type === 'thought-circle') {
    const g = document.createElementNS(svgNS, 'g');
    // 主体圆心与半径（主体是圆形：宽高中取最小的一半）
    const cx = bubble.x + bubble.width / 2;
    const cy = bubble.y + bubble.height / 2;
    const R  = Math.min(bubble.width, bubble.height) / 2;

    // 方向：tip → 主体中心（朝内）
    const tip = getTailTip(bubble);
    let ux = cx - tip.x, uy = cy - tip.y;
    const len = Math.hypot(ux, uy) || 1;
    ux /= len; uy /= len;

    // 半径与间距（可按需微调比例）
    const rBig = R * 0.10;
    const rMid = rBig * 0.68;
    const rSml = rBig * 0.46;
        // —— 动态间距：随“手柄距离中心”的长度而缩放，可贴合/可分离 ——
    // L 越短越紧（可重叠），越长越疏。系数可按需微调。
    const L = Math.hypot(cx - tip.x, cy - tip.y);
    let scale = L / (R * 1.0);                // 0 附近：贴近，~1：常规，>1：更疏
    scale = Math.max(0, Math.min(2, scale));  // 允许 0..2
    // 允许“负边距”实现可重叠（最小重叠 0.6×中圆半径）
    const minOverlap = -rMid * 0.6;
    const baseGap = rBig * 0.45 * scale;
    const gapLM = Math.max(minOverlap, baseGap - rBig * 0.20);
    const gapMS = Math.max(minOverlap, 2 * gapLM);

    // 最大圆“半贴边”：圆心在主体圆边界（靠近 tip 侧）
    const Cbig = { x: cx - ux * R, y: cy - uy * R };
    // 中/小圆沿同一直线向外排列（保持边到边间距）
    const dLM = rBig + rMid + gapLM; // 圆心距 = 半径和 + 边距
    const dMS = rMid + rSml + gapMS;
    const Cmid = { x: Cbig.x - ux * dLM, y: Cbig.y - uy * dLM };
    const Csml = { x: Cmid.x - ux * dMS, y: Cmid.y - uy * dMS };

    // 画三个小圆（继承外层 fill/stroke）
    [[Cbig, rBig], [Cmid, rMid], [Csml, rSml]].forEach(([c, r]) => {
      const node = document.createElementNS(svgNS, 'circle');
      node.setAttribute('cx', c.x);
      node.setAttribute('cy', c.y);
      node.setAttribute('r',  r);
      g.appendChild(node);
    });
    return g;
  }
  // 其它 thought*（老样式）维持原逻辑
  if (bubble.type.startsWith('thought')) {
    const group = document.createElementNS(svgNS, 'g');
    const tip = getTailTip(bubble);
    const base = getTailBase(bubble);
    const midPoint = {
      x: (tip.x + base.x) / 2,
      y: (tip.y + base.y) / 2,
    };
    const circles = [
      { center: midPoint, radius: Math.min(bubble.width, bubble.height) * 0.08 },
      { center: { x: (midPoint.x + tip.x) / 2, y: (midPoint.y + tip.y) / 2 }, radius: Math.min(bubble.width, bubble.height) * 0.06 },
      { center: tip, radius: Math.min(bubble.width, bubble.height) * 0.05 },
    ];
    circles.forEach((info) => {
      const circle = document.createElementNS(svgNS, 'circle');
      circle.setAttribute('cx', info.center.x);
      circle.setAttribute('cy', info.center.y);
      circle.setAttribute('r', info.radius);
      group.appendChild(circle);
    });
    return group;
  }
  const path = document.createElementNS(svgNS, 'path');
  const tail = buildSpeechTailPath(bubble);
  path.setAttribute('d', tail);
  return path;
}

function createRectanglePath(bubble) {
  const { x, y, width, height } = bubble;
  const radius = Math.min(width, height) * 0.1;
  const notchSize = Math.min(width, height) * 0.25;
  if (bubble.type === 'rectangle') {
    return createRoundedRectPath(x, y, width, height, radius * 0.2);
  }
  const path = [];
  if (bubble.type === 'speech-left') {
    path.push(`M ${x + radius} ${y}`);
    path.push(`H ${x + width}`);
    path.push(`V ${y + height}`);
    path.push(`H ${x}`);
    path.push(`V ${y + notchSize}`);
    path.push(`L ${x + notchSize} ${y}`);
    path.push('Z');
  } else if (bubble.type === 'speech-right') {
    path.push(`M ${x} ${y}`);
    path.push(`H ${x + width - radius}`);
    path.push(`L ${x + width} ${y + notchSize}`);
    path.push(`V ${y + height}`);
    path.push(`H ${x}`);
    path.push('Z');
  }
  return path.join(' ');
}

function createRoundedRectPath(x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  return [
    `M ${x + r} ${y}`,
    `H ${x + width - r}`,
    `Q ${x + width} ${y} ${x + width} ${y + r}`,
    `V ${y + height - r}`,
    `Q ${x + width} ${y + height} ${x + width - r} ${y + height}`,
    `H ${x + r}`,
    `Q ${x} ${y + height} ${x} ${y + height - r}`,
    `V ${y + r}`,
    `Q ${x} ${y} ${x + r} ${y}`,
    'Z',
  ].join(' ');
}

function buildSpeechTailPath(bubble) {
  const tip = getTailTip(bubble);
  const base = getTailBase(bubble);
  const center = { x: bubble.x + bubble.width / 2, y: bubble.y + bubble.height / 2 };
  const sideVector = { x: tip.x - center.x, y: tip.y - center.y };
  const dominantHorizontal = Math.abs(sideVector.x) > Math.abs(sideVector.y);
  let baseCenter = { x: base.x, y: base.y };
  const baseWidth = Math.max(36, Math.min(bubble.width, bubble.height) * 0.25);
  const baseHeight = Math.max(36, Math.min(bubble.width, bubble.height) * 0.25);
  let p1;
  let p2;
  if (dominantHorizontal) {
    baseCenter.y = clamp(tip.y, bubble.y + baseHeight * 0.3, bubble.y + bubble.height - baseHeight * 0.3);
    const offset = baseHeight / 2;
    p1 = { x: baseCenter.x, y: baseCenter.y - offset };
    p2 = { x: baseCenter.x, y: baseCenter.y + offset };
  } else {
    baseCenter.x = clamp(tip.x, bubble.x + baseWidth * 0.3, bubble.x + bubble.width - baseWidth * 0.3);
    const offset = baseWidth / 2;
    p1 = { x: baseCenter.x - offset, y: baseCenter.y };
    p2 = { x: baseCenter.x + offset, y: baseCenter.y };
  }
  return `M ${p1.x} ${p1.y} Q ${tip.x} ${tip.y} ${p2.x} ${p2.y}`;
}

function getOverlayRect(bubble) {
  const bodyRect = {
    minX: bubble.x,
    minY: bubble.y,
    maxX: bubble.x + bubble.width,
    maxY: bubble.y + bubble.height,
  };
  if (bubble.tail) {
    const tip = getTailTip(bubble);
    if (tip) {
      bodyRect.minX = Math.min(bodyRect.minX, tip.x);
      bodyRect.maxX = Math.max(bodyRect.maxX, tip.x);
      bodyRect.minY = Math.min(bodyRect.minY, tip.y);
      bodyRect.maxY = Math.max(bodyRect.maxY, tip.y);
    }
  }
  return {
    x: bodyRect.minX - CONTROL_PADDING,
    y: bodyRect.minY - CONTROL_PADDING,
    width: bodyRect.maxX - bodyRect.minX + CONTROL_PADDING * 2,
    height: bodyRect.maxY - bodyRect.minY + CONTROL_PADDING * 2,
  };
}

function updateSelectionOverlay() {
  const bubble = getSelectedBubble();
  if (!bubble) {
    elements.selectionOverlay.classList.add('hidden');
    elements.positionIndicator.textContent = '';
    if (overlay.tailHandle) {
      overlay.tailHandle.style.display = 'none';
    }
    removePro5Handles();
    return;
  }
  elements.selectionOverlay.classList.remove('hidden');
  const overlayRect = getOverlayRect(bubble);
  const topLeft = worldToScreen({ x: overlayRect.x, y: overlayRect.y });
  const bottomRight = worldToScreen({ x: overlayRect.x + overlayRect.width, y: overlayRect.y + overlayRect.height });
  overlay.box.style.left = `${topLeft.x}px`;
  overlay.box.style.top = `${topLeft.y}px`;
  overlay.box.style.width = `${bottomRight.x - topLeft.x}px`;
  overlay.box.style.height = `${bottomRight.y - topLeft.y}px`;

  HANDLE_DIRECTIONS.forEach((dir) => {
    const handle = overlay.handles.get(dir);
    const position = computeHandlePosition(bubble, dir);
    const screenPos = worldToScreen(position);
    handle.style.left = `${screenPos.x}px`;
    handle.style.top = `${screenPos.y}px`;
  });

  if (bubble.type === 'speech-pro-5deg') {
    overlay.tailHandle.style.display = 'none';
  } else if (bubble.tail) {
    overlay.tailHandle.style.display = 'block';
    const tailTip = getTailTip(bubble);
    const screenPos = worldToScreen(tailTip);
    overlay.tailHandle.style.left = `${screenPos.x}px`;
    overlay.tailHandle.style.top = `${screenPos.y}px`;
  } else {
    overlay.tailHandle.style.display = 'none';
  }
  renderPro5degHandles(bubble);
  elements.positionIndicator.textContent = `位置：(${bubble.x.toFixed(0)}, ${bubble.y.toFixed(0)}) 尺寸：${bubble.width.toFixed(0)}×${bubble.height.toFixed(0)}`;
}

function ensurePro5Handle(type, color) {
  if (overlay.pro5Handles[type]) {
    return overlay.pro5Handles[type];
  }
  const handle = document.createElement('div');
  handle.className = `pro5-handle pro5-handle-${type}`;
  handle.dataset.handleType = type;
  handle.style.position = 'absolute';
  handle.style.width = '14px';
  handle.style.height = '14px';
  handle.style.marginLeft = '-7px';
  handle.style.marginTop = '-7px';
  handle.style.borderRadius = '50%';
  handle.style.border = '2px solid #00000099';
  handle.style.background = color;
  handle.style.cursor = 'pointer';
  handle.style.zIndex = '2';
  handle.style.pointerEvents = 'auto';
  handle.addEventListener('pointerdown', onPro5HandlePointerDown);
  elements.selectionOverlay.appendChild(handle);
  overlay.pro5Handles[type] = handle;
  return handle;
}

function removePro5Handles() {
  Object.keys(overlay.pro5Handles).forEach((key) => {
    const handle = overlay.pro5Handles[key];
    if (handle) {
      handle.remove();
      overlay.pro5Handles[key] = null;
    }
  });
}

function renderPro5degHandles(bubble) {
  if (
    !bubble ||
    bubble.type !== 'speech-pro-5deg' ||
    !bubble.tail ||
    !bubble.tail.apex ||
    !bubble.tail.aim
  ) {
    removePro5Handles();
    return;
  }

  const apexHandle = ensurePro5Handle('apex', '#f59e0b');
  const aimHandle = ensurePro5Handle('aim', '#ef4444');

  const apexAbs = normToAbs(bubble, bubble.tail.apex);
  const aimAbs = normToAbs(bubble, bubble.tail.aim);

  const apexScreen = worldToScreen(apexAbs);
  const aimScreen = worldToScreen(aimAbs);

  apexHandle.style.display = 'block';
  apexHandle.style.left = `${apexScreen.x}px`;
  apexHandle.style.top = `${apexScreen.y}px`;

  aimHandle.style.display = 'block';
  aimHandle.style.left = `${aimScreen.x}px`;
  aimHandle.style.top = `${aimScreen.y}px`;
}

function onPro5HandlePointerDown(event) {
  event.preventDefault();
  event.stopPropagation();
  const handleType = event.currentTarget.dataset.handleType;
  const bubble = getSelectedBubble();
  if (!handleType || !bubble || bubble.type !== 'speech-pro-5deg' || !bubble.tail) {
    return;
  }
  if (state.inlineEditingBubbleId) {
    elements.inlineEditor.blur();
  }
  state.interaction = {
    type: 'pro5-handle',
    pointerId: event.pointerId,
    bubbleId: bubble.id,
    handle: handleType,
  };
  elements.viewport.setPointerCapture(event.pointerId);
}

function computeHandlePosition(bubble, direction) {
  const rect = {
    left: bubble.x - CONTROL_PADDING,
    right: bubble.x + bubble.width + CONTROL_PADDING,
    top: bubble.y - CONTROL_PADDING,
    bottom: bubble.y + bubble.height + CONTROL_PADDING,
    centerX: bubble.x + bubble.width / 2,
    centerY: bubble.y + bubble.height / 2,
  };
  const pos = { x: rect.centerX, y: rect.centerY };
  if (direction.includes('n')) pos.y = rect.top;
  if (direction.includes('s')) pos.y = rect.bottom;
  if (direction.includes('w')) pos.x = rect.left;
  if (direction.includes('e')) pos.x = rect.right;
  if (direction === 'n' || direction === 's') pos.x = rect.centerX;
  if (direction === 'e' || direction === 'w') pos.y = rect.centerY;
  if (direction === 'nw') {
    pos.x = rect.left;
    pos.y = rect.top;
  }
  if (direction === 'ne') {
    pos.x = rect.right;
    pos.y = rect.top;
  }
  if (direction === 'se') {
    pos.x = rect.right;
    pos.y = rect.bottom;
  }
  if (direction === 'sw') {
    pos.x = rect.left;
    pos.y = rect.bottom;
  }
  return pos;
}

function handleKeyDown(event) {
  const target = event.target;
  const isTextInput =
    target === elements.inlineEditor ||
    target === elements.textContent ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement;
  if (event.key === 'Delete' && !isTextInput) {
    removeSelectedBubble();
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    undo();
  }
}

function pushHistory() {
  const snapshot = JSON.stringify({
    bubbles: state.bubbles,
    selectedBubbleId: state.selectedBubbleId,
    viewport: state.viewport,
  });
  state.history = state.history.slice(0, state.historyIndex + 1);
  state.history.push(snapshot);
  state.historyIndex = state.history.length - 1;
}

function undo() {
  if (state.historyIndex <= 0) return;
  state.historyIndex -= 1;
  const snapshot = JSON.parse(state.history[state.historyIndex]);
  state.bubbles = snapshot.bubbles.map((bubble) => ({ ...bubble }));
  state.selectedBubbleId = snapshot.selectedBubbleId;
  state.viewport = { ...snapshot.viewport };
  updateSceneTransform();
  render();
  updateControlsFromSelection();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

//async function exportArtwork() {
  //const format = elements.exportFormat.value;
  //if (!state.image.src && state.bubbles.length === 0) return;
  //if (format === 'png' || format === 'jpg') {
    //await exportRaster(format);
  //} else if (format === 'psd') {
    //await exportPsd();
  //}
//}

async function exportRaster(format) {
  const canvas = document.createElement('canvas');
  canvas.width = state.canvas.width;
  canvas.height = state.canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (state.image.src) {
    await drawImageToCanvas(ctx, state.image.src, canvas.width, canvas.height);
  }
  drawBubblesToContext(ctx, { includeText: true });
  const mime = format === 'png' ? 'image/png' : 'image/jpeg';
  const quality = format === 'jpg' ? 0.95 : 1;
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (blob) {
        downloadBlob(blob, `comic-bubbles.${format}`);
      }
      resolve();
    }, mime, quality);
  });
}

async function drawImageToCanvas(ctx, src, width, height) {
  const img = new Image();
  img.src = src;
  await img.decode();
  ctx.drawImage(img, 0, 0, width, height);
}

function drawBubblesToContext(ctx, options = {}) {
  const { includeText = true, includeBodies = true } = options;
  state.bubbles.forEach((bubble) => {
    ctx.save();
    ctx.lineWidth = bubble.strokeWidth;
    ctx.strokeStyle = '#11141b';
    ctx.fillStyle = '#ffffff';
    if (includeBodies) {
    if (bubble.type === 'speech-pro-5deg') {
      const d = pro5_mergedEllipseTailPath(bubble);
      if (d) {
        drawPath(ctx, d);     // 一条闭合 path，和编辑端一致
      }
      } else if (bubble.type === 'shout-burst') {
        drawPath(ctx, pro5_createShoutPath(bubble));
      } else if (bubble.type === 'rectangle' || bubble.type === 'speech-left' || bubble.type === 'speech-right') {
        drawPath(ctx, createRectanglePath(bubble));
      } else if (bubble.type.startsWith('thought')) {
        ctx.beginPath();
        ctx.ellipse(
          bubble.x + bubble.width / 2,
          bubble.y + bubble.height / 2,
          bubble.width / 2,
          bubble.height / 2,
          0,
          0,
          Math.PI * 2,
        );
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        drawPath(ctx, createRoundedRectPath(bubble.x, bubble.y, bubble.width, bubble.height, Math.min(bubble.width, bubble.height) * 0.45));
      }
    if (bubble.tail) {
      if (bubble.type.startsWith('thought')) {
        drawThoughtTail(ctx, bubble);
      } else if (bubble.type !== 'speech-pro-5deg') {
        drawPath(ctx, buildSpeechTailPath(bubble));
      }
    }
    }
    if (includeText) {
      const rect = getTextRect(bubble);
      // 与编辑端一致：裁剪到文字矩形内，避免字体溢出造成视觉偏移
      const rx = Math.round(rect.x);
      const ry = Math.round(rect.y);
      const rw = Math.max(1, Math.round(rect.width));
      const rh = Math.max(1, Math.round(rect.height));
      ctx.save();
      ctx.beginPath();
          // 放宽上下各 1px，避免顶部被裁一条线
      ctx.rect(rx, ry - 1, rw, rh + 2);
      ctx.clip();

      const fontSize = Math.max(10, bubble.fontSize || 34);
      const lineHeight = Math.round(fontSize * 1.2);
         // 用编辑端同源的“显示文本”（已按规则转为 \n）
      const displayText = getBubbleDisplayText(bubble);
      const lines = displayText ? displayText.split('\n') : [''];
      ctx.fillStyle = '#11141b';
      ctx.font = `${bubble.bold ? 'bold ' : ''}${fontSize}px ${bubble.fontFamily}`;
      
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      // 计算整段宽高 → 使“文本块”在矩形内居中（行内仍 left）
      let maxLineW = 0;
      for (const line of lines) maxLineW = Math.max(maxLineW, Math.ceil(ctx.measureText(line).width));
      const totalH = lines.length * lineHeight;
      const startX = rx + Math.max(0, Math.round((rw - maxLineW) / 2));
      let   y      = ry + Math.max(0, Math.round((rh - totalH) / 2));
      for (const line of lines) {
        ctx.fillText(line, startX, y);
        y += lineHeight;
      }
      ctx.restore();
    }
    ctx.restore();
  });
}

function drawPath(ctx, pathData) {
  const path = new Path2D(pathData);
  ctx.fill(path);
  ctx.stroke(path);
}

function drawThoughtTail(ctx, bubble) {
  const tip = getTailTip(bubble);
  const base = getTailBase(bubble);
  const midPoint = {
    x: (tip.x + base.x) / 2,
    y: (tip.y + base.y) / 2,
  };
  const circles = [
    { center: midPoint, radius: Math.min(bubble.width, bubble.height) * 0.08 },
    { center: { x: (midPoint.x + tip.x) / 2, y: (midPoint.y + tip.y) / 2 }, radius: Math.min(bubble.width, bubble.height) * 0.06 },
    { center: tip, radius: Math.min(bubble.width, bubble.height) * 0.05 },
  ];
  circles.forEach((info) => {
    ctx.beginPath();
    ctx.arc(info.center.x, info.center.y, info.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });
}

async function exportPsd() {
  const psd = await buildPsdDocument();
  if (!psd) return;
  downloadBlob(new Blob([psd], { type: 'image/vnd.adobe.photoshop' }), 'comic-bubbles.psd');
}

async function buildPsdDocument() {
  const width = state.canvas.width;
  const height = state.canvas.height;
  const header = createPsdHeader(width, height);
  const colorModeData = new Uint8Array(0);
  const imageResources = new Uint8Array(0);
  const layerInfo = await createLayerInfoSection();
  const composite = await createCompositeImage();
  const totalLength =
    header.length +
    4 +
    colorModeData.length +
    4 +
    imageResources.length +
    layerInfo.length +
    composite.length;
  const buffer = new Uint8Array(totalLength);
  let offset = 0;
  buffer.set(header, offset);
  offset += header.length;
  writeUint32(buffer, offset, colorModeData.length);
  offset += 4;
  buffer.set(colorModeData, offset);
  offset += colorModeData.length;
  writeUint32(buffer, offset, imageResources.length);
  offset += 4;
  buffer.set(imageResources, offset);
  offset += imageResources.length;
  buffer.set(layerInfo, offset);
  offset += layerInfo.length;
  buffer.set(composite, offset);
  return buffer.buffer;
}

function createPsdHeader(width, height) {
  const buffer = new Uint8Array(26);
  const view = new DataView(buffer.buffer);
  view.setUint32(0, 0x38425053); // '8BPS'
  view.setUint16(4, 1); // version
  for (let i = 6; i < 12; i += 1) {
    buffer[i] = 0;
  }
  view.setUint16(12, 4); // channels RGBA
  view.setUint32(14, height);
  view.setUint32(18, width);
  view.setUint16(22, 8); // bits per channel
  view.setUint16(24, 3); // RGB color mode
  return buffer;
}

async function createLayerInfoSection() {
  const layers = await buildLayers();
  const records = layers.map((layer) => layer.record);
  const recordBuffer = concatUint8Arrays(records);
  const channelBuffer = concatUint8Arrays(layers.flatMap((layer) => layer.channelData));
  let layerInfoLength = 2 + recordBuffer.length + channelBuffer.length;
  if (layerInfoLength % 2 !== 0) {
    layerInfoLength += 1;
  }
  const totalLength = 4 + layerInfoLength + 4;
  const buffer = new Uint8Array(4 + totalLength);
  let offset = 0;
  writeUint32(buffer, offset, totalLength);
  offset += 4;
  writeUint32(buffer, offset, layerInfoLength);
  offset += 4;
  writeInt16(buffer, offset, layers.length);
  offset += 2;
  buffer.set(recordBuffer, offset);
  offset += recordBuffer.length;
  buffer.set(channelBuffer, offset);
  offset += channelBuffer.length;
  if ((offset - 8) % 2 !== 0) {
    buffer[offset] = 0;
    offset += 1;
  }
  writeUint32(buffer, offset, 0);
  return buffer;
}

async function buildLayers() {
  const layers = [];
  const imageLayer = await buildImageLayer();
  if (imageLayer) layers.push(imageLayer);
  const bubbleLayer = await buildBubbleLayer();
  if (bubbleLayer) layers.push(bubbleLayer);
  const textLayers = await Promise.all(state.bubbles.map((bubble) => buildTextLayer(bubble)));
  textLayers.forEach((layer) => {
    if (layer) layers.push(layer);
  });
  return layers;
}

async function buildImageLayer() {
  if (!state.image.src) return null;
  const canvas = document.createElement('canvas');
  canvas.width = state.canvas.width;
  canvas.height = state.canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await drawImageToCanvas(ctx, state.image.src, canvas.width, canvas.height);
  return buildRasterLayer('漫画图片', canvas);
}

async function buildBubbleLayer() {
  if (state.bubbles.length === 0) return null;
  const canvas = document.createElement('canvas');
  canvas.width = state.canvas.width;
  canvas.height = state.canvas.height;
  const ctx = canvas.getContext('2d');
  drawBubblesToContext(ctx, { includeText: false, includeBodies: true });
  return buildRasterLayer('泡泡', canvas);
}

async function buildTextLayer(bubble) {
  if (!bubble.text) return null;
  const textOnly = document.createElement('canvas');
  textOnly.width = state.canvas.width;
  textOnly.height = state.canvas.height;
  const textCtx = textOnly.getContext('2d');
  textCtx.clearRect(0, 0, textOnly.width, textOnly.height);
  const textRect = getTextRect(bubble);
  const rx = Math.round(textRect.x);
  const ry = Math.round(textRect.y);
  const rw = Math.max(1, Math.round(textRect.width));
  const rh = Math.max(1, Math.round(textRect.height));

  // 与编辑端一致：左对齐 + 自动换行 + 裁剪到文字矩形
  const fontSize = Math.max(10, bubble.fontSize || 34);
  const lineHeight = Math.round(fontSize * 1.2);
    // 与编辑端一致：用 DOM 实际换行获得逐行文本
  const lines = pro5_domWrapLines(
    bubble.text, bubble.fontFamily, fontSize, bubble.bold, rw, state.pro5_autoWrapEnabled
  );
  textCtx.save();
  textCtx.beginPath();
    // 裁剪框上下各放宽 1px，避免顶部被吞
  textCtx.rect(rx, ry - 1, rw, rh + 2);
  textCtx.clip();
  textCtx.fillStyle = '#11141b';
  textCtx.font = `${bubble.bold ? 'bold ' : ''}${fontSize}px ${bubble.fontFamily}`;
  textCtx.textBaseline = 'top';
  textCtx.textAlign = 'left';
 // 段落整体在矩形内居中（行内左对齐）
  let maxLineW = 0;
  for (const line of lines) {
    const w = Math.ceil(textCtx.measureText(line).width);
    if (w > maxLineW) maxLineW = w;
  }
  const totalH = lines.length * lineHeight;
  const startX = rx + Math.max(0, Math.round((rw - maxLineW) / 2));
  let   y      = ry + Math.max(0, Math.round((rh - totalH) / 2));
  for (const line of lines) {
    textCtx.fillText(line, startX, y);
    y += lineHeight;
  }
  textCtx.restore();
  return buildRasterLayer(`文字-${bubble.id}`, textOnly);
}

function buildRasterLayer(name, canvas) {
  const { width, height } = canvas;
  const channels = canvasToChannels(canvas);
  const channelEntries = [
    { id: 0, data: channels[0] },
    { id: 1, data: channels[1] },
    { id: 2, data: channels[2] },
    { id: -1, data: channels[3] },
  ];
  const nameData = pascalString(name);
  const extraLength = 4 + 0 + 4 + 0 + nameData.length;
  const recordLength = 16 + 2 + channelEntries.length * 6 + 12 + 4 + extraLength;
  const record = new Uint8Array(recordLength);
  const view = new DataView(record.buffer);
  let offset = 0;
  view.setInt32(offset, 0);
  offset += 4;
  view.setInt32(offset, 0);
  offset += 4;
  view.setInt32(offset, height);
  offset += 4;
  view.setInt32(offset, width);
  offset += 4;
  view.setInt16(offset, channelEntries.length);
  offset += 2;
  channelEntries.forEach((entry) => {
    view.setInt16(offset, entry.id);
    offset += 2;
    view.setUint32(offset, entry.data.length + 2);
    offset += 4;
  });
  record.set([...'8BIM'].map((c) => c.charCodeAt(0)), offset);
  offset += 4;
  record.set([...'norm'].map((c) => c.charCodeAt(0)), offset);
  offset += 4;
  record[offset++] = 255; // opacity
  record[offset++] = 0; // clipping
  record[offset++] = 0; // flags
  record[offset++] = 0; // filler
  view.setUint32(offset, extraLength);
  offset += 4;
  view.setUint32(offset, 0); // mask length
  offset += 4;
  view.setUint32(offset, 0); // blending ranges length
  offset += 4;
  record.set(nameData, offset);
  offset += nameData.length;
  const padding = (4 - (offset % 4)) % 4;
  offset += padding;

  const channelData = channelEntries.map((entry) => {
    const data = new Uint8Array(2 + entry.data.length);
    data[0] = 0;
    data[1] = 0;
    data.set(entry.data, 2);
    return data;
  });

  return { record, channelData };
}

function canvasToChannels(canvas) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height).data;
  const channelLength = width * height;
  const channels = [new Uint8Array(channelLength), new Uint8Array(channelLength), new Uint8Array(channelLength), new Uint8Array(channelLength)];
  for (let i = 0; i < channelLength; i += 1) {
    channels[0][i] = imageData[i * 4];
    channels[1][i] = imageData[i * 4 + 1];
    channels[2][i] = imageData[i * 4 + 2];
    channels[3][i] = imageData[i * 4 + 3];
  }
  return channels;
}

function pascalString(name) {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(name);
  const length = Math.min(255, encoded.length);
  const paddedLength = length + 1 + ((4 - ((length + 1) % 4)) % 4);
  const buffer = new Uint8Array(paddedLength);
  buffer[0] = length;
  buffer.set(encoded.subarray(0, length), 1);
  return buffer;
}

async function createCompositeImage() {
  const canvas = document.createElement('canvas');
  canvas.width = state.canvas.width;
  canvas.height = state.canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (state.image.src) {
    await drawImageToCanvas(ctx, state.image.src, canvas.width, canvas.height);
  }
  drawBubblesToContext(ctx, { includeText: true, includeBodies: true });
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return encodeCompositeImage(imageData);
}

function encodeCompositeImage(imageData) {
  const { width, height, data } = imageData;
  const header = new Uint8Array(2);
  const view = new DataView(header.buffer);
  view.setUint16(0, 0); // raw data
  const channelSize = width * height;
  const pixelData = new Uint8Array(channelSize * 4);
  for (let i = 0; i < channelSize; i += 1) {
    pixelData[i] = data[i * 4];
    pixelData[i + channelSize] = data[i * 4 + 1];
    pixelData[i + channelSize * 2] = data[i * 4 + 2];
    pixelData[i + channelSize * 3] = data[i * 4 + 3];
  }
  return concatUint8Arrays([header, pixelData]);
}

function concatUint8Arrays(arrays) {
  if (!arrays.length) return new Uint8Array(0);
  const total = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  arrays.forEach((arr) => {
    result.set(arr, offset);
    offset += arr.length;
  });
  return result;
}

function writeUint32(buffer, offset, value) {
  buffer[offset] = (value >>> 24) & 0xff;
  buffer[offset + 1] = (value >>> 16) & 0xff;
  buffer[offset + 2] = (value >>> 8) & 0xff;
  buffer[offset + 3] = value & 0xff;
}

function writeInt16(buffer, offset, value) {
  const v = value < 0 ? 0xffff + value + 1 : value;
  buffer[offset] = (v >>> 8) & 0xff;
  buffer[offset + 1] = v & 0xff;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
// === pro5_: 当前所见 SVG → Canvas（同像素、所见即所得） ===
async function pro5_canvasFromCurrentSVG() {
  const svg = elements.svgRoot || document.querySelector('svg');
  if (!svg) throw new Error('找不到根 SVG');

  // ① 背景图：直接用 state.image.src，避免 DOM 选择器不匹配
  const hasBGSrc = !!(state.image && state.image.src);
  let bgBitmap = null, bgW = 0, bgH = 0;
  if (hasBGSrc) {
    const bgImg = new Image();
    bgImg.decoding = 'async';
    bgImg.crossOrigin = 'anonymous';
    await new Promise((res, rej) => { bgImg.onload = res; bgImg.onerror = rej; bgImg.src = state.image.src; });
    if (bgImg.decode) { try { await bgImg.decode(); } catch(e){} }
    bgW = bgImg.naturalWidth || bgImg.width;
    bgH = bgImg.naturalHeight || bgImg.height;
    bgBitmap = bgImg;
  }
  // 画布尺寸：优先用背景原像素；没有背景则退回 state.canvas
  const w = hasBGSrc ? bgW : (state.canvas?.width  || svg.clientWidth);
  const h = hasBGSrc ? bgH : (state.canvas?.height || svg.clientHeight);

  if (document.fonts && document.fonts.ready) await document.fonts.ready;

  // 克隆 SVG，固定尺寸/视窗，内联关键样式（白底黑边、文本排版）
  const clone = svg.cloneNode(true);
  clone.setAttribute('width',  String(w));
  clone.setAttribute('height', String(h));
  clone.setAttribute('viewBox', `0 0 ${w} ${h}`);

  // ② 导出前，给每个文本 div 包一层内部容器，方便“块居中/行左对齐”
  clone.querySelectorAll('.bubble-text-display').forEach((el) => {
    const txt = el.textContent || '';
    while (el.firstChild) el.removeChild(el.firstChild);
    const inner = document.createElement('div');
    inner.setAttribute('class', 'pro5-inner');
    inner.textContent = txt;
    el.appendChild(inner);
  });

  // ③ 内联样式：隐藏黄色虚线框；对白白底黑边；文本块“整体居中 + 行左对齐”
  const style = document.createElement('style');
  style.textContent = `
    /* 不导出黄色虚线框 */
    .bubble-outline{ display:none !important; }
    /* 对白外观（避免默认黑填充） */
    .bubble-body,.bubble-tail{ fill:#fff; stroke:#11141b; }
    .text-layer{ overflow:visible }
    /* 文本容器：使整段居中；内部行保持左对齐 */
    .bubble-text-display{
      display:flex; align-items:center; justify-content:center;
      width:100%; height:100%; box-sizing:border-box;
      background:transparent; border:0; margin:0; padding:0;
    }
    .bubble-text-display .pro5-inner{
      width:max-content; max-width:100%;
      white-space:pre-wrap; word-break:break-word; line-height:1.2;
      text-align:left; letter-spacing:0; word-spacing:0;
    }
  `;
  clone.insertBefore(style, clone.firstChild);

  const xml  = new XMLSerializer().serializeToString(clone);
  const data = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);

  // 目标画布
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { alpha: true });
  ctx.imageSmoothingEnabled = false;

   // 先画背景（保持原始分辨率，不缩放二次）
  if (bgBitmap) {
    ctx.drawImage(bgBitmap, 0, 0, w, h);
  }

  // 再画 SVG 覆盖层（包含对白、尾巴等）
  const img = new Image();
  img.decoding = 'async';
  img.crossOrigin = 'anonymous';
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = data; });
  if (img.decode) { try { await img.decode(); } catch(e){} }

  ctx.drawImage(img, 0, 0, w, h);
  return canvas;
}

// === pro5_: 导出 PNG（无损） ===
async function pro5_exportPNG() {
  const canvas = await pro5_canvasFromCurrentSVG();
  const url = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url; a.download = 'export.png'; a.click();
}

async function pro5_exportJPG(quality = 1.0) {
  const canvas = await pro5_canvasFromCurrentSVG();
  const url = canvas.toDataURL('image/jpeg', quality);
  const a = document.createElement('a');
  a.href = url; a.download = 'export.jpg'; a.click();
}

init();
