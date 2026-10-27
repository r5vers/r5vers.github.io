// Command palette (Ctrl+K, "/", or start typing on the chart): one search box
// for symbols, timeframes, screens and actions. Arrow keys move, Enter runs.
import { h, icon } from './dom.js?v=1039d95bd6';

let open = null;

// Turkish-aware folding so "ozel" finds "Özel" and "i" finds "İ"
const fold = (s) => String(s || '').toLocaleLowerCase('tr-TR')
  .replace(/\u0307/g, '').replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c');

function score(item, q) {
  if (!q) return item.rank ?? 1;
  const label = fold(item.label), words = fold(`${item.label} ${item.sub || ''} ${item.keys || ''} ${item.group || ''}`);
  if (label === q) return 100;
  if (label.startsWith(q)) return 80 - label.length / 100;
  if (label.split(/[\s/·-]+/).some((w) => w.startsWith(q))) return 60;
  if (words.includes(q)) return 40;
  // every typed letter in order (e.g. "eurj" -> "EURJPY")
  let i = 0;
  for (const c of label) if (c === q[i]) i++;
  return i === q.length ? 20 : 0;
}

/** `items()` returns [{ group, label, sub?, icon?, kbd?, keys?, run }]. */
export function openPalette(items, { initial = '', placeholder = 'Sembol, zaman dilimi ya da komut ara…' } = {}) {
  if (open) { open.input.value = initial || open.input.value; open.refresh(); open.input.focus(); return; }
  const all = items();
  const input = h('input.palette-input', { type: 'text', placeholder, value: initial, autocomplete: 'off', spellcheck: false, 'aria-label': 'Ara' });
  const list = h('div.palette-list', { role: 'listbox' });
  const box = h('div.palette.glass-pop', { role: 'dialog', 'aria-label': 'Komut paleti' },
    h('div.palette-head', {}, icon('search', 18), input, h('kbd', {}, 'Esc')),
    list,
    h('div.palette-foot', {}, h('span', {}, h('kbd', {}, '↑'), h('kbd', {}, '↓'), ' seç'), h('span', {}, h('kbd', {}, 'Enter'), ' aç'), h('span', {}, h('kbd', {}, 'Ctrl'), h('kbd', {}, 'K'), ' her yerden')));
  const back = h('div.palette-back', { onmousedown: (e) => { if (e.target === back) close(); } }, box);
  let shown = [];
  let at = 0;
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey, true); open = null; };
  const run = (item) => { if (!item) return; close(); setTimeout(() => item.run(), 0); };
  const paint = () => {
    list.replaceChildren();
    if (!shown.length) { list.append(h('div.palette-empty', {}, 'Sonuç yok')); return; }
    let group = null;
    shown.forEach((it, i) => {
      if (it.group !== group) { group = it.group; list.append(h('div.palette-group', {}, group)); }
      list.append(h(`button.palette-item${i === at ? '.on' : ''}`, {
        type: 'button', role: 'option', 'aria-selected': i === at ? 'true' : 'false',
        onmousemove: () => { if (at !== i) { at = i; paint(); } },
        onclick: () => run(it),
      }, h('span.pi-ic', {}, icon(it.icon || 'arrow', 16)), h('span.pi-t', {}, it.label), it.sub ? h('span.pi-s', {}, it.sub) : null,
      it.kbd ? h('span.pi-k', {}, ...it.kbd.split('+').map((k) => h('kbd', {}, k))) : null));
    });
    list.querySelector('.palette-item.on')?.scrollIntoView({ block: 'nearest' });
  };
  const refresh = () => {
    const q = fold(input.value.trim());
    const scored = all.map((it, i) => ({ it, s: score(it, q), i })).filter((x) => x.s > 0);
    // with a query the best matches lead; without one the groups keep their order
    if (q) scored.sort((a, b) => b.s - a.s || a.i - b.i);
    shown = scored.slice(0, 60).map((x) => x.it);
    if (q) {
      // keep groups together after ranking, in the order their best item came
      const order = [...new Set(shown.map((x) => x.group))];
      shown.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
    }
    at = 0;
    paint();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); at = Math.min(shown.length - 1, at + 1); paint(); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); at = Math.max(0, at - 1); paint(); return; }
    if (e.key === 'Enter') { e.preventDefault(); run(shown[at]); }
  };
  input.addEventListener('input', refresh);
  document.addEventListener('keydown', onKey, true);
  document.body.append(back);
  open = { input, refresh };
  refresh();
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

/** Ctrl/Cmd+K and "/" anywhere; `typeToSearch` also opens it on a plain letter. */
export function wirePalette(items, { typeToSearch = false } = {}) {
  window.addEventListener('keydown', (e) => {
    if (open) return;
    const tag = (e.target.tagName || '').toLowerCase();
    const editing = ['input', 'textarea', 'select'].includes(tag) || e.target.isContentEditable;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(items); return; }
    if (editing || document.querySelector('.modal-back')) return;
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); openPalette(items); return; }
    if (typeToSearch && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && /^[a-zA-Z0-9]$/.test(e.key)) {
      e.preventDefault();
      openPalette(items, { initial: e.key });
    }
  });
}
