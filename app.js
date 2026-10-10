'use strict';

/* ───────── Données ───────── */

const KEY = 'ma-journee.v1';
let state = { tasks: [], meetings: [] };

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state = Object.assign({ tasks: [], meetings: [] }, JSON.parse(raw));
  } catch (e) { /* stockage indisponible : on démarre à vide */ }
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (e) { toast('Impossible d\'enregistrer sur cet appareil.'); }
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ───────── Dates ───────── */

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayISO = () => iso(new Date());
const addDays = (isoDate, n) => { const d = fromISO(isoDate); d.setDate(d.getDate() + n); return iso(d); };
function fromISO(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
const toMin = (hhmm) => { if (!hhmm) return null; const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const fmtMin = (min) => `${Math.floor(min / 60)}\u00a0h\u00a0${pad(min % 60)}`;
const fmtTime = (hhmm) => (hhmm ? fmtMin(toMin(hhmm)) : '');
const longDate = (s) => fromISO(s).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

function fmtDuration(min) {
  const h = Math.floor(min / 60), m = min % 60;
  if (!h) return `${m}\u00a0min`;
  return m ? `${h}\u00a0h\u00a0${pad(m)}` : `${h}\u00a0h`;
}

const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

/* Les tâches non faites des jours passés sont reportées à aujourd'hui. */
function rollOver() {
  const t = todayISO();
  let changed = false;
  for (const task of state.tasks) {
    if (!task.done && task.date < t) { task.date = t; task.rolled = true; changed = true; }
  }
  if (changed) save();
}

/* ───────── Utilitaires d'affichage ───────── */

const $ = (sel) => document.querySelector(sel);

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) node.append(c);
  return node;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ───────── Briefing ───────── */

const meetingsOn = (date) =>
  state.meetings.filter((m) => m.date === date).sort((a, b) => (a.start || '').localeCompare(b.start || ''));

const sortTasks = (list) =>
  list.slice().sort((a, b) => (a.done - b.done) || (b.prio - a.prio) || (a.created || 0) - (b.created || 0));

/* Chevauchements entre réunions d'une même journée. */
function overlaps(list) {
  const ids = new Set();
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const aEnd = toMin(a.end) ?? toMin(a.start) + 60;
      if (toMin(b.start) < aEnd) { ids.add(a.id); ids.add(b.id); }
    }
  }
  return ids;
}

/* Créneaux libres d'au moins 30 min entre 8 h et 19 h. */
function freeSlots(list) {
  const slots = [];
  let cursor = 8 * 60;
  const endDay = 19 * 60;
  for (const m of list) {
    const s = toMin(m.start), e = toMin(m.end) ?? s + 60;
    if (s - cursor >= 30 && cursor < endDay) slots.push([cursor, Math.min(s, endDay)]);
    cursor = Math.max(cursor, e);
  }
  if (endDay - cursor >= 30) slots.push([cursor, endDay]);
  return slots;
}

