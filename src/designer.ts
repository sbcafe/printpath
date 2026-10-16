// Renders a preset's controls (sliders, toggles, choices, text) into the Design panel.
import type { Preset, Params } from './presets';

const fmt = (v: number, step: number) => { const d = (String(step).split('.')[1] ?? '').length; return d ? v.toFixed(d).replace(/0+$/, '').replace(/\.$/, '') : String(Math.round(v)); };

export class DesignerControls {
  private outputs = new Map<string, HTMLOutputElement>();
  private inputs = new Map<string, HTMLInputElement>();
  private segs = new Map<string, HTMLButtonElement[]>();

  constructor(root: HTMLElement, private preset: Preset, params: Params, onChange: (key: string, value: string | number | boolean) => void) {
    root.innerHTML = '';
    const toggles = document.createElement('div');
    toggles.className = 'toggles';
    for (const c of preset.controls) {
      const id = `d-${c.key}`;
      if (c.kind === 'slider') {
        const row = div('ctl');
        row.innerHTML = `<label for="${id}">${c.label}</label><input id="${id}" type="range" min="${c.min}" max="${c.max}" step="${c.step}" /><output for="${id}"></output>`;
        const inp = row.querySelector('input')!, out = row.querySelector('output')!;
        inp.addEventListener('input', () => { this.setOut(c.key); onChange(c.key, Number(inp.value)); });
        this.inputs.set(c.key, inp); this.outputs.set(c.key, out);
        root.appendChild(row);
      } else if (c.kind === 'text') {
        const row = div('ctl text');
        row.innerHTML = `<label for="${id}">${c.label}</label><input id="${id}" type="text" maxlength="${c.maxLength}" autocomplete="off" autocapitalize="characters" spellcheck="false" />`;
        const inp = row.querySelector('input')!;
        inp.addEventListener('input', () => onChange(c.key, inp.value));
        this.inputs.set(c.key, inp);
        root.appendChild(row);
      } else if (c.kind === 'choice') {
        const row = div('seg choice');
        row.setAttribute('role', 'group');
        row.setAttribute('aria-label', c.label);
        row.innerHTML = `<span>${c.label}</span>`;
        const btns = c.options.map(([v, label]) => {
          const b = document.createElement('button');
          b.type = 'button'; b.textContent = label; b.dataset.value = v;
          b.addEventListener('click', () => onChange(c.key, v));
          row.appendChild(b);
          return b;
        });
        this.segs.set(c.key, btns);
        root.appendChild(row);
      } else {
        const lab = document.createElement('label');
        lab.className = 'tog';
        lab.innerHTML = `<input id="${id}" type="checkbox" /><span>${c.label}</span>`;
        const inp = lab.querySelector('input')!;
        inp.addEventListener('change', () => onChange(c.key, inp.checked));
        this.inputs.set(c.key, inp);
        toggles.appendChild(lab);
      }
    }
    if (toggles.children.length) root.appendChild(toggles);
    this.sync(params);
  }

  private setOut(key: string) {
    const c = this.preset.controls.find((x) => x.key === key);
    const inp = this.inputs.get(key), out = this.outputs.get(key);
    if (!c || c.kind !== 'slider' || !inp || !out) return;
    out.textContent = `${fmt(Number(inp.value), c.step)}${c.unit ? (c.unit === '°' ? '°' : ` ${c.unit}`) : ''}`;
  }

  /** Reflect (possibly clamped) params and dynamic limits back into the UI. */
  sync(p: Params) {
    const lim = this.preset.limits?.(p) ?? {};
    for (const c of this.preset.controls) {
      const inp = this.inputs.get(c.key);
      if (c.kind === 'slider' && inp) {
        inp.max = String(lim[c.key] ?? c.max);
        if (document.activeElement !== inp || Number(inp.value) !== Number(p[c.key])) inp.value = String(p[c.key]);
        this.setOut(c.key);
      } else if (c.kind === 'toggle' && inp) inp.checked = Boolean(p[c.key]);
      else if (c.kind === 'text' && inp && document.activeElement !== inp) inp.value = String(p[c.key] ?? '');
      else if (c.kind === 'choice') this.segs.get(c.key)?.forEach((b) => { const on = b.dataset.value === p[c.key]; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    }
  }
}

function div(cls: string) { const d = document.createElement('div'); d.className = cls; return d; }
