const EPSILON = "epsilon";
const RADIUS = 28;

const state = {
  nfa: {
    states: [],
    transitions: [],
    alphabet: [],
    start: null,
    finals: new Set(),
    nextId: 0,
  },
  dfa: {
    states: [],
    transitions: [],
    start: null,
    finals: new Set(),
    queue: [],
    seen: new Map(),
    complete: false,
  },
  view: {
    nfa: { scale: 1, x: 0, y: 0 },
    dfa: { scale: 1, x: 0, y: 0 },
  },
  conversionHistory: [],
  drag: null,
  animating: false,
};

const nfaCanvas = document.querySelector("#nfaCanvas");
const dfaCanvas = document.querySelector("#dfaCanvas");
const nfaCtx = nfaCanvas.getContext("2d");
const dfaCtx = dfaCanvas.getContext("2d");
const contextMenu = document.querySelector("#contextMenu");
const fileInput = document.querySelector("#fileInput");
const defineDialog = document.querySelector("#defineDialog");
const defineError = document.querySelector("#defineError");
const stringDialog = document.querySelector("#stringDialog");
const stringResult = document.querySelector("#stringResult");
const stringDialogResult = document.querySelector("#stringDialogResult");

const presets = {
  "ends-with-ab": {
    states: [
      { id: "q0", label: "q0", x: 140, y: 210 },
      { id: "q1", label: "q1", x: 330, y: 210 },
      { id: "q2", label: "q2", x: 520, y: 210 },
    ],
    transitions: [
      { from: "q0", to: "q0", symbol: "a" },
      { from: "q0", to: "q0", symbol: "b" },
      { from: "q0", to: "q1", symbol: "a" },
      { from: "q1", to: "q2", symbol: "b" },
    ],
    alphabet: ["a", "b"],
    start: "q0",
    finals: ["q2"],
  },
  "contains-a": {
    states: [
      { id: "q0", label: "q0", x: 170, y: 210 },
      { id: "q1", label: "q1", x: 390, y: 210 },
    ],
    transitions: [
      { from: "q0", to: "q1", symbol: "a" },
      { from: "q0", to: "q0", symbol: "b" },
      { from: "q1", to: "q1", symbol: "a" },
      { from: "q1", to: "q1", symbol: "b" },
    ],
    alphabet: ["a", "b"],
    start: "q0",
    finals: ["q1"],
  },
  epsilon: {
    states: [
      { id: "q0", label: "q0", x: 130, y: 240 },
      { id: "q1", label: "q1", x: 330, y: 150 },
      { id: "q2", label: "q2", x: 330, y: 330 },
      { id: "q3", label: "q3", x: 550, y: 240 },
    ],
    transitions: [
      { from: "q0", to: "q1", symbol: EPSILON },
      { from: "q0", to: "q2", symbol: EPSILON },
      { from: "q1", to: "q3", symbol: "a" },
      { from: "q2", to: "q3", symbol: "b" },
    ],
    alphabet: ["a", "b"],
    start: "q0",
    finals: ["q3"],
  },
};

function fitCanvas(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(rect.width * ratio));
  canvas.height = Math.max(1, Math.round(rect.height * ratio));
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function worldPoint(canvas, view, event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left - view.x) / view.scale,
    y: (event.clientY - rect.top - view.y) / view.scale,
  };
}

function alphabet() {
  return [...new Set([...state.nfa.alphabet, ...state.nfa.transitions
    .map((transition) => transition.symbol)
    .filter((symbol) => symbol !== EPSILON)])]
    .sort();
}

function addState(x, y) {
  const id = `q${state.nfa.nextId++}`;
  state.nfa.states.push({ id, label: id, x, y });
  if (!state.nfa.start) state.nfa.start = id;
  resetDfa();
  render();
}

function removeState(id) {
  state.nfa.states = state.nfa.states.filter((node) => node.id !== id);
  state.nfa.transitions = state.nfa.transitions.filter((edge) => edge.from !== id && edge.to !== id);
  state.nfa.finals.delete(id);
  if (state.nfa.start === id) state.nfa.start = state.nfa.states[0]?.id || null;
  resetDfa();
  render();
}

