// Tooltips: the browser's plain title boxes replaced by small glass labels,
// shown after a short pause, with the keyboard shortcut as a key chip when
// the text ends in one, e.g. "Kapat (Esc)". Mouse only; touch keeps nothing.
import { h } from './dom.js?v=352a97af6c';

let tip = null;
let timer = 0;
let current = null;

const KEYISH = /^(?:[A-Za-zÇĞİÖŞÜçğıöşü]{1,6}\+)*(?:[A-Za-z0-9]|Esc|Enter|Space|Delete|Tab|[←→↑↓]|Ctrl|Shift|Alt)$/;

function hide() {
  clearTimeout(timer);
  timer = 0;
  current = null;
  tip?.classList.remove('on');
}

function show(el) {
  if (!el.isConnected || current !== el) return;
  const text = el.dataset.tip;
  const m = /\s*\(([^()]{1,18})\)\s*$/.exec(text);
  const keys = m && m[1].split(/\s*(?:,|\/|ya da)\s*/).every((k) => KEYISH.test(k.trim())) ? m[1] : null;
  tip.replaceChildren(h('span', {}, keys ? text.slice(0, m.index) : text),
    ...(keys ? keys.split(/\s*(?:,|\/|ya da)\s*/).map((k) => h('kbd', {}, k.trim())) : []));
  tip.classList.add('on');
  const r = el.getBoundingClientRect();
  const w = tip.offsetWidth, ht = tip.offsetHeight;
  let top = r.bottom + 8;
  if (top + ht > innerHeight - 6) top = r.top - ht - 8;
  const left = Math.max(6, Math.min(innerWidth - w - 6, r.left + r.width / 2 - w / 2));
  tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
}

export function wireTooltips() {
  if (!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) return;
  tip = h('div.tip', { role: 'tooltip' });
  document.body.append(tip);
  document.addEventListener('pointerover', (e) => {
    const el = e.target instanceof Element ? e.target.closest('[title], [data-tip]') : null;
    if (el === current) return;
    hide();
    if (!el) return;
    const title = el.getAttribute('title');
    if (title != null) {
      el.dataset.tip = title;
      el.removeAttribute('title');
      // the title was the only name an icon button had
      if (!el.getAttribute('aria-label') && !el.textContent.trim()) el.setAttribute('aria-label', title);
    }
    if (!el.dataset.tip) return;
    current = el;
    timer = setTimeout(() => show(el), tip.classList.contains('on') ? 60 : 450);
  }, { passive: true });
  for (const ev of ['pointerdown', 'wheel', 'keydown']) document.addEventListener(ev, hide, { capture: true, passive: true });
  window.addEventListener('blur', hide);
  window.addEventListener('scroll', hide, { capture: true, passive: true });
}