function buildBriefing() {
  const t = todayISO();
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const meetings = meetingsOn(t);
  const tasks = state.tasks.filter((x) => x.date === t);
  const todo = tasks.filter((x) => !x.done);
  const prio = todo.filter((x) => x.prio);
  const upcoming = meetings.filter((m) => (toMin(m.end) ?? toMin(m.start) + 60) > nowMin);
  const next = upcoming[0];

  const h = now.getHours();
  const hello = h < 12 ? 'Bonjour' : h < 18 ? 'Bon après-midi' : 'Bonsoir';

  const parts = [];
  parts.push(meetings.length
    ? `Tu as ${plural(meetings.length, 'réunion', 'réunions')} aujourd'hui`
    : 'Aucune réunion aujourd\'hui');
  parts.push(todo.length
    ? `${plural(todo.length, 'tâche', 'tâches')} à faire${prio.length ? `, dont ${prio.length} prioritaire${prio.length > 1 ? 's' : ''}` : ''}`
    : 'aucune tâche en attente');
  let summary = parts.join(' et ') + '.';
  if (next && toMin(next.start) <= nowMin) summary += ` En ce moment : ${next.title}${next.end ? `, jusqu'à ${fmtTime(next.end)}` : ''}.`;
  else if (next) summary += ` Prochaine réunion à ${fmtTime(next.start)} : ${next.title}.`;
  else if (meetings.length) summary += ' Tes réunions du jour sont terminées.';

  // Texte lu à voix haute : plus détaillé.
  const speech = [`${hello}. Nous sommes le ${longDate(t)}.`, summary];
  for (const m of upcoming) {
    let s = `À ${fmtTime(m.start)}, ${m.title}`;
    if (m.place) s += `, à ${m.place}`;
    if (m.people) s += `, avec ${m.people}`;
    s += '.';
    if (m.goal) s += ` Objectif : ${m.goal}.`;
    if (m.prep) s += ` À préparer : ${m.prep}.`;
    speech.push(s);
  }
  if (prio.length) speech.push(`Tes priorités : ${prio.map((x) => x.text).join(', ')}.`);

  return { hello, summary, speech: speech.join(' '), meetings, nowMin };
}

/* ───────── Rendu : réunions ───────── */

function meetingCard(m, opts = {}) {
  const s = toMin(m.start), e = toMin(m.end);
  const when = m.end ? `${fmtTime(m.start)} – ${fmtTime(m.end)} (${fmtDuration(e - s)})` : fmtTime(m.start);
  const rows = [
    ['📍', m.place], ['👥', m.people], ['🎯', m.goal], ['📝', m.prep], ['💬', m.notes]
  ].filter(([, v]) => v);
  let cls = 'card meeting';
  if (opts.isToday) {
    const end = e ?? s + 60;
    if (end <= opts.nowMin) cls += ' past';
    else if (s <= opts.nowMin) cls += ' now';
  }
  return el('div', { class: cls, onclick: () => openMeeting(m) },
    el('div', { class: 'when' }, when, opts.isToday && cls.includes(' now') ? ' · en cours' : ''),
    el('div', { class: 'title' }, m.title),
    rows.length ? el('dl', {}, rows.map(([k, v]) => [el('dt', {}, k), el('dd', {}, v)])) : null,
    opts.conflict ? el('div', { class: 'warn' }, '⚠️ Chevauche une autre réunion') : null
  );
}

function renderToday() {
  const t = todayISO();
  const b = buildBriefing();
  $('#today-label').textContent = longDate(t);
  $('#greeting').textContent = `${b.hello} 👋`;
  $('#summary').textContent = b.summary;

  const box = $('#today-meetings');
  box.replaceChildren();
  const conflicts = overlaps(b.meetings);
  if (!b.meetings.length) box.append(el('div', { class: 'card muted' }, 'Rien de prévu. Journée libre côté réunions.'));
  for (const m of b.meetings) box.append(meetingCard(m, { isToday: true, nowMin: b.nowMin, conflict: conflicts.has(m.id) }));

  const slots = freeSlots(b.meetings);
  $('#free-slots').replaceChildren(
    b.meetings.length && slots.length
      ? el('p', { class: 'slots' }, '🕊️ Créneaux libres : ' + slots.map(([a, z]) => `${fmtMin(a)} – ${fmtMin(z)}`).join(' · '))
      : ''
  );

  const ul = $('#today-tasks');
  ul.replaceChildren(...sortTasks(state.tasks.filter((x) => x.date === t)).map(taskItem));
  if (!ul.children.length) ul.append(el('li', { class: 'muted' }, 'Aucune tâche pour aujourd\'hui.'));

  const tm = addDays(t, 1);
  const tMeet = meetingsOn(tm);
  const tTasks = state.tasks.filter((x) => x.date === tm && !x.done);
  const tomorrow = $('#tomorrow');
  tomorrow.replaceChildren();
  if (!tMeet.length && !tTasks.length) {
    tomorrow.append('Rien de prévu pour l\'instant.');
  } else {
    tomorrow.append(el('div', {}, `${plural(tMeet.length, 'réunion', 'réunions')} · ${plural(tTasks.length, 'tâche', 'tâches')}`));
    for (const m of tMeet) {
      tomorrow.append(el('div', {}, `${fmtTime(m.start)} — ${m.title}`, m.prep ? ` (📝 ${m.prep})` : ''));
    }
  }
}