function normalizeSymbol(value) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "e" || trimmed.toLowerCase() === "epsilon" || trimmed.toLowerCase() === "eps") {
    return EPSILON;
  }
  return trimmed;
}

function displaySymbol(symbol) {
  return symbol === EPSILON ? "eps" : symbol;
}

function splitList(value) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function addTransition(from, to, symbols) {
  symbols.split(",")
    .map(normalizeSymbol)
    .filter(Boolean)
    .forEach((symbol) => {
      state.nfa.transitions.push({ from, to, symbol });
      if (symbol !== EPSILON && !state.nfa.alphabet.includes(symbol)) state.nfa.alphabet.push(symbol);
    });
  resetDfa();
  render();
}

function nodeAt(machine, point) {
  for (let index = machine.states.length - 1; index >= 0; index--) {
    const node = machine.states[index];
    if (Math.hypot(node.x - point.x, node.y - point.y) <= RADIUS) return node;
  }
  return undefined;
}

function getNode(machine, id) {
  return machine.states.find((node) => node.id === id);
}

function showMenu(items, x, y) {
  contextMenu.innerHTML = "";
  items.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = item.label;
    button.addEventListener("click", () => {
      hideMenu();
      item.action();
    });
    contextMenu.append(button);
  });
  contextMenu.style.left = `${x}px`;
  contextMenu.style.top = `${y}px`;
  contextMenu.hidden = false;
}

function hideMenu() {
  contextMenu.hidden = true;
}

function menuForCanvas(event) {
  event.preventDefault();
  const point = worldPoint(nfaCanvas, state.view.nfa, event);
  const node = nodeAt(state.nfa, point);
  if (!node) {
    showMenu([{ label: "Add state", action: () => addState(point.x, point.y) }], event.clientX, event.clientY);
    return;
  }

  showMenu([
    {
      label: state.nfa.start === node.id ? "Start state" : "Make start state",
      action: () => {
        state.nfa.start = node.id;
        resetDfa();
        render();
      },
    },
    {
      label: state.nfa.finals.has(node.id) ? "Unset final state" : "Make final state",
      action: () => {
        if (state.nfa.finals.has(node.id)) state.nfa.finals.delete(node.id);
        else state.nfa.finals.add(node.id);
        resetDfa();
        render();
      },
    },
    {
      label: "Rename state",
      action: () => {
        const label = prompt("State label", node.label);
        if (label) node.label = label.trim();
        render();
      },
    },
    {
      label: "Add transition",
      action: () => pickTransitionTarget(node),
    },
    {
      label: "Delete state",
      action: () => removeState(node.id),
    },
  ], event.clientX, event.clientY);
}

function pickTransitionTarget(source) {
  const targetName = prompt("Transition target state label", source.label);
  if (!targetName) return;
  const target = state.nfa.states.find((node) => node.label === targetName.trim() || node.id === targetName.trim());
  if (!target) {
    alert("No state with that label was found.");
    return;
  }
  const symbol = prompt("Transition symbol. Use e, eps, or epsilon for epsilon.", "a");
  if (symbol === null) return;
  addTransition(source.id, target.id, symbol);
}

function openDefineDialog() {
  document.querySelector("#statesInput").value = state.nfa.states.map((node) => node.label).join(", ");
  document.querySelector("#alphabetInput").value = alphabet().join(", ");
  document.querySelector("#startInput").value = getNode(state.nfa, state.nfa.start)?.label || "";
  document.querySelector("#finalsInput").value = [...state.nfa.finals].map((id) => getNode(state.nfa, id)?.label || id).join(", ");
  document.querySelector("#transitionsInput").value = state.nfa.transitions.map((edge) => {
    const from = getNode(state.nfa, edge.from)?.label || edge.from;
    const to = getNode(state.nfa, edge.to)?.label || edge.to;
    return `${from},${displaySymbol(edge.symbol)},${to}`;
  }).join("\n");
  defineError.hidden = true;
  defineError.textContent = "";
  defineDialog.showModal();
}

