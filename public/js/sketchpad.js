import { closeModal, guard, modal, toast } from './ui.js';
import { api } from './api.js';

const W = 1000;
const H = 600;
const COLORS = ['#111827', '#2563eb', '#dc2626', '#059669', '#7c3aed'];

export function openSketchFigureModal(exp, onSaved) {
  let tool = 'pen';
  let color = COLORS[0];
  let width = 5;
  let smoothing = 70;
  let template = true;
  let imageTemplate = null;
  const strokes = [];
  const labels = [];
  const actions = [];
  let current = null;
  let selectedLabel = -1;
  let draggingLabel = null;
  let shapeHoldTimer = null;
  let shapeHoldAnchor = null;

  modal(`<div class="sketch-modal">
    <div class="between sketch-head">
      <div>
        <h3>Sketch scientific figure</h3>
        <div class="muted" style="font-size:12px">Draw with finger, stylus or mouse. Hold at the end of a stroke to lock simple shapes; clean preview smooths the rest.</div>
      </div>
      <button class="btn ghost sm" data-x>Close</button>
    </div>
    <div class="sketch-tools">
      <button class="btn sm" data-tool="pen">Pen</button>
      <button class="btn sec sm" data-tool="eraser">Eraser</button>
      <button class="btn sec sm" data-tool="label">Move label</button>
      <button class="btn ghost sm" data-undo disabled>Undo</button>
      <button class="btn sec sm" data-template>Slide template</button>
      <button class="btn sec sm" data-import-image>Import image</button>
      <button class="btn ghost sm" data-clear-image disabled>Clear image</button>
      <input type="file" id="sketchImageFile" accept="image/*" style="display:none"/>
      <input class="txt sketch-prompt-input" id="sketchPrompt" list="sketchTemplateHints" placeholder="Prompt template, e.g. synapse"/>
      <datalist id="sketchTemplateHints">
        <option value="synapse"></option>
        <option value="microscope slide"></option>
        <option value="cell"></option>
        <option value="neuron"></option>
        <option value="xy axes"></option>
        <option value="experiment timeline"></option>
      </datalist>
      <select class="txt sketch-template-select" id="sketchTemplate">
        <option value="">Insert template</option>
        <option value="synapse">Synapse</option>
        <option value="microscope-slide">Microscope slide</option>
        <option value="cell">Cell</option>
        <option value="neuron">Neuron</option>
        <option value="xy-axes">XY axes plot</option>
        <option value="timeline-y">Y-axis timeline</option>
      </select>
      <button class="btn sec sm" data-insert-template>Insert template</button>
      <input class="txt sketch-label-input" id="sketchLabel" placeholder="Label text"/>
      <button class="btn sec sm" data-label>Add label</button>
      <button class="btn ghost sm" data-update-label disabled>Update label</button>
      <button class="btn ghost sm" data-delete-label disabled>Delete label</button>
      <input type="range" id="sketchWidth" min="2" max="18" value="5" aria-label="Stroke width"/>
      <label class="sketch-slider">Smoothing <input type="range" id="sketchSmooth" min="0" max="100" value="70"/><output id="sketchSmoothVal">70</output></label>
      <div class="sketch-swatches">${COLORS.map(c => `<button data-color="${c}" style="background:${c}" title="${c}"></button>`).join('')}</div>
    </div>
    <div class="sketch-stage">
      <canvas id="sketchCanvas" width="${W}" height="${H}"></canvas>
    </div>
    <div class="sketch-preview" id="sketchPreview"></div>
    <div class="row sketch-actions">
      <input class="txt" id="figureCaption" placeholder="Figure caption, e.g. Microscope slide map for treatment groups A-D"/>
      <button class="btn ghost sm" data-clear>Clear</button>
      <button class="btn sec sm" data-preview>Preview clean</button>
      <button class="btn" data-save>Attach figure</button>
    </div>
    <div class="muted" id="sketchState" style="font-size:12px;margin-top:8px"></div>
  </div>`);

  const m = document.getElementById('modal');
  const canvas = m.querySelector('#sketchCanvas');
  const ctx = canvas.getContext('2d');
  const stateEl = m.querySelector('#sketchState');
  const previewEl = m.querySelector('#sketchPreview');
  m.querySelector('[data-x]').onclick = closeModal;

  const paint = () => {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    if (imageTemplate) drawImageTemplate(ctx, imageTemplate, false);
    if (template) drawSlideTemplate(ctx, false);
    for (const s of strokes) drawStroke(ctx, s, false);
    labels.forEach((l, i) => drawLabel(ctx, l, false, i === selectedLabel));
  };

  const setTool = next => {
    tool = next;
    canvas.classList.toggle('label-mode', tool === 'label');
    canvas.classList.toggle('draw-mode', tool !== 'label');
    m.querySelectorAll('[data-tool]').forEach(b => {
      b.classList.toggle('sec', b.dataset.tool !== tool);
      b.classList.toggle('ghost', b.dataset.tool !== tool);
    });
  };
  setTool('pen');
  paint();

  m.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => setTool(b.dataset.tool));
  m.querySelector('[data-template]').onclick = () => { template = !template; paint(); };
  m.querySelector('#sketchWidth').oninput = ev => { width = Number(ev.target.value) || 5; };
  m.querySelector('#sketchSmooth').oninput = ev => {
    smoothing = Number(ev.target.value) || 0;
    m.querySelector('#sketchSmoothVal').textContent = String(smoothing);
  };
  m.querySelectorAll('[data-color]').forEach(b => b.onclick = () => { color = b.dataset.color; setTool('pen'); });
  m.querySelector('[data-insert-template]').onclick = () => {
    const prompt = m.querySelector('#sketchPrompt').value;
    const selected = m.querySelector('#sketchTemplate').value;
    const name = templateKey(prompt || selected);
    const tpl = builtInTemplate(name);
    if (!tpl) return toast('Type or choose a known template', true);
    strokes.push(...tpl.strokes);
    labels.push(...tpl.labels);
    actions.push({ strokes: tpl.strokes, labels: tpl.labels });
    selectedLabel = -1;
    syncLabelButtons();
    syncUndoButton();
    stateEl.textContent = `${tpl.name} template inserted. Draw on top or use Undo to remove it.`;
    paint();
  };
  m.querySelector('#sketchPrompt').addEventListener('keydown', ev => {
    if (ev.key === 'Enter') { ev.preventDefault(); m.querySelector('[data-insert-template]').click(); }
  });
  const syncLabelButtons = () => {
    m.querySelector('[data-update-label]').disabled = selectedLabel < 0;
    m.querySelector('[data-delete-label]').disabled = selectedLabel < 0;
  };
  const syncUndoButton = () => {
    m.querySelector('[data-undo]').disabled = actions.length === 0;
  };
  const syncImageButton = () => {
    m.querySelector('[data-clear-image]').disabled = !imageTemplate;
  };
  const clearShapeHold = () => {
    clearTimeout(shapeHoldTimer);
    shapeHoldTimer = null;
    shapeHoldAnchor = null;
  };
  m.querySelector('[data-x]').onclick = () => { clearShapeHold(); closeModal(); };
  const scheduleShapeHold = () => {
    if (!current || current.tool !== 'pen' || current.shape || current.points.length < 2) return;
    const end = current.points[current.points.length - 1];
    if (shapeHoldTimer && shapeHoldAnchor && dist(shapeHoldAnchor, end) < 16) return;
    clearShapeHold();
    shapeHoldAnchor = end;
    shapeHoldTimer = setTimeout(() => {
      if (!current || current.tool !== 'pen' || current.shape) return;
      const locked = classifyShape(current.points);
      if (!locked) return;
      current.shape = locked.kind;
      if (locked.points) current.points = locked.points;
      if (locked.bounds) current.bounds = locked.bounds;
      if (locked.vertices) current.vertices = locked.vertices;
      shapeHoldTimer = null;
      shapeHoldAnchor = null;
      stateEl.textContent = `${locked.label} locked. Lift to keep it${locked.kind === 'line' ? ', or keep dragging to adjust the endpoint' : ''}.`;
      paint();
    }, 420);
  };
  m.querySelector('[data-label]').onclick = () => {
    const text = m.querySelector('#sketchLabel').value.trim();
    if (!text) return toast('Type a label first', true);
    const label = { x: W / 2 - 60, y: H / 2, text, color };
    labels.push(label);
    actions.push({ strokes: [], labels: [label] });
    selectedLabel = labels.length - 1;
    setTool('label');
    stateEl.textContent = 'Drag the selected label, or click the canvas where it should go. Tap Pen when you want to draw again.';
    syncLabelButtons();
    syncUndoButton();
    paint();
  };
  m.querySelector('[data-update-label]').onclick = () => {
    if (selectedLabel < 0) return;
    const text = m.querySelector('#sketchLabel').value.trim();
    if (!text) return toast('Type a label first', true);
    labels[selectedLabel].text = text;
    labels[selectedLabel].color = color;
    stateEl.textContent = 'Label updated.';
    paint();
  };
  m.querySelector('[data-delete-label]').onclick = () => {
    if (selectedLabel < 0) return;
    const removed = labels[selectedLabel];
    labels.splice(selectedLabel, 1);
    removeItemFromActions(actions, removed, 'labels');
    selectedLabel = -1;
    m.querySelector('#sketchLabel').value = '';
    stateEl.textContent = '';
    syncLabelButtons();
    syncUndoButton();
    paint();
  };
  syncLabelButtons();
  syncUndoButton();
  syncImageButton();

  m.querySelector('[data-import-image]').onclick = () => m.querySelector('#sketchImageFile').click();
  m.querySelector('#sketchImageFile').onchange = guard(async ev => {
    const file = ev.target.files?.[0];
    if (!file) return;
    imageTemplate = await loadImageTemplate(file);
    ev.target.value = '';
    syncImageButton();
    stateEl.textContent = 'Image template imported. Sketch on top, or use Clear image to remove it.';
    paint();
  });
  m.querySelector('[data-clear-image]').onclick = () => {
    imageTemplate = null;
    syncImageButton();
    stateEl.textContent = '';
    paint();
  };

  const undoStroke = () => {
    if (!actions.length) return;
    clearShapeHold();
    current = null;
    const action = actions.pop();
    removeActionItems(strokes, action.strokes);
    removeActionItems(labels, action.labels);
    selectedLabel = -1;
    stateEl.textContent = actions.length ? 'Last action removed.' : '';
    syncLabelButtons();
    syncUndoButton();
    paint();
  };
  m.querySelector('[data-undo]').onclick = undoStroke;
  m.addEventListener('keydown', ev => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(ev.target?.tagName || '')) return;
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'z') {
      ev.preventDefault();
      undoStroke();
    }
  });

  canvas.addEventListener('pointerdown', ev => {
    const p = pointFor(canvas, ev);
    const hit = hitLabel(ctx, labels, p);
    if (hit >= 0) {
      selectedLabel = hit;
      draggingLabel = { index: hit, dx: p.x - labels[hit].x, dy: p.y - labels[hit].y };
      m.querySelector('#sketchLabel').value = labels[hit].text;
      setTool('label');
      canvas.setPointerCapture(ev.pointerId);
      syncLabelButtons();
      paint();
      return;
    }
    if (tool === 'label') {
      if (selectedLabel < 0) {
        stateEl.textContent = 'Select a label first, or type one and tap Add label.';
        return;
      }
      labels[selectedLabel].x = clamp(p.x, 18, W - 18);
      labels[selectedLabel].y = clamp(p.y, 18, H - 18);
      draggingLabel = { index: selectedLabel, dx: 0, dy: 0 };
      canvas.setPointerCapture(ev.pointerId);
      paint();
      return;
    }
    canvas.setPointerCapture(ev.pointerId);
    selectedLabel = -1;
    syncLabelButtons();
    current = { tool, color, width: tool === 'eraser' ? width * 2.5 : width, points: [p] };
    strokes.push(current);
    actions.push({ strokes: [current], labels: [] });
    syncUndoButton();
    clearShapeHold();
    paint();
  });
  canvas.addEventListener('pointermove', ev => {
    if (draggingLabel) {
      const p = pointFor(canvas, ev);
      const label = labels[draggingLabel.index];
      label.x = clamp(p.x - draggingLabel.dx, 18, W - 18);
      label.y = clamp(p.y - draggingLabel.dy, 18, H - 18);
      paint();
      return;
    }
    if (!current) return;
    const p = pointFor(canvas, ev);
    if (current.shape) {
      if (current.shape === 'line') current.points = [current.points[0], p];
      paint();
      return;
    }
    current.points.push(p);
    scheduleShapeHold();
    paint();
  });
  canvas.addEventListener('pointerup', () => { clearShapeHold(); current = null; draggingLabel = null; });
  canvas.addEventListener('pointercancel', () => { clearShapeHold(); current = null; draggingLabel = null; });

  m.querySelector('[data-clear]').onclick = () => {
    strokes.length = 0; labels.length = 0; actions.length = 0; imageTemplate = null; selectedLabel = -1; draggingLabel = null;
    clearShapeHold(); previewEl.innerHTML = ''; stateEl.textContent = ''; syncLabelButtons(); syncUndoButton(); syncImageButton(); paint();
  };
  m.querySelector('[data-preview]').onclick = guard(async () => {
    const clean = renderCleanBlob(strokes, labels, template, smoothing, imageTemplate);
    previewEl.innerHTML = `<img class="figure-preview" src="${URL.createObjectURL(clean)}" alt="cleaned diagram preview"/>`;
  });
  m.querySelector('[data-save]').onclick = guard(async () => {
    if (!strokes.length && !labels.length && !imageTemplate) return toast('Draw, import an image, or place a label first', true);
    const saveBtn = m.querySelector('[data-save]');
    saveBtn.disabled = true;
    stateEl.textContent = 'Saving raw sketch and cleaned diagram...';
    const rawBlob = await canvasBlob(canvas);
    const cleanBlob = renderCleanBlob(strokes, labels, template, smoothing, imageTemplate);
    const raw = await api.uploadImage(rawBlob, 'raw-sketch.png', 'figure-raw', exp.id);
    const clean = await api.uploadImage(cleanBlob, 'clean-diagram.png', 'figure-clean', exp.id);
    const caption = m.querySelector('#figureCaption').value.trim() || 'Scientific figure sketch';
    await api.addEntry(exp.id, {
      type: 'figure',
      text: `${caption}\n\nRaw sketch and cleaned diagram attached for this experiment.`,
      imageUrl: clean.url,
      rawImageUrl: raw.url,
      cleanImageUrl: clean.url
    });
    closeModal();
    toast('Figure attached');
    onSaved();
  });
}

