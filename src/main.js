import { levels } from './levels.js';
import { DivePhysics } from './physics.js';
import { DiveScene } from './scene.js';
import { clamp } from './pose.js';

const $ = id => document.getElementById(id);
const stage = $('stage');
const hud = $('hud');
const defaults = {
  ankleLock: 7200, jerkThr: 2.5, jerkRange: 3, jerkDecay: 6, kneeComp: 1,
  balance: .9, startX: 1.1, footHold: 1150, spin: 6,
  pushForward: 5, pushBackward: 1.5, tuckAmount: 100,
  kp: 20, kneeTorque: 1800, hipTorque: 1500, kneeV: 16, hipV: 14,
  ankleV: 8, shV: 12, gravity: 10, waterDamp: 2.5,
};
const tuning = [
  ['Старт'],
  ['startX', 'Позиция на скале (м, край = 1.4)', -8, 1.1, .05],
  ['Стойка на земле'],
  ['ankleLock', 'Фиксация голеностопа (Н·м)', 0, 15000, 100],
  ['kneeComp', 'Компенсация наклона коленями', 0, 2, .05],
  ['balance', 'Баланс центра масс (таз)', 0, 8, .1],
  ['footHold', 'Удержание стопы (Н·м)', 0, 1200, 10],
  ['spin', 'Сила сальто при толчке (рад/с)', 0, 20, .5],
  ['pushForward', 'Горизонтальный толчок вперёд (м/с)', 0, 10, .1],
  ['pushBackward', 'Горизонтальный толчок назад (м/с)', 0, 10, .1],
  ['tuckAmount', 'Степень группировки в полёте (%)', 0, 150, 1],
  ['jerkThr', 'Порог рывка мыши', 0, 10, .1],
  ['jerkRange', 'Ширина перехода рывка', .5, 10, .1],
  ['jerkDecay', 'Затухание рывка (1/с)', 1, 30, .5],
  ['Моторы'],
  ['kp', 'Жёсткость реакции (kp)', 2, 60, 1],
  ['kneeTorque', 'Момент колен', 200, 6000, 50],
  ['hipTorque', 'Момент таза', 200, 6000, 50],
  ['kneeV', 'Скорость колен (рад/с)', 2, 40, .5],
  ['hipV', 'Скорость таза (рад/с)', 2, 40, .5],
  ['ankleV', 'Скорость голеностопа', 1, 30, .5],
  ['shV', 'Скорость плеч', 1, 40, .5],
  ['Мир'],
  ['gravity', 'Гравитация', 2, 25, .5],
  ['waterDamp', 'Сопротивление воды', 0, 10, .1],
];

function readStored(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}

function store(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { /* Storage is optional. */ }
}

const savedLevel = readStored('diver_lvl', 0);
let levelIndex = Number.isInteger(savedLevel) ? clamp(savedLevel, 0, levels.length - 1) : 0;
const savedBests = readStored('diver_best', {});
const bests = {};
levels.forEach((_, index) => {
  const value = savedBests?.[index];
  if (Number.isFinite(value)) bests[index] = clamp(value, 0, 10);
});
const settings = { ...defaults };
const savedSettings = readStored('diver_tune', {});
// Carry the former shared push setting into the two directional controls.
if (Number.isFinite(savedSettings?.push)) {
  if (!Number.isFinite(savedSettings?.pushForward)) settings.pushForward = clamp(savedSettings.push * 1.2, 0, 10);
  if (!Number.isFinite(savedSettings?.pushBackward)) settings.pushBackward = clamp(savedSettings.push, 0, 10);
}
for (const [key, , min, max] of tuning) {
  if (Number.isFinite(savedSettings?.[key])) settings[key] = clamp(savedSettings[key], min, max);
}

const scene = new DiveScene(stage);
const physics = new DivePhysics(settings, finish);
let accumulator = 0;

function showBest() {
  $('best').textContent = 'Best: ' + (bests[levelIndex] !== undefined ? bests[levelIndex].toFixed(1) : '—');
}

function resetDive() {
  accumulator = 0;
  physics.reset(levels[levelIndex]);
  scene.loadLevel(levels[levelIndex], physics);
  $('res').replaceChildren();
  $('lvl').textContent = `Dive ${levelIndex + 1}-${levels.length}`;
  $('prev').disabled = levelIndex === 0;
  $('next').disabled = levelIndex === levels.length - 1;
  showBest();
}