function parseUserNfa() {
  const names = splitList(document.querySelector("#statesInput").value);
  const alphabetNames = splitList(document.querySelector("#alphabetInput").value).map(normalizeSymbol).filter((symbol) => symbol !== EPSILON);
  const startName = document.querySelector("#startInput").value.trim();
  const finalNames = splitList(document.querySelector("#finalsInput").value);
  const transitionLines = document.querySelector("#transitionsInput").value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!names.length) throw new Error("Add at least one state.");
  if (new Set(names).size !== names.length) throw new Error("State names must be unique.");
  if (!startName) throw new Error("Choose a start state.");
  if (!names.includes(startName)) throw new Error("Start state must exist in the state list.");
  finalNames.forEach((name) => {
    if (!names.includes(name)) throw new Error(`Final state ${name} is not in the state list.`);
  });

  const columns = Math.ceil(Math.sqrt(names.length));
  const states = names.map((name, index) => ({
    id: `q${index}`,
    label: name,
    x: 150 + (index % columns) * 150,
    y: 150 + Math.floor(index / columns) * 120,
  }));
  const byName = new Map(states.map((node) => [node.label, node.id]));
  const transitions = [];

  transitionLines.forEach((line, index) => {
    const parts = line.split(",").map((part) => part.trim());
    if (parts.length !== 3 || parts.some((part) => !part)) {
      throw new Error(`Line ${index + 1} must look like: from,symbol,to`);
    }
    const [fromName, symbolName, toName] = parts;
    if (!byName.has(fromName)) throw new Error(`Line ${index + 1}: ${fromName} is not a state.`);
    if (!byName.has(toName)) throw new Error(`Line ${index + 1}: ${toName} is not a state.`);
    transitions.push({
      from: byName.get(fromName),
      to: byName.get(toName),
      symbol: normalizeSymbol(symbolName),
    });
  });

  return {
    states,
    transitions,
    alphabet: alphabetNames,
    start: byName.get(startName),
    finals: finalNames.map((name) => byName.get(name)),
  };
}

function applyUserNfa(event) {
  event.preventDefault();
  try {
    loadNfa(parseUserNfa());
    defineDialog.close();
  } catch (error) {
    defineError.textContent = error.message;
    defineError.hidden = false;
  }
}

function loadDefineExample() {
  document.querySelector("#statesInput").value = "1, 2, 3";
  document.querySelector("#alphabetInput").value = "a, b";
  document.querySelector("#startInput").value = "1";
  document.querySelector("#finalsInput").value = "2";
  document.querySelector("#transitionsInput").value = [
    "1,a,3",
    "1,eps,2",
    "3,a,2",
    "3,b,2",
    "3,eps,2",
  ].join("\n");
  defineError.hidden = true;
}

function resetDfa() {
  state.dfa = {
    states: [],
    transitions: [],
    start: null,
    finals: new Set(),
    queue: [],
    seen: new Map(),
    complete: false,
  };
  state.conversionHistory = [];
  if (state.animating) stopAnimation();
}

function snapshotDfa() {
  return JSON.stringify({
    states: state.dfa.states,
    transitions: state.dfa.transitions,
    start: state.dfa.start,
    finals: [...state.dfa.finals],
    queue: state.dfa.queue,
    seen: [...state.dfa.seen.entries()],
    complete: state.dfa.complete,
  });
}

function restoreDfa(snapshot) {
  const data = JSON.parse(snapshot);
  state.dfa.states = data.states;
  state.dfa.transitions = data.transitions;
  state.dfa.start = data.start;
  state.dfa.finals = new Set(data.finals);
  state.dfa.queue = data.queue;
  state.dfa.seen = new Map(data.seen);
  state.dfa.complete = data.complete;
}

function setFromArray(items) {
  return new Set(items.filter(Boolean));
}

function keyOf(set) {
  return [...set].sort().join(",");
}

function labelOf(set) {
  return set.size ? [...set].sort().map((id) => getNode(state.nfa, id)?.label || id).join(",") : "{}";
}

function epsilonClosure(ids) {
  const result = setFromArray(ids);
  const stack = [...result];
  while (stack.length) {
    const current = stack.pop();
    state.nfa.transitions
      .filter((edge) => edge.from === current && edge.symbol === EPSILON)
      .forEach((edge) => {
        if (!result.has(edge.to)) {
          result.add(edge.to);
          stack.push(edge.to);
        }
      });
  }
  return result;
}