function pointFor(canvas, ev) {
  const r = canvas.getBoundingClientRect();
  return { x: (ev.clientX - r.left) * (W / r.width), y: (ev.clientY - r.top) * (H / r.height) };
}

function loadImageTemplate(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read image'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not load image'));
      img.onload = () => resolve({ img, name: file.name || 'template image', fit: imageFit(img) });
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function imageFit(img) {
  const iw = img.naturalWidth || img.width || W;
  const ih = img.naturalHeight || img.height || H;
  const scale = Math.min(W / iw, H / ih) * 0.92;
  const w = iw * scale;
  const h = ih * scale;
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}

function drawImageTemplate(ctx, template, clean) {
  if (!template?.img) return;
  const fit = template.fit || imageFit(template.img);
  ctx.save();
  ctx.globalAlpha = clean ? 0.28 : 0.38;
  ctx.drawImage(template.img, fit.x, fit.y, fit.w, fit.h);
  ctx.restore();
}

function drawStroke(ctx, stroke, clean, smoothing = 70) {
  const pts = clean ? cleanPoints(stroke.points, smoothing) : stroke.points;
  if (!pts.length) return;
  ctx.save();
  ctx.globalCompositeOperation = !clean && stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
  ctx.strokeStyle = stroke.tool === 'eraser' ? '#ffffff' : clean ? normalizeColor(stroke.color) : stroke.color;
  ctx.lineWidth = clean ? Math.max(3, stroke.width * 0.82) : stroke.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (stroke.shape && stroke.shape !== 'line') {
    drawSimpleShape(ctx, stroke);
    ctx.restore();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  if (pts.length === 1) ctx.lineTo(pts[0].x + 0.1, pts[0].y + 0.1);
  if (stroke.shape === 'line') {
    const end = pts[pts.length - 1];
    ctx.lineTo(end.x, end.y);
  } else {
    for (let i = 1; i < pts.length - 1; i++) {
      const mid = { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 };
      clean ? ctx.quadraticCurveTo(pts[i].x, pts[i].y, mid.x, mid.y) : ctx.lineTo(pts[i].x, pts[i].y);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last.x, last.y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawSimpleShape(ctx, stroke) {
  const b = stroke.bounds;
  ctx.beginPath();
  if (stroke.shape === 'rectangle' && b) {
    ctx.rect(b.x, b.y, b.w, b.h);
  } else if ((stroke.shape === 'circle' || stroke.shape === 'ellipse') && b) {
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const rx = stroke.shape === 'circle' ? (Math.abs(b.w) + Math.abs(b.h)) / 4 : Math.abs(b.w) / 2;
    const ry = stroke.shape === 'circle' ? rx : Math.abs(b.h) / 2;
    ctx.ellipse(cx, cy, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2);
  } else if (stroke.shape === 'triangle' && stroke.vertices?.length === 3) {
    ctx.moveTo(stroke.vertices[0].x, stroke.vertices[0].y);
    ctx.lineTo(stroke.vertices[1].x, stroke.vertices[1].y);
    ctx.lineTo(stroke.vertices[2].x, stroke.vertices[2].y);
    ctx.closePath();
  } else if (stroke.shape === 'blob' && stroke.vertices?.length > 2) {
    drawClosedSmoothPath(ctx, stroke.vertices);
  }
  if (stroke.fill) {
    ctx.save();
    ctx.fillStyle = stroke.fill;
    ctx.fill();
    ctx.restore();
  }
  ctx.stroke();
}

function drawClosedSmoothPath(ctx, points) {
  const last = points[points.length - 1];
  ctx.moveTo((points[0].x + last.x) / 2, (points[0].y + last.y) / 2);
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const next = points[(i + 1) % points.length];
    ctx.quadraticCurveTo(p.x, p.y, (p.x + next.x) / 2, (p.y + next.y) / 2);
  }
  ctx.closePath();
}

function builtInTemplate(name) {
  const ink = '#334155';
  const blue = '#2563eb';
  const green = '#059669';
  const red = '#dc2626';
  const purple = '#7c3aed';
  const gray = '#64748b';
  const cyanFill = 'rgba(191, 219, 254, .42)';
  const greenFill = 'rgba(187, 247, 208, .44)';
  const roseFill = 'rgba(254, 205, 211, .42)';
  const violetFill = 'rgba(221, 214, 254, .46)';
  if (name === 'synapse') {
    return {
      name: 'Synapse',
      strokes: [
        blobStroke([[260, 174], [315, 102], [455, 82], [615, 105], [725, 170], [690, 246], [540, 276], [370, 252]], red, 5, roseFill),
        curveStroke([[330, 254], [430, 276], [545, 278], [675, 248]], red, 5),
        ...[[377, 176], [462, 150], [548, 180], [628, 154]].map(([x, y]) => shapeStroke('circle', x, y, 36, 36, purple, 2.5, violetFill)),
        curveStroke([[260, 323], [375, 338], [520, 338], [665, 322], [755, 316]], gray, 2),
        blobStroke([[222, 402], [335, 354], [500, 374], [654, 354], [798, 404], [742, 468], [570, 486], [368, 466]], green, 5, greenFill),
        curveStroke([[280, 382], [405, 410], [520, 406], [650, 412], [746, 383]], green, 6),
        ...[405, 485, 565, 645].map(x => lineStroke(x, 358, x, 392, green, 3))
      ],
      labels: []
    };
  }
  if (name === 'microscope-slide') {
    return {
      name: 'Microscope slide',
      strokes: [
        shapeStroke('rectangle', 130, 145, 740, 310, blue, 5, cyanFill),
        lineStroke(315, 165, 315, 435, gray, 3),
        lineStroke(500, 165, 500, 435, gray, 3),
        lineStroke(685, 165, 685, 435, gray, 3),
        lineStroke(155, 300, 845, 300, gray, 2)
      ],
      labels: []
    };
  }
  if (name === 'cell') {
    return {
      name: 'Cell',
      strokes: [
        blobStroke([[245, 226], [318, 136], [465, 104], [623, 132], [735, 234], [706, 358], [592, 446], [424, 430], [285, 354]], blue, 5, cyanFill),
        blobStroke([[432, 250], [478, 204], [552, 214], [596, 270], [570, 336], [492, 346], [436, 306]], purple, 4, violetFill),
        shapeStroke('ellipse', 328, 318, 96, 44, green, 3, greenFill),
        curveStroke([[345, 340], [366, 328], [388, 350], [412, 336]], green, 2),
        shapeStroke('ellipse', 586, 204, 102, 46, green, 3, greenFill),
        curveStroke([[602, 228], [626, 212], [650, 236], [674, 220]], green, 2),
        curveStroke([[360, 214], [405, 196], [450, 210], [420, 236], [382, 244]], gray, 2.5),
        curveStroke([[620, 325], [654, 304], [690, 320], [670, 352], [628, 354]], gray, 2.5),
        ...[[382, 286], [640, 282], [516, 384]].map(([x, y]) => shapeStroke('circle', x, y, 18, 18, red, 2.5, roseFill))
      ],
      labels: []
    };
  }
  if (name === 'neuron') {
    return {
      name: 'Neuron',
      strokes: [
        blobStroke([[216, 242], [258, 194], [328, 204], [380, 258], [358, 332], [286, 374], [222, 338], [196, 286]], purple, 5, violetFill),
        shapeStroke('circle', 275, 274, 50, 50, blue, 3, cyanFill),
        curveStroke([[356, 294], [448, 286], [548, 305], [655, 292], [790, 318]], ink, 5),
        ...[[437, 268], [530, 289], [623, 274]].map(([x, y]) => shapeStroke('ellipse', x, y, 74, 42, blue, 3, cyanFill)),
        curveStroke([[212, 262], [154, 212], [108, 156]], green, 4),
        curveStroke([[153, 212], [120, 214], [84, 238]], green, 3),
        curveStroke([[155, 213], [150, 174], [166, 134]], green, 3),
        curveStroke([[220, 292], [150, 286], [98, 302], [66, 342]], green, 4),
        curveStroke([[128, 294], [96, 272], [66, 260]], green, 3),
        curveStroke([[238, 338], [188, 390], [142, 448]], green, 4),
        curveStroke([[188, 390], [142, 382], [100, 398]], green, 3),
        curveStroke([[335, 226], [382, 178], [428, 142]], green, 4),
        curveStroke([[790, 318], [838, 294], [882, 258]], ink, 4),
        curveStroke([[790, 318], [844, 342], [894, 382]], ink, 4)
      ],
      labels: []
    };
  }
  if (name === 'xy-axes') {
    const ticks = [260, 380, 500, 620, 740].flatMap(x => [lineStroke(x, 470, x, 482, gray, 2)]);
    const yTicks = [180, 250, 320, 390].flatMap(y => [lineStroke(190, y, 202, y, gray, 2)]);
    return {
      name: 'XY axes plot',
      strokes: [
        lineStroke(190, 480, 830, 480, ink, 5),
        lineStroke(190, 480, 190, 130, ink, 5),
        triangleStroke([{ x: 830, y: 480 }, { x: 808, y: 468 }, { x: 808, y: 492 }], ink, 4),
        triangleStroke([{ x: 190, y: 130 }, { x: 178, y: 152 }, { x: 202, y: 152 }], ink, 4),
        ...ticks,
        ...yTicks
      ],
      labels: []
    };
  }
  if (name === 'timeline-y') {
    return {
      name: 'Experiment timeline',
      strokes: [
        lineStroke(270, 500, 270, 110, ink, 5),
        triangleStroke([{ x: 270, y: 110 }, { x: 258, y: 132 }, { x: 282, y: 132 }], ink, 4),
        ...[430, 350, 270, 190].flatMap(y => [
          lineStroke(250, y, 290, y, gray, 3),
          lineStroke(270, y, 690, y, gray, 1.5)
        ]),
        shapeStroke('circle', 258, 418, 24, 24, blue, 3, cyanFill),
        shapeStroke('circle', 258, 338, 24, 24, green, 3, greenFill),
        shapeStroke('circle', 258, 258, 24, 24, purple, 3, violetFill),
        shapeStroke('circle', 258, 178, 24, 24, red, 3, roseFill)
      ],
      labels: []
    };
  }
  return null;
}

function templateKey(prompt = '') {
  const q = String(prompt || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!q) return '';
  if (/synap|cleft|pre syn|post syn/.test(q)) return 'synapse';
  if (/slide|microscope/.test(q)) return 'microscope-slide';
  if (/neuron|axon|dendrite/.test(q)) return 'neuron';
  if (/\bcell\b|nucleus|membrane/.test(q)) return 'cell';
  if (/timeline|time line|experiment time|timecourse|time course|y axis/.test(q)) return 'timeline-y';
  if (/xy|x y|plot|graph|axis|axes|chart/.test(q)) return 'xy-axes';
  return q.replace(/\s+/g, '-');
}

function lineStroke(x1, y1, x2, y2, color = '#334155', width = 4) {
  return { tool: 'pen', color, width, shape: 'line', points: [{ x: x1, y: y1 }, { x: x2, y: y2 }] };
}

function shapeStroke(shape, x, y, w, h, color = '#334155', width = 4, fill = '') {
  return { tool: 'pen', color, width, fill, shape, bounds: { x, y, w, h }, points: [{ x, y }, { x: x + w, y: y + h }] };
}

function triangleStroke(vertices, color = '#334155', width = 4) {
  return { tool: 'pen', color, width, shape: 'triangle', vertices, bounds: boundsOf(vertices), points: vertices };
}

function blobStroke(points, color = '#334155', width = 4, fill = '') {
  const vertices = points.map(([x, y]) => ({ x, y }));
  return { tool: 'pen', color, width, fill, shape: 'blob', vertices, bounds: boundsOf(vertices), points: vertices };
}

function curveStroke(points, color = '#334155', width = 4) {
  return { tool: 'pen', color, width, points: points.map(([x, y]) => ({ x, y })) };
}

function removeActionItems(list, items = []) {
  for (const item of items) {
    const index = list.lastIndexOf(item);
    if (index >= 0) list.splice(index, 1);
  }
}

function removeItemFromActions(actions, item, key) {
  for (let i = actions.length - 1; i >= 0; i--) {
    actions[i][key] = (actions[i][key] || []).filter(x => x !== item);
    if (!(actions[i].strokes || []).length && !(actions[i].labels || []).length) actions.splice(i, 1);
  }
}

function classifyShape(points) {
  const pts = points.filter(Boolean);
  if (pts.length < 2) return null;
  const b = boundsOf(pts);
  const diag = Math.hypot(b.w, b.h);
  const first = pts[0];
  const last = pts[pts.length - 1];
  const direct = dist(first, last);
  const path = pathLength(pts);
  if (diag < 30 || path < 34) return null;

  const closed = direct < Math.max(42, diag * 0.22) || direct / path < 0.14;
  if (!closed) return { kind: 'line', label: 'Straight line', points: [first, last] };
  if (Math.min(b.w, b.h) < 24) return null;

  const rectScore = rectangleScore(pts, b);
  if (rectScore < 0.06) return { kind: 'rectangle', label: 'Rectangle', bounds: b };

  const corners = polygonCorners(pts, diag);
  if (corners.length === 3) return { kind: 'triangle', label: 'Triangle', vertices: corners, bounds: b };

  const aspect = Math.min(b.w, b.h) / Math.max(b.w, b.h);
  const kind = aspect > 0.82 ? 'circle' : 'ellipse';
  return { kind, label: kind === 'circle' ? 'Circle' : 'Ellipse', bounds: b };
}

function boundsOf(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}

function pathLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1], points[i]);
  return total;
}