function renderMeetings() {
  const box = $('#meeting-groups');
  box.replaceChildren();
  const t = todayISO();
  const future = state.meetings.filter((m) => m.date >= t)
    .sort((a, b) => (a.date + (a.start || '')).localeCompare(b.date + (b.start || '')));
  if (!future.length) {
    box.append(el('div', { class: 'card muted' }, 'Aucune réunion à venir. Ajoute-en une ou importe un fichier .ics depuis ton agenda.'));
    return;
  }
  let current = null;
  for (const m of future) {
    if (m.date !== current) {
      current = m.date;
      box.append(el('h2', {}, m.date === t ? 'Aujourd\'hui' : longDate(m.date)));
    }
    const conflicts = overlaps(meetingsOn(m.date));
    box.append(meetingCard(m, { conflict: conflicts.has(m.id) }));
  }
}

/* ───────── Rendu : tâches ───────── */

function taskItem(task) {
  const t = todayISO();
  const tag = task.rolled && task.date === t && !task.done ? 'reportée' : null;
  return el('li', { class: 'task' + (task.done ? ' done' : '') },
    el('input', {
      type: 'checkbox', checked: task.done, 'aria-label': 'Fait',
      onchange: (e) => { task.done = e.target.checked; task.doneAt = task.done ? Date.now() : null; save(); renderAll(); }
    }),
    el('span', { class: 'txt' }, task.prio ? '⭐ ' : '', task.text, tag ? el('span', { class: 'tag' }, tag) : null),
    el('button', {
      class: 'icon-btn', type: 'button', title: task.prio ? 'Retirer la priorité' : 'Rendre prioritaire',
      onclick: () => { task.prio = !task.prio; save(); renderAll(); }
    }, task.prio ? '☆' : '⭐'),
    !task.done ? el('button', {
      class: 'icon-btn', type: 'button', title: 'Reporter à demain',
      onclick: () => { task.date = addDays(task.date < t ? t : task.date, 1); task.rolled = false; save(); renderAll(); toast('Reportée au lendemain.'); }
    }, '➡️') : null,
    el('button', {
      class: 'icon-btn', type: 'button', title: 'Supprimer',
      onclick: () => { state.tasks = state.tasks.filter((x) => x !== task); save(); renderAll(); toast('Tâche supprimée.'); }
    }, '🗑️')
  );
}

function renderTasks() {
  const box = $('#task-groups');
  box.replaceChildren();
  const t = todayISO();
  const groups = [
    ['Aujourd\'hui', state.tasks.filter((x) => x.date === t && !x.done)],
    ['À venir', state.tasks.filter((x) => x.date > t && !x.done).sort((a, b) => a.date.localeCompare(b.date))],
    ['Terminées', state.tasks.filter((x) => x.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)).slice(0, 30)]
  ];
  for (const [label, list] of groups) {
    if (!list.length) continue;
    box.append(el('h2', {}, label));
    const ul = el('ul', { class: 'list' });
    let lastDate = null;
    for (const task of label === 'Aujourd\'hui' ? sortTasks(list) : list) {
      if (label === 'À venir' && task.date !== lastDate) {
        lastDate = task.date;
        ul.append(el('li', { class: 'muted' }, longDate(task.date)));
      }
      ul.append(taskItem(task));
    }
    box.append(ul);
  }
  if (!box.children.length) box.append(el('div', { class: 'card muted' }, 'Aucune tâche. Ta liste est vide.'));
}