function finish({ score, info }) {
  const number = document.createElement('b');
  number.textContent = score.toFixed(1);
  const details = document.createElement('span');
  details.textContent = score === 0 && !info ? 'Разбился о скалу' : info;
  $('res').replaceChildren(number, details);
  if (bests[levelIndex] === undefined || score > bests[levelIndex]) {
    bests[levelIndex] = score;
    showBest();
    store('diver_best', bests);
  }
}

// Live physics controls are saved and applied without restarting the dive.
const sliders = {};
hud.innerHTML = '<h4>НАСТРОЙКИ ФИЗИКИ</h4>';
for (const definition of tuning) {
  if (definition.length === 1) {
    const heading = document.createElement('h4');
    heading.style.marginTop = '12px';
    heading.textContent = definition[0].toUpperCase();
    hud.appendChild(heading);
    continue;
  }
  const [key, label, min, max, step] = definition;
  const row = document.createElement('div');
  row.className = 'row';
  const caption = document.createElement('div');
  caption.append(label);
  const value = document.createElement('span');
  caption.appendChild(value);
  const input = document.createElement('input');
  input.type = 'range';
  input.min = min;
  input.max = max;
  input.step = step;
  input.setAttribute('aria-label', label);
  const show = () => { input.value = settings[key]; value.textContent = settings[key]; };
  input.addEventListener('input', () => {
    settings[key] = Number(input.value);
    value.textContent = settings[key];
    if (key === 'startX') resetDive();
    store('diver_tune', settings);
  });
  sliders[key] = show;
  show();
  row.append(caption, input);
  hud.appendChild(row);
}
const buttons = document.createElement('div');
buttons.className = 'btns';
buttons.innerHTML = '<button id="kreset">По умолчанию</button><button id="kcopy">Копировать</button>';
hud.appendChild(buttons);
const readout = document.createElement('div');
readout.id = 'ro';
hud.appendChild(readout);

$('kreset').addEventListener('click', () => {
  Object.assign(settings, defaults);
  Object.values(sliders).forEach(show => show());
  resetDive();
  try { localStorage.removeItem('diver_tune'); } catch { /* Storage is optional. */ }
});
let clipboardFallback = '';
$('kcopy').addEventListener('click', async () => {
  const text = JSON.stringify(settings);
  try {
    await navigator.clipboard.writeText(text);
    clipboardFallback = '';
    $('kcopy').textContent = 'Скопировано';
    setTimeout(() => { $('kcopy').textContent = 'Копировать'; }, 1200);
  } catch {
    clipboardFallback = text;
  }
});
['pointermove', 'pointerdown', 'pointerup'].forEach(name => {
  hud.addEventListener(name, event => event.stopPropagation());
});
function toggleHud() {
  const hidden = hud.classList.toggle('off');
  $('hudbtn').setAttribute('aria-expanded', String(!hidden));
}
$('hudbtn').setAttribute('aria-expanded', 'true');
$('hudbtn').setAttribute('aria-controls', 'hud');
$('hudbtn').addEventListener('click', toggleHud);

function pointer(event) {
  if (event.target.closest('button')) return;
  physics.setPointer(event.clientX, event.clientY, stage.getBoundingClientRect());
}
stage.addEventListener('pointermove', pointer);
stage.addEventListener('pointerdown', event => {
  if (event.target.closest('button')) return;
  pointer(event);
  resetDive();
});
function go(direction) {
  const index = levelIndex + direction;
  if (index < 0 || index >= levels.length) return;
  levelIndex = index;
  store('diver_lvl', levelIndex);
  resetDive();
}
$('prev').addEventListener('click', () => go(-1));
$('next').addEventListener('click', () => go(1));
$('reset').addEventListener('click', resetDive);
window.addEventListener('keydown', event => {
  if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.code === 'KeyH') toggleHud();
  if (event.code === 'KeyR') resetDive();
  if (event.key === 'ArrowRight') { event.preventDefault(); go(1); }
  if (event.key === 'ArrowLeft') { event.preventDefault(); go(-1); }
});

let last = performance.now();
function frame(now) {
  const delta = Math.min(.05, (now - last) / 1000);
  last = now;
  accumulator += delta;
  const dt = 1 / 120;
  while (accumulator >= dt) {
    physics.step(dt);
    accumulator -= dt;
  }
  scene.render();
  readout.textContent = clipboardFallback || `рывок: ${physics.jerk.toFixed(1)} · фиксация: ${Math.round(physics.lockStrength * 100)}% · земля: ${physics.footContacts > 0 ? 'да' : 'нет'}`;
  requestAnimationFrame(frame);
}

resetDive();
requestAnimationFrame(frame);
