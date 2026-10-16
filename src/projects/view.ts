// Projects panel: grade/subject filter chips, favourites tab, cards with star + "Load in designer".
import { CATALOG, GRADES, SUBJECTS, filterProjects, type Grade, type Project, type Subject } from './catalog';
import type { Favourites } from './favourites';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export class ProjectsView {
  grade: Grade | null = null;
  subject: Subject | null = null;
  favOnly = false;
  private lastFocus: HTMLElement | null = null;

  constructor(private root: HTMLElement, private favs: Favourites, private onLoad: (p: Project) => void) {
    root.querySelector('#pj-close')!.addEventListener('click', () => this.close());
    root.addEventListener('click', (e) => { if (e.target === root) this.close(); });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !root.hidden) this.close(); });
    this.render();
  }

  get isOpen() { return !this.root.hidden; }
  open() { this.lastFocus = document.activeElement as HTMLElement; this.root.hidden = false; this.render(); (this.root.querySelector('#pj-close') as HTMLElement).focus(); }
  close() { this.root.hidden = true; this.lastFocus?.focus?.(); }

  render() {
    const tabs = this.root.querySelector('#pj-tabs')!;
    tabs.innerHTML = `<button type="button" class="chip tab" aria-pressed="${!this.favOnly}" data-tab="all">All projects</button>`
      + `<button type="button" class="chip tab" aria-pressed="${this.favOnly}" data-tab="fav">★ My favourites <b>${this.favs.size}</b></button>`;
    tabs.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.onclick = () => { this.favOnly = b.dataset.tab === 'fav'; this.render(); });
    const chips = (el: Element, all: string, values: readonly string[], cur: string | null, set: (v: string | null) => void) => {
      el.innerHTML = [`<button type="button" class="chip" aria-pressed="${cur === null}" data-v="">${all}</button>`, ...values.map((v) => `<button type="button" class="chip" aria-pressed="${cur === v}" data-v="${v}">${v}</button>`)].join('');
      el.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.onclick = () => { set(b.dataset.v || null); this.render(); });
    };
    chips(this.root.querySelector('#pj-grades')!, 'All grades', GRADES, this.grade, (v) => (this.grade = v as Grade | null));
    chips(this.root.querySelector('#pj-subjects')!, 'All subjects', SUBJECTS, this.subject, (v) => (this.subject = v as Subject | null));
    const list = filterProjects(CATALOG, { grade: this.grade, subject: this.subject, favourites: this.favOnly ? this.favs.list() : null });
    const filt = [this.grade && `grades ${this.grade}`, this.subject].filter(Boolean).join(' · ');
    this.root.querySelector('#pj-count')!.textContent = `${list.length} project${list.length === 1 ? '' : 's'}${this.favOnly ? ' in your favourites' : ''}${filt ? ` · ${filt}` : ''}`;
    const el = this.root.querySelector('#pj-list')!;
    if (!list.length) {
      el.innerHTML = `<div class="pj-empty">${this.favOnly ? (this.favs.size ? 'None of your favourites match these filters.' : 'No favourites yet. Tap the ☆ on a project to save it here.') : 'No projects match these filters.'}</div>`;
      return;
    }
    el.innerHTML = list.map((p) => {
      const fav = this.favs.has(p.id);
      return `<article class="card" data-id="${p.id}">
        <div class="card-top"><span class="card-ico" aria-hidden="true">${p.icon}</span><h3>${esc(p.name)}</h3>
          <button type="button" class="star" aria-pressed="${fav}" aria-label="${fav ? 'Remove from' : 'Add to'} favourites: ${esc(p.name)}">${fav ? '★' : '☆'}</button></div>
        <p class="card-desc">${esc(p.description)}</p>
        <div class="meta">
          <span class="badge grade">Grades ${p.grades.join(', ')}</span>
          <span class="badge diff ${p.difficulty.toLowerCase()}">${p.difficulty}</span>
          <span class="badge time">⏱ approx. ${esc(p.printTime)}</span>
        </div>
        <div class="meta subj">${p.subjects.map((s) => `<span class="badge subj">${s}</span>`).join('')}</div>
        ${p.preset ? `<button type="button" class="btn primary load">Load in designer ›</button>` : `<span class="idea">💡 Idea only, no designer preset yet</span>`}
      </article>`;
    }).join('');
    el.querySelectorAll<HTMLElement>('.card').forEach((card) => {
      const p = CATALOG.find((x) => x.id === card.dataset.id)!;
      card.querySelector<HTMLButtonElement>('.star')!.onclick = () => { this.favs.toggle(p.id); this.render(); this.root.querySelector<HTMLElement>(`.card[data-id="${p.id}"] .star`)?.focus(); };
      const load = card.querySelector<HTMLButtonElement>('.load');
      if (load) load.onclick = () => { this.close(); this.onLoad(p); };
    });
  }
}