function moveFrom(ids, symbol) {
  const result = new Set();
  ids.forEach((id) => {
    state.nfa.transitions
      .filter((edge) => edge.from === id && edge.symbol === symbol)
      .forEach((edge) => result.add(edge.to));
  });
  return result;
}

function ensureDfaStarted() {
  if (state.dfa.start || !state.nfa.start) return;
  const startSet = epsilonClosure([state.nfa.start]);
  const key = keyOf(startSet);
  const startNode = {
    id: `D${state.dfa.states.length}`,
    label: labelOf(startSet),
    nfaStates: [...startSet],
    x: 150,
    y: 230,
  };
  state.dfa.states.push(startNode);
  state.dfa.start = startNode.id;
  state.dfa.seen.set(key, startNode.id);
  state.dfa.queue.push(key);
  if (startNode.nfaStates.some((id) => state.nfa.finals.has(id))) state.dfa.finals.add(startNode.id);
}

function addDfaState(set) {
  const index = state.dfa.states.length;
  const node = {
    id: `D${index}`,
    label: labelOf(set),
    nfaStates: [...set],
    x: 130 + (index % 4) * 145,
    y: 145 + Math.floor(index / 4) * 115,
  };
  state.dfa.states.push(node);
  if (node.nfaStates.some((id) => state.nfa.finals.has(id))) state.dfa.finals.add(node.id);
  return node;
}

function layoutDfaStates() {
  const total = state.dfa.states.length;
  if (!total) return;
  const columns = Math.max(2, Math.ceil(Math.sqrt(total)));
  const xGap = 145;
  const yGap = 112;
  state.dfa.states.forEach((node, index) => {
    node.x = 105 + (index % columns) * xGap;
    node.y = 125 + Math.floor(index / columns) * yGap;
  });
}

function stepDfa() {
  if (!state.nfa.start || state.dfa.complete) return false;
  state.conversionHistory.push(snapshotDfa());
  ensureDfaStarted();
  const symbols = alphabet();
  if (!symbols.length) {
    state.dfa.complete = true;
    layoutDfaStates();
    render();
    return false;
  }
  const currentKey = state.dfa.queue.shift();
  if (!currentKey) {
    state.dfa.complete = true;
    layoutDfaStates();
    render();
    return false;
  }
  const currentId = state.dfa.seen.get(currentKey);
  const currentSet = setFromArray(currentKey.split(","));
  symbols.forEach((symbol) => {
    const destinationSet = epsilonClosure([...moveFrom(currentSet, symbol)]);
    const destinationKey = keyOf(destinationSet);
    if (!state.dfa.seen.has(destinationKey)) {
      const node = addDfaState(destinationSet);
      state.dfa.seen.set(destinationKey, node.id);
      state.dfa.queue.push(destinationKey);
    }
    const to = state.dfa.seen.get(destinationKey);
    if (!state.dfa.transitions.some((edge) => edge.from === currentId && edge.to === to && edge.symbol === symbol)) {
      state.dfa.transitions.push({ from: currentId, to, symbol });
    }
  });
  layoutDfaStates();
  render();
  return true;
}

function backDfa() {
  const snapshot = state.conversionHistory.pop();
  if (!snapshot) return;
  restoreDfa(snapshot);
  render();
}

function completeDfa() {
  let guard = 0;
  while (stepDfa() && guard < 500) guard++;
}

function animateDfa() {
  if (state.animating) {
    stopAnimation();
    return;
  }
  state.animating = window.setInterval(() => {
    if (!stepDfa()) stopAnimation();
  }, 650);
  document.querySelector("#animateBtn").textContent = "Stop";
}

function stopAnimation() {
  window.clearInterval(state.animating);
  state.animating = false;
  document.querySelector("#animateBtn").textContent = "Animate";
}

function drawMachine(ctx, canvas, machine, view, isDfa) {
  const rect = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.save();
  ctx.translate(view.x, view.y);
  ctx.scale(view.scale, view.scale);
  drawTransitions(ctx, machine);
  machine.states.forEach((node) => drawNode(ctx, machine, node, isDfa));
  ctx.restore();
}

