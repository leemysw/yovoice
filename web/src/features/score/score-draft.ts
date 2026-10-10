import { createDraft, type Draft, type Score, type ScoreNote, type ScoreRole, type ScoreTrack, type UiLocale } from '../../shared/workbench';

export const soundFontId = 'musescore-general-sf2';

// 与 Go 的 schema.ScoreRoles 一致：主奏在前，铺底和琶音退后。
export const roleLevels: Record<ScoreRole, number> = { melody: -21, piano: -21, strings: -23, bass: -25, drums: -25, pad: -29, arp: -29, other: -24 };
export const scoreRoles = Object.keys(roleLevels) as ScoreRole[];
export const targetLevel = (track: ScoreTrack) => track.level || roleLevels[track.role ?? 'other'];

// 以四分音符为拍：6/8 记为 3 拍。
export const beatsPerBar = (score: Score) => score.timeSignature[0] * 4 / score.timeSignature[1];
export const barTempo = (score: Score, bar: number) => score.sections?.find(s => s.tempo && bar >= s.start && bar <= s.end)?.tempo ?? score.tempo;
export function scoreBars(score: Score) {
  const per = beatsPerBar(score);
  let bars = Math.max(0, ...(score.sections ?? []).map(s => s.end));
  for (const track of score.tracks) for (const n of track.notes) bars = Math.max(bars, Math.ceil(((n.bar - 1) * per + n.beat - 1 + n.length) / per - 1e-9));
  return bars;
}
// 逐小节累加，支持段落变速；与 Go 的 Score.Seconds 一致。
export function scoreSeconds(score: Score, bar: number, beat = 1) {
  const per = beatsPerBar(score);
  let position = (bar - 1) * per + beat - 1, seconds = 0;
  for (let b = 1; position > 0; b++) { const step = Math.min(position, per); seconds += step * 60 / barTempo(score, b); position -= step; }
  return seconds;
}
export const scoreDuration = (score: Score) => scoreSeconds(score, scoreBars(score) + 1);
export const noteCount = (score: Score) => score.tracks.reduce((sum, t) => sum + t.notes.length, 0);

const names = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
export const pitchName = (pitch: number) => `${names[pitch % 12]}${Math.floor(pitch / 12) - 1}`;

export const emptyScore = (): Score => ({ tempo: 100, timeSignature: [4, 4], key: '', sections: [], tracks: [] });

// 示例：科技解读视频的垫底配乐。D 小调 100 BPM 22 小节，前奏只有铺底和钢琴，展开加入弦乐、低音、琶音和鼓，回落时钢琴放慢收在 Dm。
export function exampleScore(locale: UiLocale): Score {
  const zh = locale === 'zh-CN';
  const chords = [[50, 53, 57], [46, 50, 53], [41, 45, 48], [48, 52, 55]];
  const melody = [[[81, 2], [77, 1], [76, 1]], [[74, 1.5], [77, .5], [74, 2]], [[72, 2], [69, 1], [72, 1]], [[76, 3], [74, 1]]] as const;
  const chordAt = (bar: number) => bar >= 22 ? chords[0] : chords[(bar - 1) % 4];
  const track = (id: string, name: string, role: ScoreRole, program: number, extra: Partial<ScoreTrack> = {}): ScoreTrack => ({ id, name, role, program, notes: [], ...extra });
  const pad = track('pad', zh ? '铺底' : 'Pad', 'pad', 89, { reverb: .5 });
  const piano = track('piano', zh ? '钢琴' : 'Piano', 'piano', 0, { reverb: .3, pan: -.15, humanize: { velocity: 8, timingMs: 6 } });
  const violin = track('violin', zh ? '小提琴' : 'Violin', 'melody', 40, { reverb: .35, pan: .2, humanize: { velocity: 6 }, dynamics: [{ start: 7, end: 9, from: .35, to: 1 }, { start: 17, end: 18, from: 1, to: .55 }] });
  const viola = track('viola', zh ? '中提琴' : 'Viola', 'strings', 41, { reverb: .35, pan: -.25, dynamics: [{ start: 7, end: 9, from: .35, to: 1 }, { start: 17, end: 18, from: 1, to: .55 }] });
  const cello = track('cello', zh ? '大提琴' : 'Cello', 'bass', 42, { reverb: .3, dynamics: [{ start: 7, end: 9, from: .35, to: 1 }] });
  const arp = track('arp', zh ? '琶音' : 'Arp', 'arp', 81, { reverb: .4, pan: .35, humanize: { velocity: 10 } });
  const drums = track('drums', zh ? '鼓' : 'Drums', 'drums', 0, { drums: true, humanize: { velocity: 10, timingMs: 4 } });
  const add = (t: ScoreTrack, bar: number, beat: number, pitch: number, length: number, velocity: number) => t.notes.push({ bar, beat, pitch, length, velocity });
  for (let bar = 1; bar <= 22; bar++) {
    const [root, third, fifth] = chordAt(bar);
    for (const pitch of [root, third, fifth]) add(pad, bar, 1, pitch + 12, 4, bar >= 19 ? 54 : 64);
    const arpeggio = [root, fifth, root + 12, third + 12, fifth + 12, third + 12, root + 12, fifth];
    if (bar < 19) arpeggio.forEach((pitch, i) => add(piano, bar, 1 + i / 2, pitch + 12, .5, i % 2 ? 62 : 74));
    else [root, fifth, third + 12, root + 12].forEach((pitch, i) => add(piano, bar, 1 + i, pitch + 12, bar === 22 && i === 3 ? 1 : 1.2, 66 - (bar - 19) * 4));
    if (bar >= 7 && bar <= 18) {
      let beat = 1;
      for (const [pitch, length] of melody[(bar - 1) % 4]) { add(violin, bar, beat, pitch - (bar >= 15 ? 0 : 12), length * .95, 84); beat += length; }
      add(viola, bar, 1, third + 12, 1.9, 64); add(viola, bar, 3, fifth + 12, 1.9, 60);
      add(cello, bar, 1, root - 12, 3.9, 72);
      for (let b = 1; b <= 4; b++) {
        if (b % 2) add(drums, bar, b, 36, .25, 100);
        add(drums, bar, b, 42, .25, 64); add(drums, bar, b + .5, 42, .25, 50);
        if (bar >= 13 && b % 2 === 0) add(drums, bar, b, 37, .25, 78);
      }
    }
    if (bar >= 11 && bar <= 18) for (let i = 0; i < 16; i++) add(arp, bar, 1 + i / 4, [root, third, fifth, third][i % 4] + 24, .25, i % 4 ? 52 : 64);
  }
  return {
    tempo: 100, timeSignature: [4, 4], key: zh ? 'D 小调' : 'D minor',
    sections: [{ name: zh ? '前奏' : 'Intro', start: 1, end: 6 }, { name: zh ? '展开' : 'Build', start: 7, end: 18 }, { name: zh ? '回落' : 'Outro', start: 19, end: 22, tempo: 88 }],
    tracks: [pad, piano, violin, viola, cello, arp, drums],
  };
}