function rectangleScore(points, b) {
  const diag = Math.hypot(b.w, b.h) || 1;
  let total = 0;
  for (const p of points) {
    total += Math.min(
      Math.abs(p.x - b.x),
      Math.abs(p.x - (b.x + b.w)),
      Math.abs(p.y - b.y),
      Math.abs(p.y - (b.y + b.h))
    );
  }
  return total / points.length / diag;
}

function polygonCorners(points, diag) {
  const simplified = simplifyPoints(points, Math.max(8, diag * 0.055));
  const minGap = Math.max(18, diag * 0.08);
  const corners = [];
  for (const p of simplified) {
    const prev = corners[corners.length - 1];
    if (!prev || dist(prev, p) > minGap) corners.push(p);
  }
  if (corners.length > 1 && dist(corners[0], corners[corners.length - 1]) < minGap) corners.pop();
  return corners;
}

function cleanPoints(points, smoothing = 70) {
  const amount = clamp(Number(smoothing) || 0, 0, 100) / 100;
  const spaced = [];
  for (const p of points) {
    const last = spaced[spaced.length - 1];
    if (!last || dist(last, p) >= 2.5) spaced.push(p);
  }
  if (spaced.length < 4) return spaced;
  if (amount <= 0.02) return spaced;
  let cleaned = simplifyPoints(spaced, 0.5 + amount * 1.8);
  cleaned = resamplePoints(cleaned, 4 + amount * 6);
  cleaned = smoothPoints(cleaned, Math.round(1 + amount * 7));
  cleaned = chaikinPoints(cleaned, amount > 0.35 ? 1 : 0);
  return simplifyPoints(cleaned, Math.max(0.35, 1.2 - amount * 0.35));
}