function drawNode(ctx, machine, node, isDfa) {
  const isStart = machine.start === node.id;
  const isFinal = machine.finals.has(node.id);
  ctx.save();
  ctx.shadowColor = isFinal ? "rgba(217, 4, 41, 0.86)" : "rgba(27, 124, 255, 0.68)";
  ctx.shadowBlur = isFinal ? 26 : 16;
  ctx.lineWidth = 2.6;
  ctx.fillStyle = isFinal ? "#c80d28" : "#20a9e8";
  ctx.strokeStyle = "#05070c";
  ctx.beginPath();
  ctx.arc(node.x, node.y, RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = isFinal ? "#f6f8ff" : "#b9e8ff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(node.x, node.y, RADIUS - 3, 0, Math.PI * 2);
  ctx.stroke();
  if (isFinal) {
    ctx.beginPath();
    ctx.arc(node.x, node.y, RADIUS + 5, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (isStart) {
    ctx.beginPath();
    ctx.moveTo(node.x - RADIUS - 42, node.y);
    ctx.lineTo(node.x - RADIUS - 6, node.y);
    ctx.strokeStyle = "#f6f8ff";
    ctx.lineWidth = 2.4;
    ctx.stroke();
    drawArrowHead(ctx, node.x - RADIUS - 6, node.y, 0);
  }
  ctx.fillStyle = "#f6f8ff";
  ctx.font = isDfa && node.label.length > 12 ? "800 11px system-ui" : "900 14px system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  wrapLabel(ctx, node.label, node.x, node.y);
  ctx.restore();
}

function wrapLabel(ctx, label, x, y) {
  if (label.length <= 11) {
    ctx.fillText(label, x, y);
    return;
  }
  const compact = label.replace(/[{}]/g, "").split(",").join(" ");
  const first = compact.slice(0, 12);
  const second = compact.length > 12 ? compact.slice(12, 23) : "";
  ctx.fillText(first, x, y - 6);
  if (second) ctx.fillText(second, x, y + 8);
}

function groupedTransitions(machine) {
  const map = new Map();
  machine.transitions.forEach((edge) => {
    const key = `${edge.from}->${edge.to}`;
    if (!map.has(key)) map.set(key, { from: edge.from, to: edge.to, symbols: [] });
    map.get(key).symbols.push(edge.symbol);
  });
  return [...map.values()];
}

function drawTransitions(ctx, machine) {
  groupedTransitions(machine).forEach((edge) => {
    const from = getNode(machine, edge.from);
    const to = getNode(machine, edge.to);
    if (!from || !to) return;
    ctx.save();
    const label = edge.symbols.map((symbol) => symbol === EPSILON ? "eps" : symbol).join(", ");
    ctx.strokeStyle = machine === state.dfa ? "#65a3ff" : "#ff3b58";
    ctx.fillStyle = "#f6f8ff";
    ctx.lineWidth = 2.7;
    ctx.shadowColor = machine === state.dfa ? "rgba(27, 124, 255, 0.45)" : "rgba(217, 4, 41, 0.5)";
    ctx.shadowBlur = 9;
    if (from.id === to.id) {
      drawLoop(ctx, from, label);
      ctx.restore();
      return;
    }
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const start = { x: from.x + Math.cos(angle) * RADIUS, y: from.y + Math.sin(angle) * RADIUS };
    const end = { x: to.x - Math.cos(angle) * RADIUS, y: to.y - Math.sin(angle) * RADIUS };
    const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const normal = { x: -Math.sin(angle), y: Math.cos(angle) };
    const curve = 24;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.quadraticCurveTo(mid.x + normal.x * curve, mid.y + normal.y * curve, end.x, end.y);
    ctx.stroke();
    drawArrowHead(ctx, end.x, end.y, angle);
    drawEdgeLabel(ctx, label, mid.x + normal.x * 30, mid.y + normal.y * 30);
    ctx.restore();
  });
}

function drawLoop(ctx, node, label) {
  ctx.beginPath();
  ctx.arc(node.x, node.y - RADIUS - 15, 18, Math.PI * 0.15, Math.PI * 1.85);
  ctx.stroke();
  drawArrowHead(ctx, node.x + 15, node.y - RADIUS - 6, 1.3);
  drawEdgeLabel(ctx, label, node.x, node.y - RADIUS - 42);
}

function drawArrowHead(ctx, x, y, angle) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-9, -5);
  ctx.lineTo(-9, 5);
  ctx.closePath();
  ctx.fillStyle = ctx.strokeStyle;
  ctx.fill();
  ctx.restore();
}

function drawEdgeLabel(ctx, label, x, y) {
  ctx.save();
  ctx.font = "800 12px system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const width = Math.max(22, ctx.measureText(label).width + 12);
  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(5, 7, 12, 0.9)";
  ctx.fillRect(x - width / 2, y - 11, width, 22);
  ctx.strokeStyle = "rgba(246, 248, 255, 0.26)";
  ctx.strokeRect(x - width / 2, y - 11, width, 22);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(label, x, y);
  ctx.restore();
}

function renderInfo() {
  document.querySelector("#nfaInfo").innerHTML = machineInfo(state.nfa, false);
  document.querySelector("#dfaInfo").innerHTML = machineInfo(state.dfa, true);
  document.querySelector("#backBtn").disabled = state.conversionHistory.length === 0;
  document.querySelector("#stepBtn").disabled = !state.nfa.start || state.dfa.complete;
  document.querySelector("#completeBtn").disabled = !state.nfa.start || state.dfa.complete;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function nodeLabel(machine, id) {
  if (!id) return "";
  return getNode(machine, id)?.label || id;
}

function tableSymbols(machine, isDfa) {
  const symbols = isDfa ? alphabet() : [...new Set([...alphabet(), ...machine.transitions.map((edge) => edge.symbol)])];
  return symbols.sort((left, right) => {
    if (left === EPSILON) return 1;
    if (right === EPSILON) return -1;
    return left.localeCompare(right);
  });
}

function tableTargets(machine, rowId, symbol) {
  const targets = machine.transitions
    .filter((edge) => edge.from === rowId && edge.symbol === symbol)
    .map((edge) => nodeLabel(machine, edge.to));
  return targets.length ? [...new Set(targets)].join(", ") : "{}";
}

function machineInfo(machine, isDfa) {
  const symbols = tableSymbols(machine, isDfa);
  const states = machine.states.map((node) => node.label).join(", ") || "none";
  const alphabetText = symbols.map(displaySymbol).join(", ") || "none";
  const start = nodeLabel(machine, machine.start) || "none";
  const finals = [...machine.finals].map((id) => nodeLabel(machine, id)).join(", ") || "none";
  const heading = isDfa ? "M = (Q', E, delta', q0', F')" : "N = (Q, E, delta, q0, F)";
  const tableHead = symbols.map((symbol) => `<th>${escapeHtml(displaySymbol(symbol))}</th>`).join("");
  const tableRows = machine.states.map((node) => `
    <tr>
      <td>${escapeHtml(node.label)}</td>
      ${symbols.map((symbol) => `<td>${escapeHtml(tableTargets(machine, node.id, symbol))}</td>`).join("")}
    </tr>
  `).join("") || `<tr><td colspan="${symbols.length + 1}">No states yet</td></tr>`;

  return `
    <div class="formula">${heading}</div>
    <div class="definition-row">
      <div><b>Q${isDfa ? "'" : ""}</b>${escapeHtml(states)}</div>
      <div><b>E</b>${escapeHtml(alphabetText)}</div>
      <div><b>q0${isDfa ? "'" : ""}</b>${escapeHtml(start)}</div>
      <div><b>F${isDfa ? "'" : ""}</b>${escapeHtml(finals)}</div>
    </div>
    <div class="table-wrap">
      <table class="transition-table">
        <thead>
          <tr><th>delta${isDfa ? "'" : ""}</th>${tableHead}</tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
    <div class="status-line">${isDfa ? (machine.complete ? "DFA complete" : `${machine.queue.length} unprocessed DFA state sets`) : `${machine.transitions.length} NFA transitions`}</div>
  `;
}

function render() {
  fitCanvas(nfaCanvas);
  fitCanvas(dfaCanvas);
  drawMachine(nfaCtx, nfaCanvas, state.nfa, state.view.nfa, false);
  drawMachine(dfaCtx, dfaCanvas, state.dfa, state.view.dfa, true);
  renderInfo();
}

function exportNfa() {
  const data = JSON.stringify({
    states: state.nfa.states,
    transitions: state.nfa.transitions,
    alphabet: state.nfa.alphabet,
    start: state.nfa.start,
    finals: [...state.nfa.finals],
  }, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "nfa.json";
  link.click();
  URL.revokeObjectURL(link.href);
}

function loadNfa(data) {
  state.nfa.states = data.states || [];
  state.nfa.transitions = data.transitions || [];
  state.nfa.alphabet = data.alphabet || [...new Set(state.nfa.transitions
    .map((edge) => edge.symbol)
    .filter((symbol) => symbol !== EPSILON))];
  state.nfa.start = data.start || state.nfa.states[0]?.id || null;
  state.nfa.finals = new Set(data.finals || []);
  state.nfa.nextId = state.nfa.states.reduce((max, node) => {
    const number = Number(String(node.id).replace(/\D/g, ""));
    return Number.isFinite(number) ? Math.max(max, number + 1) : max;
  }, state.nfa.states.length);
  resetDfa();
  render();
}

function clearAll() {
  clearNfa();
  clearDfa();
}

function clearNfa() {
  state.nfa.states = [];
  state.nfa.transitions = [];
  state.nfa.alphabet = [];
  state.nfa.start = null;
  state.nfa.finals = new Set();
  state.nfa.nextId = 0;
  state.view.nfa = { scale: 1, x: 0, y: 0 };
  document.querySelector("#presetSelect").value = "";
  clearDfa();
}

function clearDfa() {
  stopAnimation();
  state.view.dfa = { scale: 1, x: 0, y: 0 };
  resetDfa();
  render();
}

function openStringDialog() {
  const currentInput = document.querySelector("#stringInput").value;
  document.querySelector("#stringDialogInput").value = currentInput;
  stringDialogResult.hidden = true;
  stringDialogResult.innerHTML = "";
  stringDialog.showModal();
}

function inputSymbolsFromText(value) {
  const text = value.trim();
  if (!text) return [];
  if (text.includes(",")) return text.split(",").map((part) => part.trim()).filter(Boolean);
  if (/\s/.test(text)) return text.split(/\s+/).map((part) => part.trim()).filter(Boolean);
  return [...text];
}

function stateSetText(ids) {
  return ids.length ? ids.map((id) => nodeLabel(state.nfa, id)).join(", ") : "{}";
}

function simulateNfa(symbols) {
  if (!state.nfa.start) {
    return { accepted: false, detail: "No NFA start state is defined." };
  }
  let current = epsilonClosure([state.nfa.start]);
  const path = [`start: ${stateSetText([...current])}`];
  symbols.forEach((symbol) => {
    current = epsilonClosure([...moveFrom(current, symbol)]);
    path.push(`${symbol}: ${stateSetText([...current])}`);
  });
  const accepted = [...current].some((id) => state.nfa.finals.has(id));
  return {
    accepted,
    detail: `${accepted ? "Accepted" : "Rejected"} by NFA. ${path.join(" -> ")}`,
  };
}

function simulateDfa(symbols) {
  if (!state.nfa.start) {
    return { accepted: false, detail: "No DFA can be built until the NFA has a start state." };
  }
  if (!state.dfa.complete) completeDfa();
  let current = state.dfa.start;
  const path = [`start: ${nodeLabel(state.dfa, current)}`];
  for (const symbol of symbols) {
    const edge = state.dfa.transitions.find((transition) => transition.from === current && transition.symbol === symbol);
    if (!edge) {
      return {
        accepted: false,
        detail: `Rejected by DFA. Missing transition from ${nodeLabel(state.dfa, current)} on ${symbol}.`,
      };
    }
    current = edge.to;
    path.push(`${symbol}: ${nodeLabel(state.dfa, current)}`);
  }
  const accepted = state.dfa.finals.has(current);
  return {
    accepted,
    detail: `${accepted ? "Accepted" : "Rejected"} by DFA. ${path.join(" -> ")}`,
  };
}

function renderStringResult(inputValue, output) {
  const symbols = inputSymbolsFromText(inputValue);
  const nfaResult = simulateNfa(symbols);
  const dfaResult = simulateDfa(symbols);
  const inputText = symbols.length ? symbols.join(" ") : "empty string";
  output.innerHTML = `
    <div class="result-card ${nfaResult.accepted ? "accept" : "reject"}">
      <b>NFA result for ${escapeHtml(inputText)}</b>
      ${escapeHtml(nfaResult.detail)}
    </div>
    <div class="result-card ${dfaResult.accepted ? "accept" : "reject"}">
      <b>DFA result for ${escapeHtml(inputText)}</b>
      ${escapeHtml(dfaResult.detail)}
    </div>
  `;
  output.hidden = false;
}

function handleStringTest(event) {
  event.preventDefault();
  renderStringResult(document.querySelector("#stringInput").value, stringResult);
}

function handleDialogStringTest(event) {
  event.preventDefault();
  renderStringResult(document.querySelector("#stringDialogInput").value, stringDialogResult);
}

function attachCanvas(canvas, machineName) {
  const machine = () => machineName === "nfa" ? state.nfa : state.dfa;
  const view = () => state.view[machineName];
  canvas.addEventListener("mousedown", (event) => {
    hideMenu();
    const point = worldPoint(canvas, view(), event);
    const node = nodeAt(machine(), point);
    state.drag = {
      canvas,
      machineName,
      node,
      last: { x: event.clientX, y: event.clientY },
    };
    canvas.classList.add("dragging");
  });
  canvas.addEventListener("mousemove", (event) => {
    if (!state.drag || state.drag.canvas !== canvas) return;
    const dx = event.clientX - state.drag.last.x;
    const dy = event.clientY - state.drag.last.y;
    state.drag.last = { x: event.clientX, y: event.clientY };
    if (state.drag.node) {
      state.drag.node.x += dx / view().scale;
      state.drag.node.y += dy / view().scale;
    } else {
      view().x += dx;
      view().y += dy;
    }
    render();
  });
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    const scale = Math.min(2.4, Math.max(0.45, view().scale * (event.deltaY < 0 ? 1.08 : 0.92)));
    view().scale = scale;
    render();
  }, { passive: false });
}

window.addEventListener("mouseup", () => {
  nfaCanvas.classList.remove("dragging");
  dfaCanvas.classList.remove("dragging");
  state.drag = null;
});

nfaCanvas.addEventListener("contextmenu", menuForCanvas);
document.addEventListener("click", (event) => {
  if (!contextMenu.contains(event.target)) hideMenu();
});

document.querySelector("#helpBtn").addEventListener("click", () => document.querySelector("#helpDialog").showModal());
document.querySelector("#aboutBtn").addEventListener("click", () => document.querySelector("#aboutDialog").showModal());
document.querySelector("#stringTesterForm").addEventListener("submit", handleStringTest);
document.querySelector("#stringForm").addEventListener("submit", handleDialogStringTest);
document.querySelector("#cancelStringBtn").addEventListener("click", () => stringDialog.close());
document.querySelector("#clearNfaBtn").addEventListener("click", clearNfa);
document.querySelector("#clearDfaBtn").addEventListener("click", clearDfa);
document.querySelector("#defineBtn").addEventListener("click", openDefineDialog);
document.querySelector("#defineForm").addEventListener("submit", applyUserNfa);
document.querySelector("#loadExampleBtn").addEventListener("click", loadDefineExample);
document.querySelector("#cancelDefineBtn").addEventListener("click", () => defineDialog.close());
document.querySelector("#importBtn").addEventListener("click", () => fileInput.click());
document.querySelector("#exportBtn").addEventListener("click", exportNfa);
document.querySelector("#stepBtn").addEventListener("click", stepDfa);
document.querySelector("#backBtn").addEventListener("click", backDfa);
document.querySelector("#completeBtn").addEventListener("click", completeDfa);
document.querySelector("#animateBtn").addEventListener("click", animateDfa);
document.querySelector("#presetSelect").addEventListener("change", (event) => {
  if (!event.target.value) return;
  loadNfa(JSON.parse(JSON.stringify(presets[event.target.value])));
  event.target.value = "";
});
fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (!file) return;
  loadNfa(JSON.parse(await file.text()));
  fileInput.value = "";
});

attachCanvas(nfaCanvas, "nfa");
attachCanvas(dfaCanvas, "dfa");
window.addEventListener("resize", render);
loadNfa(JSON.parse(JSON.stringify(presets["ends-with-ab"])));