export function createScoreDraft(locale: UiLocale, example = true): Draft {
  return {
    ...createDraft(false, locale, soundFontId), kind: 'score',
    title: example ? (locale === 'zh-CN' ? '科技解读 · 垫底配乐' : 'Tech Explainer Underscore') : createDraft(false, locale).title,
    score: example ? exampleScore(locale) : emptyScore(),
  };
}

// 给外部 Agent 的提示词：说明乐谱格式、可用声部和电平约定，Agent 写好后导入或用 CLI 渲染。
export function agentPrompt(locale: UiLocale, draft: Draft) {
  const sample: ScoreNote = { bar: 1, beat: 1, pitch: 62, length: 0.5, velocity: 80 };
  const zh = locale === 'zh-CN';
  return [
    zh ? `请为「${draft.title}」写一份 yovoice 编曲乐谱 JSON。` : `Write a yovoice score JSON for "${draft.title}".`,
    zh ? '格式：{ tempo, timeSignature: [4, 4], key, sections: [{ name, start, end, tempo? }], tracks: [{ id, name, role, program, drums?, level?, pan?, reverb?, humanize?: { velocity, timingMs }, dynamics?: [{ start, end, from, to }], notes: [...] }] }'
      : 'Format: { tempo, timeSignature: [4, 4], key, sections: [{ name, start, end, tempo? }], tracks: [{ id, name, role, program, drums?, level?, pan?, reverb?, humanize?: { velocity, timingMs }, dynamics?: [{ start, end, from, to }], notes: [...] }] }',
    zh ? `音符示例：${JSON.stringify(sample)}。bar 与 beat 从 1 开始，length 以拍计，pitch 为 MIDI 音高（60 = C4），velocity 1–127。` : `Note example: ${JSON.stringify(sample)}. bar and beat start at 1, length is in beats, pitch is MIDI (60 = C4), velocity 1–127.`,
    zh ? 'program 为 General MIDI 音色号（0 钢琴、40 小提琴、42 大提琴、48 弦乐合奏、89 暖音铺底、81 锯齿波）；鼓组设 drums: true，36 底鼓、38 军鼓、37 边击、42 闭镲。' : 'program is a General MIDI number (0 piano, 40 violin, 42 cello, 48 strings, 89 warm pad, 81 saw lead); set drums: true for kits, 36 kick, 38 snare, 37 side stick, 42 closed hat.',
    zh ? 'role 取 melody、piano、strings、bass、drums、pad、arp、other，决定默认电平；每个声部只写一种乐器。' : 'role is one of melody, piano, strings, bass, drums, pad, arp, other and sets the default level; one instrument per track.',
    zh ? '只输出 JSON。渲染：yovoice score render score.json --output music.wav --stems stems/' : 'Output JSON only. Render with: yovoice score render score.json --output music.wav --stems stems/',
  ].join('\n');
}
