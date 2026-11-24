// SCORM data model: which cmi.* elements exist, whether they can be read
// and written, and which values are valid. Per the ADL SCORM 1.2 and SCORM 2004 4th Edition specifications.

import { isTime12, isTimestamp, parseDuration, parseTimespan12 } from './time';

export type ApiVersion = '1.2' | '2004';

/** Result of checking a value: null — all good */
export type CheckFail = 'type' | 'range' | null;
type Check = (v: string) => CheckFail;

export interface ElementDef {
  re: RegExp;
  access: 'r' | 'w' | 'rw';
  check?: Check;
  /** Value of the _children keyword */
  children?: string;
  /** The _count element of an array */
  count?: boolean;
  /** Soft length limit: the value is accepted, but a warning appears in the log */
  limit?: number;
}

// --- value checks ---

const vocab =
  (...words: string[]): Check =>
  (v) =>
    words.includes(v) ? null : 'type';

const NUMBER = /^-?\d+(\.\d+)?$/;

const real =
  (min?: number, max?: number): Check =>
  (v) => {
    if (!NUMBER.test(v.trim())) return 'type';
    const n = Number(v);
    if ((min !== undefined && n < min) || (max !== undefined && n > max)) return 'range';
    return null;
  };

const decimalOrBlank: Check = (v) => (v === '' ? null : real()(v));

const int =
  (min: number, max: number): Check =>
  (v) => {
    if (!/^-?\d+$/.test(v)) return 'type';
    const n = Number(v);
    return n < min || n > max ? 'range' : null;
  };

const vocabOrReal =
  (...words: string[]): Check =>
  (v) =>
    words.includes(v) || NUMBER.test(v) ? null : 'type';

const timespan12: Check = (v) => (parseTimespan12(v) === null ? 'type' : null);
const time12: Check = (v) => (isTime12(v) ? null : 'type');
const duration: Check = (v) => (parseDuration(v) === null ? 'type' : null);
const timestamp: Check = (v) => (isTimestamp(v) ? null : 'type');
const navRequest: Check = (v) =>
  /^(continue|previous|exit|exitAll|abandon|abandonAll|suspendAll|_none_)$/.test(v) ||
  /^\{target=[^}]+\}(choice|jump)$/.test(v)
    ? null
    : 'type';

