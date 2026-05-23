export type PackStatus = 'required' | 'recommended' | 'optional';

export interface ContentPack {
  id: string;
  module: string;
  title: string;
  type: 'zim' | 'model' | 'database' | 'map' | 'skill';
  status: PackStatus;
  size: string;
  source: string;
  tooltip: string;
  resolver: string;
}

export interface SyllabusModule {
  id: string;
  subject: string;
  code: string;
  years: string;
  focus: string[];
  packIds: string[];
}

export interface PedagogyPrinciple {
  title: string;
  summary: string;
}

export const CONTENT_PACKS: ContentPack[] = [
  {
    id: 'teacher-skill',
    module: 'Teacher Agent',
    title: 'Kasai IGCSE Teacher Skill',
    type: 'skill',
    status: 'required',
    size: '< 1 MB',
    source: 'Everywear skills/igcse-teacher',
    resolver: 'Local repo skill install',
    tooltip: 'Installs the teaching behaviour: diagnostic questioning, scaffolding, retrieval practice, feedback, and exam coaching.',
  },
  {
    id: 'loom-db',
    module: 'Learning State',
    title: 'Loom SQLite learning store',
    type: 'database',
    status: 'required',
    size: '< 50 MB starter',
    source: '~/.everywear/data/loom/loom.db',
    resolver: 'loom-db migration phase',
    tooltip: 'Stores learner profile, selected syllabus, progress, retrieval schedule, misconceptions, notes, and teacher feedback.',
  },
  {
    id: 'kasai-model',
    module: 'Teacher Agent',
    title: 'Kasai local model slot',
    type: 'model',
    status: 'required',
    size: '3-22 GB depending tier',
    source: 'Everywear shared model registry',
    resolver: 'Kasai model manager',
    tooltip: 'Uses the existing Kasai model planner instead of downloading a separate tutor model when a suitable local model already exists.',
  },
  {
    id: 'wikipedia-schools',
    module: 'Reference Library',
    title: 'Wikipedia for Schools / compact encyclopedia',
    type: 'zim',
    status: 'recommended',
    size: 'Small to medium',
    source: 'Kiwix library',
    resolver: 'Query Kiwix library for English school encyclopedia ZIM archives',
    tooltip: 'A compact general reference base for offline explanations, vocabulary, historical context, and quick fact checks.',
  },
  {
    id: 'wikipedia-science',
    module: 'Science',
    title: 'Science reference ZIM',
    type: 'zim',
    status: 'recommended',
    size: 'Medium',
    source: 'Kiwix library',
    resolver: 'Query Kiwix library for science, biology, chemistry, and physics archives',
    tooltip: 'Supports Biology, Chemistry, and Physics lessons with offline concept pages and examples.',
  },
  {
    id: 'wikibooks-maths',
    module: 'Mathematics',
    title: 'Wikibooks mathematics ZIM',
    type: 'zim',
    status: 'recommended',
    size: 'Small to medium',
    source: 'Kiwix library',
    resolver: 'Query Kiwix library for English Wikibooks mathematics archives',
    tooltip: 'Adds step-by-step written explanations and practice-friendly worked examples for mathematics topics.',
  },
  {
    id: 'gutenberg-literature',
    module: 'English',
    title: 'Project Gutenberg literature ZIM',
    type: 'zim',
    status: 'optional',
    size: 'Medium to large',
    source: 'Kiwix library',
    resolver: 'Query Kiwix library for Project Gutenberg English archives',
    tooltip: 'Optional offline reading library for vocabulary, comprehension, style analysis, and extended English practice.',
  },
  {
    id: 'stackexchange-cs',
    module: 'Computer Science',
    title: 'Computing Q&A ZIM subset',
    type: 'zim',
    status: 'optional',
    size: 'Medium',
    source: 'Kiwix library',
    resolver: 'Query Kiwix library for programming and computer science Stack Exchange archives',
    tooltip: 'Optional support for programming explanations. Kasai should still align answers to the syllabus, not forum style.',
  },
  {
    id: 'openstreetmap-world',
    module: 'Geography',
    title: 'Offline map pack',
    type: 'map',
    status: 'optional',
    size: 'Region dependent',
    source: 'Everywear map/content registry',
    resolver: 'Select PMTiles by region',
    tooltip: 'Useful for Geography lessons, fieldwork, maps, scale, coordinates, and human/physical geography examples.',
  },
];