function renderAll() { renderToday(); renderTasks(); renderMeetings(); }

/* ───────── Fiche réunion ───────── */

const dialog = $('#meeting-dialog');
const form = $('#meeting-form');
let editing = null;

function openMeeting(m) {
  editing = m || null;
  form.reset();
  $('#meeting-dialog-title').textContent = m ? 'Modifier la réunion' : 'Nouvelle réunion';
  $('#btn-delete-meeting').hidden = !m;
  const data = m || { date: todayISO() };
  for (const name of ['title', 'date', 'start', 'end', 'place', 'people', 'goal', 'prep', 'notes']) {
    form.elements[name].value = data[name] || '';
  }
  dialog.showModal();
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = form.elements;
  if (f.end.value && f.end.value <= f.start.value) { toast('L\'heure de fin doit suivre l\'heure de début.'); return; }
  const data = {};
  for (const name of ['title', 'date', 'start', 'end', 'place', 'people', 'goal', 'prep', 'notes']) data[name] = f[name].value.trim();
  if (editing) Object.assign(editing, data);
  else state.meetings.push({ id: uid(), ...data });
  save();
  dialog.close();
  renderAll();
  toast('Réunion enregistrée.');
});

$('#btn-cancel-meeting').addEventListener('click', () => dialog.close());
$('#btn-delete-meeting').addEventListener('click', () => {
  if (!editing || !confirm('Supprimer cette réunion ?')) return;
  state.meetings = state.meetings.filter((m) => m !== editing);
  save();
  dialog.close();
  renderAll();
  toast('Réunion supprimée.');
});
$('#btn-new-meeting').addEventListener('click', () => openMeeting(null));

/* ───────── Import .ics (agenda Google, Outlook…) ───────── */

function splitIcsLine(line) {
  // Le premier « : » hors guillemets sépare l'en-tête de la valeur.
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === ':' && !quoted) return [line.slice(0, i), line.slice(i + 1)];
  }
  return [line, ''];
}

const unescapeIcs = (s) => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim();

function parseIcsDate(value) {
  let m = value.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return { date: `${m[1]}-${m[2]}-${m[3]}`, time: null };
  m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})\d{2}(Z?)$/);
  if (!m) return null;
  const d = m[6]
    ? new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]))
    : new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5]);
  return { date: iso(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

function parseIcs(text) {
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const events = [];
  let ev = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { ev = { people: [] }; continue; }
    if (line === 'END:VEVENT') {
      if (ev && ev.start && ev.start.time && ev.status !== 'CANCELLED') events.push(ev);
      ev = null;
      continue;
    }
    if (!ev) continue;
    const [head, value] = splitIcsLine(line);
    const name = head.split(';')[0].toUpperCase();
    if (name === 'SUMMARY') ev.title = unescapeIcs(value);
    else if (name === 'LOCATION') ev.place = unescapeIcs(value);
    else if (name === 'DESCRIPTION') ev.notes = unescapeIcs(value).slice(0, 600);
    else if (name === 'DTSTART') ev.start = parseIcsDate(value);
    else if (name === 'DTEND') ev.end = parseIcsDate(value);
    else if (name === 'STATUS') ev.status = value.trim().toUpperCase();
    else if (name === 'ATTENDEE') {
      const cn = head.match(/CN=("?)([^";:]+)\1/i);
      ev.people.push(cn ? cn[2] : value.replace(/^mailto:/i, ''));
    }
  }
  return events.map((e) => ({
    title: e.title || 'Sans titre',
    date: e.start.date,
    start: e.start.time,
    end: e.end && e.end.date === e.start.date ? e.end.time : '',
    place: e.place || '',
    people: e.people.join(', '),
    goal: '',
    prep: '',
    notes: e.notes || ''
  }));
}