/** "cmi.interactions.n.id" → a regular expression where n is the array element number */
function pattern(p: string): RegExp {
  const body = p
    .split('.')
    .map((seg) => (seg === 'n' ? '(\\d+)' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('\\.');
  return new RegExp(`^${body}$`);
}

type Row = [string, ElementDef['access'], Omit<ElementDef, 're' | 'access'>?];

const build = (rows: Row[]): ElementDef[] => rows.map(([p, access, extra]) => ({ re: pattern(p), access, ...extra }));

// --- SCORM 1.2 ---

const STATUS_12 = ['passed', 'completed', 'failed', 'incomplete', 'browsed', 'not attempted'];

export const MODEL_12: ElementDef[] = build([
  ['cmi.core._children', 'r', { children: 'student_id,student_name,lesson_location,credit,lesson_status,entry,score,total_time,lesson_mode,exit,session_time' }],
  ['cmi.core.student_id', 'r'],
  ['cmi.core.student_name', 'r'],
  ['cmi.core.lesson_location', 'rw', { limit: 255 }],
  ['cmi.core.credit', 'r'],
  ['cmi.core.lesson_status', 'rw', { check: vocab(...STATUS_12) }],
  ['cmi.core.entry', 'r'],
  ['cmi.core.score._children', 'r', { children: 'raw,min,max' }],
  ['cmi.core.score.raw', 'rw', { check: decimalOrBlank }],
  ['cmi.core.score.min', 'rw', { check: decimalOrBlank }],
  ['cmi.core.score.max', 'rw', { check: decimalOrBlank }],
  ['cmi.core.total_time', 'r'],
  ['cmi.core.lesson_mode', 'r'],
  ['cmi.core.exit', 'w', { check: vocab('time-out', 'suspend', 'logout', '') }],
  ['cmi.core.session_time', 'w', { check: timespan12 }],
  ['cmi.suspend_data', 'rw', { limit: 4096 }],
  ['cmi.launch_data', 'r'],
  ['cmi.comments', 'rw', { limit: 4096 }],
  ['cmi.comments_from_lms', 'r'],
  ['cmi.objectives._children', 'r', { children: 'id,score,status' }],
  ['cmi.objectives._count', 'r', { count: true }],
  ['cmi.objectives.n.id', 'rw', { limit: 255 }],
  ['cmi.objectives.n.score._children', 'r', { children: 'raw,min,max' }],
  ['cmi.objectives.n.score.raw', 'rw', { check: decimalOrBlank }],
  ['cmi.objectives.n.score.min', 'rw', { check: decimalOrBlank }],
  ['cmi.objectives.n.score.max', 'rw', { check: decimalOrBlank }],
  ['cmi.objectives.n.status', 'rw', { check: vocab(...STATUS_12) }],
  ['cmi.student_data._children', 'r', { children: 'mastery_score,max_time_allowed,time_limit_action' }],
  ['cmi.student_data.mastery_score', 'r'],
  ['cmi.student_data.max_time_allowed', 'r'],
  ['cmi.student_data.time_limit_action', 'r'],
  ['cmi.student_preference._children', 'r', { children: 'audio,language,speed,text' }],
  ['cmi.student_preference.audio', 'rw', { check: int(-1, 100) }],
  ['cmi.student_preference.language', 'rw', { limit: 255 }],
  ['cmi.student_preference.speed', 'rw', { check: int(-100, 100) }],
  ['cmi.student_preference.text', 'rw', { check: int(-1, 1) }],
  ['cmi.interactions._children', 'r', { children: 'id,objectives,time,type,correct_responses,weighting,student_response,result,latency' }],
  ['cmi.interactions._count', 'r', { count: true }],
  ['cmi.interactions.n.id', 'w', { limit: 255 }],
  ['cmi.interactions.n.objectives._count', 'r', { count: true }],
  ['cmi.interactions.n.objectives.n.id', 'w'],
  ['cmi.interactions.n.time', 'w', { check: time12 }],
  ['cmi.interactions.n.type', 'w', { check: vocab('true-false', 'choice', 'fill-in', 'matching', 'performance', 'sequencing', 'likert', 'numeric') }],
  ['cmi.interactions.n.correct_responses._count', 'r', { count: true }],
  ['cmi.interactions.n.correct_responses.n.pattern', 'w'],
  ['cmi.interactions.n.weighting', 'w', { check: real() }],
  ['cmi.interactions.n.student_response', 'w'],
  ['cmi.interactions.n.result', 'w', { check: vocabOrReal('correct', 'wrong', 'unanticipated', 'neutral') }],
  ['cmi.interactions.n.latency', 'w', { check: timespan12 }],
]);

// --- SCORM 2004 ---

const COMPLETION = ['completed', 'incomplete', 'not attempted', 'unknown'];
const SUCCESS = ['passed', 'failed', 'unknown'];

export const MODEL_2004: ElementDef[] = [
  ...build([
    ['cmi._version', 'r'],
    ['cmi.comments_from_learner._children', 'r', { children: 'comment,location,timestamp' }],
    ['cmi.comments_from_learner._count', 'r', { count: true }],
    ['cmi.comments_from_learner.n.comment', 'rw', { limit: 4000 }],
    ['cmi.comments_from_learner.n.location', 'rw', { limit: 250 }],
    ['cmi.comments_from_learner.n.timestamp', 'rw', { check: timestamp }],
    ['cmi.comments_from_lms._children', 'r', { children: 'comment,location,timestamp' }],
    ['cmi.comments_from_lms._count', 'r', { count: true }],
    ['cmi.comments_from_lms.n.comment', 'r'],
    ['cmi.comments_from_lms.n.location', 'r'],
    ['cmi.comments_from_lms.n.timestamp', 'r'],
    ['cmi.completion_status', 'rw', { check: vocab(...COMPLETION) }],
    ['cmi.completion_threshold', 'r'],
    ['cmi.credit', 'r'],
    ['cmi.entry', 'r'],
    ['cmi.exit', 'w', { check: vocab('time-out', 'suspend', 'logout', 'normal', '') }],
    ['cmi.interactions._children', 'r', { children: 'id,type,objectives,timestamp,correct_responses,weighting,learner_response,result,latency,description' }],
    ['cmi.interactions._count', 'r', { count: true }],
    ['cmi.interactions.n.id', 'rw', { limit: 4000 }],
    ['cmi.interactions.n.type', 'rw', { check: vocab('true-false', 'choice', 'fill-in', 'long-fill-in', 'likert', 'matching', 'performance', 'sequencing', 'numeric', 'other') }],
    ['cmi.interactions.n.objectives._count', 'r', { count: true }],
    ['cmi.interactions.n.objectives.n.id', 'rw', { limit: 4000 }],
    ['cmi.interactions.n.timestamp', 'rw', { check: timestamp }],
    ['cmi.interactions.n.correct_responses._count', 'r', { count: true }],
    ['cmi.interactions.n.correct_responses.n.pattern', 'rw'],
    ['cmi.interactions.n.weighting', 'rw', { check: real() }],
    ['cmi.interactions.n.learner_response', 'rw'],
    ['cmi.interactions.n.result', 'rw', { check: vocabOrReal('correct', 'incorrect', 'unanticipated', 'neutral') }],
    ['cmi.interactions.n.latency', 'rw', { check: duration }],
    ['cmi.interactions.n.description', 'rw', { limit: 250 }],
    ['cmi.launch_data', 'r'],
    ['cmi.learner_id', 'r'],
    ['cmi.learner_name', 'r'],
    ['cmi.learner_preference._children', 'r', { children: 'audio_level,language,delivery_speed,audio_captioning' }],
    ['cmi.learner_preference.audio_level', 'rw', { check: real(0) }],
    ['cmi.learner_preference.language', 'rw', { limit: 250 }],
    ['cmi.learner_preference.delivery_speed', 'rw', { check: real(0) }],
    ['cmi.learner_preference.audio_captioning', 'rw', { check: vocab('-1', '0', '1') }],
    ['cmi.location', 'rw', { limit: 1000 }],
    ['cmi.max_time_allowed', 'r'],
    ['cmi.mode', 'r'],
    ['cmi.objectives._children', 'r', { children: 'id,score,success_status,completion_status,progress_measure,description' }],
    ['cmi.objectives._count', 'r', { count: true }],
    ['cmi.objectives.n.id', 'rw', { limit: 4000 }],
    ['cmi.objectives.n.score._children', 'r', { children: 'scaled,raw,min,max' }],
    ['cmi.objectives.n.score.scaled', 'rw', { check: real(-1, 1) }],
    ['cmi.objectives.n.score.raw', 'rw', { check: real() }],
    ['cmi.objectives.n.score.min', 'rw', { check: real() }],
    ['cmi.objectives.n.score.max', 'rw', { check: real() }],
    ['cmi.objectives.n.success_status', 'rw', { check: vocab(...SUCCESS) }],
    ['cmi.objectives.n.completion_status', 'rw', { check: vocab(...COMPLETION) }],
    ['cmi.objectives.n.progress_measure', 'rw', { check: real(0, 1) }],
    ['cmi.objectives.n.description', 'rw', { limit: 250 }],
    ['cmi.progress_measure', 'rw', { check: real(0, 1) }],
    ['cmi.scaled_passing_score', 'r'],
    ['cmi.score._children', 'r', { children: 'scaled,raw,min,max' }],
    ['cmi.score.scaled', 'rw', { check: real(-1, 1) }],
    ['cmi.score.raw', 'rw', { check: real() }],
    ['cmi.score.min', 'rw', { check: real() }],
    ['cmi.score.max', 'rw', { check: real() }],
    ['cmi.session_time', 'w', { check: duration }],
    ['cmi.success_status', 'rw', { check: vocab(...SUCCESS) }],
    ['cmi.suspend_data', 'rw', { limit: 64000 }],
    ['cmi.time_limit_action', 'r'],
    ['cmi.total_time', 'r'],
    ['adl.nav.request', 'rw', { check: navRequest }],
    ['adl.nav.request_valid.continue', 'r'],
    ['adl.nav.request_valid.previous', 'r'],
  ]),
  { re: /^adl\.nav\.request_valid\.(choice|jump)\.\{target=[^}]+\}$/, access: 'r' },
];

export function findDef(version: ApiVersion, element: string): ElementDef | undefined {
  return (version === '1.2' ? MODEL_12 : MODEL_2004).find((d) => d.re.test(element));
}

/** Which elements persist between sessions: everything the course writes, except service ones */
export function isPersistent(version: ApiVersion, element: string): boolean {
  const def = findDef(version, element);
  if (!def || def.access === 'r' || def.count || def.children) return false;
  return !/^(cmi\.core\.session_time|cmi\.core\.exit|cmi\.session_time|cmi\.exit|adl\.nav\.request)$/.test(element);
}

/**
 * A chain of arrays in an element name:
 * «cmi.interactions.3.objectives.0.id» → [cmi.interactions #3, cmi.interactions.3.objectives #0]
 */
export function arrayChain(element: string): { prefix: string; index: number }[] {
  const parts = element.split('.');
  const out: { prefix: string; index: number }[] = [];
  parts.forEach((seg, i) => {
    if (/^\d+$/.test(seg)) out.push({ prefix: parts.slice(0, i).join('.'), index: Number(seg) });
  });
  return out;
}

// --- error texts ---

export const ERRORS_12: Record<number, string> = {
  0: 'No error',
  101: 'General exception',
  201: 'Invalid argument error',
  202: 'Element cannot have children',
  203: 'Element not an array. Cannot have count.',
  301: 'Not initialized',
  401: 'Not implemented error',
  402: 'Invalid set value, element is a keyword',
  403: 'Element is read only',
  404: 'Element is write only',
  405: 'Incorrect data type',
};

export const ERRORS_2004: Record<number, string> = {
  0: 'No error',
  101: 'General exception',
  102: 'General initialization failure',
  103: 'Already initialized',
  104: 'Content instance terminated',
  111: 'General termination failure',
  112: 'Termination before initialization',
  113: 'Termination after termination',
  122: 'Retrieve data before initialization',
  123: 'Retrieve data after termination',
  132: 'Store data before initialization',
  133: 'Store data after termination',
  142: 'Commit before initialization',
  143: 'Commit after termination',
  201: 'General argument error',
  301: 'General get failure',
  351: 'General set failure',
  391: 'General commit failure',
  401: 'Undefined data model element',
  402: 'Unimplemented data model element',
  403: 'Data model element value not initialized',
  404: 'Data model element is read only',
  405: 'Data model element is write only',
  406: 'Data model element type mismatch',
  407: 'Data model element value out of range',
  408: 'Data model dependency not established',
};