export const IGCSE_MODULES: SyllabusModule[] = [
  {
    id: 'maths-0580',
    subject: 'Mathematics',
    code: 'Cambridge IGCSE 0580',
    years: '2025-2027 now, 2028-2030 next cycle',
    focus: ['number', 'algebra', 'geometry', 'mensuration', 'statistics', 'probability', 'problem solving'],
    packIds: ['teacher-skill', 'loom-db', 'kasai-model', 'wikibooks-maths', 'wikipedia-schools'],
  },
  {
    id: 'biology-0610',
    subject: 'Biology',
    code: 'Cambridge IGCSE 0610',
    years: '2026-2028',
    focus: ['cells', 'classification', 'nutrition', 'transport', 'coordination', 'reproduction', 'ecology', 'practical skills'],
    packIds: ['teacher-skill', 'loom-db', 'kasai-model', 'wikipedia-science', 'wikipedia-schools'],
  },
  {
    id: 'chemistry-0620',
    subject: 'Chemistry',
    code: 'Cambridge IGCSE 0620',
    years: '2026-2028',
    focus: ['particles', 'bonding', 'stoichiometry', 'energetics', 'rates', 'acids and bases', 'organic chemistry', 'practical skills'],
    packIds: ['teacher-skill', 'loom-db', 'kasai-model', 'wikipedia-science', 'wikipedia-schools'],
  },
  {
    id: 'physics-0625',
    subject: 'Physics',
    code: 'Cambridge IGCSE 0625',
    years: '2026-2028',
    focus: ['motion', 'forces', 'energy', 'thermal physics', 'waves', 'electricity', 'magnetism', 'atomic physics', 'practical skills'],
    packIds: ['teacher-skill', 'loom-db', 'kasai-model', 'wikipedia-science', 'wikipedia-schools'],
  },
  {
    id: 'english',
    subject: 'English',
    code: 'Cambridge IGCSE English track',
    years: 'Confirm exact syllabus code per learner',
    focus: ['reading comprehension', 'summary', 'writer effect', 'directed writing', 'speaking', 'vocabulary growth'],
    packIds: ['teacher-skill', 'loom-db', 'kasai-model', 'gutenberg-literature', 'wikipedia-schools'],
  },
  {
    id: 'computer-science',
    subject: 'Computer Science',
    code: 'Cambridge IGCSE 0478',
    years: 'Confirm latest active syllabus before exam entry',
    focus: ['systems', 'data representation', 'networks', 'security', 'algorithms', 'programming', 'databases'],
    packIds: ['teacher-skill', 'loom-db', 'kasai-model', 'stackexchange-cs', 'wikipedia-schools'],
  },
];

export const PEDAGOGY: PedagogyPrinciple[] = [
  {
    title: 'Diagnostic first',
    summary: 'Start each topic by finding prior knowledge, misconceptions, language barriers, and confidence level.',
  },
  {
    title: 'Mastery learning',
    summary: 'Move from explain, worked example, guided practice, independent practice, then exam transfer only after evidence of readiness.',
  },
  {
    title: 'Retrieval and spacing',
    summary: 'Schedule low-stakes recall, mixed practice, and spaced review instead of rereading-only study.',
  },
  {
    title: 'Scaffolding',
    summary: 'Use hints, sentence frames, diagrams, and partial solutions, then fade support as the learner gains control.',
  },
  {
    title: 'Cognitive load',
    summary: 'Reduce unnecessary load, sequence examples carefully, and avoid overloading working memory during new concepts.',
  },
  {
    title: 'Universal design',
    summary: 'Offer multiple representations and response paths for EAL, dyslexia, anxiety, low vision, and different access needs.',
  },
  {
    title: 'Learning preferences, not boxes',
    summary: 'Use visual, verbal, procedural, conceptual, social, and reflective modes as flexible supports, never as fixed labels.',
  },
  {
    title: 'Formative feedback',
    summary: 'Give specific next actions, ask the learner to repair errors, and track recurring misconceptions.',
  },
  {
    title: 'Metacognition',
    summary: 'Teach planning, monitoring, checking, and exam reflection so the learner knows how to learn.',
  },
];