function resamplePoints(points, spacing) {
  if (points.length < 2) return points;
  const out = [points[0]];
  let cursor = points[0];
  let remaining = spacing;
  for (let i = 1; i < points.length; i++) {
    let next = points[i];
    let segment = dist(cursor, next);
    while (segment >= remaining && segment > 0) {
      const t = remaining / segment;
      cursor = {
        x: cursor.x + (next.x - cursor.x) * t,
        y: cursor.y + (next.y - cursor.y) * t
      };
      out.push(cursor);
      segment = dist(cursor, next);
      remaining = spacing;
    }
    remaining -= segment;
    cursor = next;
  }
  const last = points[points.length - 1];
  if (dist(out[out.length - 1], last) > spacing * 0.45) out.push(last);
  return out;
}

function smoothPoints(points, passes = 1) {
  let out = points;
  for (let pass = 0; pass < passes; pass++) {
    if (out.length < 3) return out;
    out = out.map((p, i) => {
      if (i === 0 || i === out.length - 1) return p;
      const a = out[Math.max(0, i - 2)];
      const b = out[i - 1];
      const d = out[i + 1];
      const e = out[Math.min(out.length - 1, i + 2)];
      return {
        x: a.x * 0.08 + b.x * 0.22 + p.x * 0.4 + d.x * 0.22 + e.x * 0.08,
        y: a.y * 0.08 + b.y * 0.22 + p.y * 0.4 + d.y * 0.22 + e.y * 0.08
      };
    });
  }
  return out;
}