$('#ics-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const events = parseIcs(await file.text());
    const known = new Set(state.meetings.map((m) => `${m.date}|${m.start}|${m.title}`));
    let added = 0;
    for (const ev of events) {
      const k = `${ev.date}|${ev.start}|${ev.title}`;
      if (known.has(k) || ev.date < todayISO()) continue;
      known.add(k);
      state.meetings.push({ id: uid(), ...ev });
      added++;
    }
    save();
    renderAll();
    toast(added ? `${plural(added, 'réunion importée', 'réunions importées')}.` : 'Aucune nouvelle réunion à venir dans ce fichier.');
  } catch (err) {
    toast('Fichier .ics illisible.');
  }
});

/* ───────── Tâches : saisie ───────── */

function addTask(text, date, prio) {
  state.tasks.push({ id: uid(), text, date, prio, done: false, created: Date.now() });
  save();
  renderAll();
}

$('#quick-task').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#quick-task-text');
  const text = input.value.trim();
  if (!text) return;
  addTask(text, todayISO(), false);
  input.value = '';
});

$('#task-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('#task-text').value.trim();
  if (!text) return;
  addTask(text, $('#task-date').value || todayISO(), $('#task-prio').checked);
  $('#task-text').value = '';
  $('#task-prio').checked = false;
  toast('Tâche ajoutée.');
});

/* ───────── Briefing vocal ───────── */

$('#btn-speak').addEventListener('click', () => {
  if (!('speechSynthesis' in window)) { toast('La lecture vocale n\'est pas disponible ici.'); return; }
  if (speechSynthesis.speaking) { speechSynthesis.cancel(); return; }
  const u = new SpeechSynthesisUtterance(buildBriefing().speech);
  u.lang = 'fr-FR';
  const voice = speechSynthesis.getVoices().find((v) => v.lang && v.lang.startsWith('fr'));
  if (voice) u.voice = voice;
  speechSynthesis.speak(u);
});

/* ───────── Plus : sauvegarde et ménage ───────── */

$('#btn-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `ma-journee-${todayISO()}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('#backup-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.tasks) || !Array.isArray(data.meetings)) throw new Error('format');
    if (!confirm('Remplacer tes données actuelles par cette sauvegarde ?')) return;
    state = { tasks: data.tasks, meetings: data.meetings };
    save();
    rollOver();
    renderAll();
    toast('Sauvegarde restaurée.');
  } catch (err) {
    toast('Ce fichier n\'est pas une sauvegarde valide.');
  }
});

$('#btn-clean-meetings').addEventListener('click', () => {
  const t = todayISO();
  const n = state.meetings.filter((m) => m.date < t).length;
  if (!n) { toast('Aucune réunion passée.'); return; }
  if (!confirm(`Effacer ${plural(n, 'réunion passée', 'réunions passées')} ?`)) return;
  state.meetings = state.meetings.filter((m) => m.date >= t);
  save();
  renderAll();
});

$('#btn-clean-tasks').addEventListener('click', () => {
  const n = state.tasks.filter((x) => x.done).length;
  if (!n) { toast('Aucune tâche terminée.'); return; }
  if (!confirm(`Effacer ${plural(n, 'tâche terminée', 'tâches terminées')} ?`)) return;
  state.tasks = state.tasks.filter((x) => !x.done);
  save();
  renderAll();
});

/* ───────── Navigation ───────── */

document.querySelectorAll('.tabs button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${btn.dataset.view}`));
    window.scrollTo(0, 0);
  });
});

/* ───────── Installation et hors connexion ───────── */

let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  $('#btn-install').hidden = false;
});
$('#btn-install').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $('#btn-install').hidden = true;
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

/* ───────── Démarrage ───────── */

load();
rollOver();
$('#task-date').value = todayISO();
renderAll();

// Rafraîchit le briefing (réunion en cours, changement de jour) chaque minute et au retour dans l'appli.
let lastDay = todayISO();
function tick() {
  if (todayISO() !== lastDay) { lastDay = todayISO(); rollOver(); $('#task-date').value = lastDay; }
  renderAll();
}
setInterval(tick, 60 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
