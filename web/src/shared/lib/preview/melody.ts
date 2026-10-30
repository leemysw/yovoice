import type { MelodyInspection, ScoreNote } from '../../workbench';
import { CallError } from '../call-error';

// 预览端的 ABC 谱读取：只解析谱头（Q/M/L/K）和 V:Vocal 声部的音符，算出小节数、时长与人声旋律；完整校验在 Go 中。
export function previewInspectMelody(abc: string): MelodyInspection {
  const header = (field: string) => new RegExp(`^${field}:\\s*(.+)$`, 'm').exec(abc)?.[1].trim() ?? '';
  const tempo = Number(/=(\d+)/.exec(header('Q'))?.[1]), meter = header('M').split('/').map(Number), unit = Number(header('L').split('/')[1]);
  if (!(tempo > 0) || meter.length !== 2 || !(unit > 0)) return { issue: { code: 'header', detail: '' } };
  const lines = abc.split('\n'), notes: ScoreNote[] = [];
  const steps: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }, beatUnits = unit / meter[1];
  let bars = 0, chords = false, position = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!/^V:\s*Vocal\s*$/.test(lines[i]) || !lines[i + 1]) continue;
    const music = lines[i + 1];
    chords ||= music.includes('"');
    for (const m of music.replace(/"[^"]*"/g, '').matchAll(/(\|)|([_^=]*)([A-Ga-gzZ])([,']*)(\d*)/g)) {
      if (m[1]) { bars++; position = bars * meter[0]; continue; }
      const length = (Number(m[5]) || 1) / beatUnits;
      if (m[3] === 'Z') { bars += (Number(m[5]) || 1) - 1; continue; }
      if (m[3] !== 'z') {
        const accidental = m[2].includes('^') ? 1 : m[2].includes('_') ? -1 : 0;
        const pitch = 60 + steps[m[3].toUpperCase()] + accidental + (m[3] === m[3].toLowerCase() ? 12 : 0) + [...m[4]].reduce((n, c) => n + (c === ',' ? -12 : 12), 0);
        notes.push({ bar: Math.floor(position / meter[0]) + 1, beat: position % meter[0] + 1, length, pitch, velocity: 90 });
      }
      position += length;
    }
  }
  if (!bars) return { issue: { code: 'group', detail: '' } };
  const score = { tempo, timeSignature: [meter[0], meter[1]] as [number, number], tracks: [{ id: 'vocal', name: 'Vocal', role: 'melody' as const, program: 53, notes }] };
  return { tempo, meter: [meter[0], meter[1]], key: header('K'), bars, seconds: bars * meter[0] * 60 / tempo, chords, score };
}

// 预览端的 ABC 改写只做文本替换：去和弦、改速度；op 或 tempo 不合法时按请求无效报错。
export function previewTransformMelody(abc: string, op: string, tempo: number): string {
  if (op === 'stripChords') return abc.split('\n').map(line => /^[A-Za-z]:|^%/.test(line) ? line : line.replace(/"[^"]*"/g, '')).join('\n');
  // 转器乐谱的事件级改写只在 Go 中；预览原样返回。
  if (op === 'instrumental') return abc;
  if (op === 'tempo' && tempo >= 30 && tempo <= 300) return abc.replace(/^Q:.*$/m, `Q:1/4=${tempo}`);
  throw new CallError('@yovoice.error.requestInvalid');
}