function chaikinPoints(points, passes = 1) {
  let out = points;
  for (let pass = 0; pass < passes; pass++) {
    if (out.length < 3) return out;
    const next = [out[0]];
    for (let i = 0; i < out.length - 1; i++) {
      const a = out[i];
      const b = out[i + 1];
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    next.push(out[out.length - 1]);
    out = next;
  }
  return out;
}

function simplifyPoints(points, epsilon) {
  if (points.length < 3) return points;
  let max = 0;
  let index = 0;
  const first = points[0];
  const last = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = pointLineDistance(points[i], first, last);
    if (d > max) { index = i; max = d; }
  }
  if (max <= epsilon) return [first, last];
  const left = simplifyPoints(points.slice(0, index + 1), epsilon);
  const right = simplifyPoints(points.slice(index), epsilon);
  return left.slice(0, -1).concat(right);
}

function pointLineDistance(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (!len) return dist(p, a);
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function drawSlideTemplate(ctx, clean) {
  ctx.save();
  ctx.strokeStyle = clean ? '#334155' : '#94a3b8';
  ctx.lineWidth = clean ? 4 : 3;
  roundRect(ctx, 96, 126, 808, 348, 42);
  ctx.stroke();
  ctx.strokeStyle = clean ? '#64748b' : '#cbd5e1';
  ctx.lineWidth = clean ? 2 : 1.5;
  for (let i = 1; i < 4; i++) {
    const x = 96 + (808 / 4) * i;
    ctx.beginPath();
    ctx.moveTo(x, 150);
    ctx.lineTo(x, 450);
    ctx.stroke();
  }
  ctx.setLineDash([10, 10]);
  ctx.beginPath();
  ctx.moveTo(126, 300);
  ctx.lineTo(874, 300);
  ctx.stroke();
  ctx.restore();
}

function drawLabel(ctx, label, clean, selected = false) {
  ctx.save();
  ctx.fillStyle = clean ? normalizeColor(label.color) : label.color;
  ctx.font = `${clean ? 25 : 23}px system-ui, -apple-system, Segoe UI, sans-serif`;
  ctx.textBaseline = 'middle';
  if (selected && !clean) {
    const b = labelBox(ctx, label);
    ctx.fillStyle = 'rgba(37,99,235,.1)';
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 2;
    roundRect(ctx, b.x, b.y, b.w, b.h, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = label.color;
  }
  ctx.fillText(label.text, label.x, label.y);
  ctx.restore();
}

function hitLabel(ctx, labels, p) {
  for (let i = labels.length - 1; i >= 0; i--) {
    const b = labelBox(ctx, labels[i]);
    if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return i;
  }
  return -1;
}

function labelBox(ctx, label) {
  ctx.save();
  ctx.font = '23px system-ui, -apple-system, Segoe UI, sans-serif';
  const w = Math.max(58, ctx.measureText(label.text).width + 30);
  ctx.restore();
  return { x: label.x - 15, y: label.y - 26, w, h: 52 };
}

function renderCleanBlob(strokes, labels, template, smoothing = 70, imageTemplate = null) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const cx = c.getContext('2d');
  cx.fillStyle = '#ffffff';
  cx.fillRect(0, 0, W, H);
  if (imageTemplate) drawImageTemplate(cx, imageTemplate, true);
  if (template) drawSlideTemplate(cx, true);
  strokes.forEach(s => drawStroke(cx, s, true, smoothing));
  labels.forEach(l => drawLabel(cx, l, true));
  return dataUrlToBlob(c.toDataURL('image/png'));
}

function canvasBlob(canvas) {
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

function dataUrlToBlob(dataUrl) {
  const [meta, data] = dataUrl.split(',');
  const mime = /data:([^;]+)/.exec(meta)?.[1] || 'image/png';
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function normalizeColor(c) {
  return c === '#111827' ? '#0f172a' : c;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
