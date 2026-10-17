// Classroom project ideas. General, widely used ideas: not attributed to any company or site, no links.
import type { Params, PresetId } from '../presets';

export const GRADES = ['K-2', '3-5', '6-8', '9-12'] as const;
export type Grade = (typeof GRADES)[number];
export const SUBJECTS = ['STEM', 'Math', 'Science', 'Art', 'Engineering', 'Geography'] as const;
export type Subject = (typeof SUBJECTS)[number];
export type Difficulty = 'Easy' | 'Medium' | 'Hard';

export interface Project {
  id: string;
  name: string;
  icon: string;
  description: string; // 1–2 sentences
  grades: Grade[];
  subjects: Subject[];
  printTime: string; // approximate, shown with an "approx." label
  difficulty: Difficulty;
  /** designer preset to load (absent = idea only) */
  preset?: { id: PresetId; params?: Params };
}

const ENTRIES: Project[] = [
  {
    id: 'name-keychain', name: 'Name keychain', icon: '🔑',
    description: 'A small tag with your name in raised block letters and a hole for a key ring. A great first print that shows how thin layers stack up.',
    grades: ['K-2', '3-5', '6-8'], subjects: ['STEM', 'Art'], printTime: '20–40 min', difficulty: 'Easy',
    preset: { id: 'keychain' },
  },
  {
    id: 'cookie-cutter', name: 'Cookie cutter', icon: '🍪',
    description: 'Turn a simple outline into a thin cutting wall with a comfy grip rim. Compare the perimeter of a circle, a star and a heart.',
    grades: ['K-2', '3-5'], subjects: ['Art', 'Math', 'STEM'], printTime: '30–60 min', difficulty: 'Easy',
    preset: { id: 'cookie', params: { shape: 'heart' } },
  },
  {
    id: 'phone-stand', name: 'Phone stand', icon: '📱',
    description: 'Design a wedge that holds a phone or tablet at a chosen angle. Test which lean angle is stable and easy to read.',
    grades: ['6-8', '9-12'], subjects: ['Engineering', 'Math', 'STEM'], printTime: '1.5–3 h', difficulty: 'Medium',
    preset: { id: 'stand' },
  },
  {
    id: 'gear-set', name: 'Gear set', icon: '⚙️',
    description: 'Print two or three gears with different tooth counts and mesh them on a board. Count turns to discover gear ratios.',
    grades: ['6-8', '9-12'], subjects: ['Engineering', 'Math', 'Science'], printTime: '1–2 h', difficulty: 'Medium',
    preset: { id: 'gear', params: { teeth: 20 } },
  },
  {
    id: 'pencil-holder', name: 'Pencil holder', icon: '✏️',
    description: 'A desk cup with a solid floor and thin walls, round or hexagonal. Estimate how much it holds from its size, then check.',
    grades: ['3-5', '6-8'], subjects: ['Art', 'Math', 'STEM'], printTime: '2–4 h', difficulty: 'Easy',
    preset: { id: 'pencil' },
  },
  {
    id: 'geometric-solids', name: 'Geometric solids set', icon: '🔷',
    description: 'Cubes, prisms, pyramids and cones you can hold and count faces, edges and corners on. Slice them to see their cross-sections.',
    grades: ['K-2', '3-5', '6-8'], subjects: ['Math', 'Art'], printTime: '20–45 min each', difficulty: 'Easy',
    preset: { id: 'solid', params: { shape: 'pyramid' } },
  },
  {
    id: 'fraction-tiles', name: 'Fraction tiles and ruler', icon: '📏',
    description: 'A set of bars split into halves, thirds, quarters and more, plus a matching ruler. Line them up to compare fractions.',
    grades: ['3-5'], subjects: ['Math'], printTime: '1–1.5 h', difficulty: 'Easy',
  },
  {
    id: 'dna-helix', name: 'DNA double helix', icon: '🧬',
    description: 'A twisted ladder model of DNA: two backbone strands joined by base-pair rungs on a stand. The strands overhang, so it is a good lesson in supports.',
    grades: ['6-8', '9-12'], subjects: ['Science', 'STEM'], printTime: '2–4 h', difficulty: 'Hard',
    preset: { id: 'helix' },
  },
  {
    id: 'topo-map', name: 'Topographic map', icon: '🏔️',
    description: 'Stack contour layers into a 3D landscape of a hill, valley or island. Each print layer becomes a height line on a map.',
    grades: ['6-8', '9-12'], subjects: ['Geography', 'Science', 'Math'], printTime: '2–5 h', difficulty: 'Hard',
    preset: { id: 'topo' },
  },
  {
    id: 'bridge-challenge', name: 'Bridge challenge', icon: '🌉',
    description: 'Design a truss bridge that spans a gap using as little plastic as possible. Load-test it with coins or weights.',
    grades: ['6-8', '9-12'], subjects: ['Engineering', 'Math', 'Science'], printTime: '2–3 h', difficulty: 'Hard',
  },
  {
    id: 'catapult', name: 'Mini catapult', icon: '🎯',
    description: 'Build a small launcher and measure how arm length and angle change the distance. A hands-on way to explore energy and motion.',
    grades: ['6-8', '9-12'], subjects: ['Science', 'Engineering', 'STEM'], printTime: '2–3 h', difficulty: 'Medium',
  },
  {
    id: 'balloon-car', name: 'Balloon-powered car', icon: '🎈',
    description: 'Print a chassis and wheels, then let a balloon push it across the room. Change wheel size and weight to make it go farther.',
    grades: ['3-5', '6-8'], subjects: ['Science', 'Engineering', 'STEM'], printTime: '2–3 h', difficulty: 'Medium',
  },
];

const STEM_PARTS: readonly Subject[] = ['Science', 'Math', 'Engineering'];

/** Any Science, Math or Engineering project is also STEM, shown first. */
function withStem(p: Project): Project {
  if (p.subjects.includes('STEM') || !p.subjects.some((s) => STEM_PARTS.includes(s))) return p;
  return { ...p, subjects: ['STEM', ...p.subjects] };
}

export const CATALOG: Project[] = ENTRIES.map(withStem);

export const PROJECT_IDS = CATALOG.map((p) => p.id);

export interface ProjectFilter { grade?: Grade | null; subject?: Subject | null; favourites?: string[] | null }

/** Grade/subject filters; when `favourites` is given, only those ids, in that order. */
export function filterProjects(list: readonly Project[], f: ProjectFilter): Project[] {
  let out = list.filter((p) => (!f.grade || p.grades.includes(f.grade)) && (!f.subject || p.subjects.includes(f.subject)));
  if (f.favourites) {
    const byId = new Map(out.map((p) => [p.id, p]));
    out = f.favourites.map((id) => byId.get(id)).filter((p): p is Project => !!p);
  }
  return out;
}
