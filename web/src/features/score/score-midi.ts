import type { Score, ScoreTrack } from '../../shared/workbench';
import { barTempo, beatsPerBar, scoreBars } from './score-draft';

const ppq = 480;

const varint = (value: number) => {
  const bytes = [value & 0x7f];
  for (value >>= 7; value > 0; value >>= 7) bytes.unshift((value & 0x7f) | 0x80);
  return bytes;
};

// 写出类型 1 的标准 MIDI：首轨记录速度与拍号，每个声部一轨，鼓组走第 10 通道。与 Go 的 score.MIDI 一致。
export function scoreToMidi(score: Score): Uint8Array {
  const per = beatsPerBar(score);
  const tick = (bar: number, beat: number) => Math.round(((bar - 1) * per + beat - 1) * ppq);
  const conductor: { tick: number; data: number[] }[] = [{ tick: 0, data: [0xff, 0x58, 4, score.timeSignature[0], Math.log2(score.timeSignature[1]), 24, 8] }];
  let tempo = 0;
  for (let bar = 1; bar <= scoreBars(score); bar++) {
    const next = barTempo(score, bar);
    if (next === tempo) continue;
    tempo = next;
    const us = Math.round(60_000_000 / next);
    conductor.push({ tick: tick(bar, 1), data: [0xff, 0x51, 3, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff] });
  }
  const chunks = [conductor];
  let melodic = 0;
  for (const track of score.tracks) {
    const channel = track.drums ? 9 : [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15][melodic++ % 15];
    const name = [...new TextEncoder().encode(track.name)];
    const events = [
      { tick: 0, data: [0xff, 0x03, ...varint(name.length), ...name] },
      { tick: 0, data: [0xc0 | channel, track.program] },
      { tick: 0, data: [0xb0 | channel, 10, Math.round(64 + (track.pan ?? 0) * 63)] },
      { tick: 0, data: [0xb0 | channel, 91, Math.round((track.reverb ?? 0) * 127)] },
    ];
    for (const n of track.notes) {
      const start = tick(n.bar, n.beat);
      events.push({ tick: start, data: [0x90 | channel, n.pitch, n.velocity] }, { tick: start + Math.max(1, Math.round(n.length * ppq)), data: [0x80 | channel, n.pitch, 0] });
    }
    chunks.push(events);
  }
  const out = [...new TextEncoder().encode('MThd'), 0, 0, 0, 6, 0, 1, chunks.length >> 8, chunks.length & 0xff, ppq >> 8, ppq & 0xff];
  for (const events of chunks) {
    // 同一刻先写关音，同音连奏不会被提前截断。
    const sorted = events.map((e, i) => ({ ...e, i })).sort((a, b) => a.tick - b.tick || Number((b.data[0] & 0xf0) === 0x80) - Number((a.data[0] & 0xf0) === 0x80) || a.i - b.i);
    const body: number[] = [];
    let last = 0;
    for (const e of sorted) { body.push(...varint(e.tick - last), ...e.data); last = e.tick; }
    body.push(0, 0xff, 0x2f, 0);
    out.push(...new TextEncoder().encode('MTrk'), (body.length >>> 24) & 0xff, (body.length >> 16) & 0xff, (body.length >> 8) & 0xff, body.length & 0xff, ...body);
  }
  return new Uint8Array(out);
}

// 读取类型 0/1 的标准 MIDI：按“轨道 × 通道”拆分声部，速度取第一个速度事件，拍号取开头的拍号。
export function midiToScore(data: Uint8Array, fallbackName: (n: number) => string): Score {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const text = (at: number, length: number) => new TextDecoder().decode(data.subarray(at, at + length));
  const fail = (): never => { throw new Error('@yovoice.error.midiInvalid'); };
  if (data.length < 14 || text(0, 4) !== 'MThd') fail();
  const headerSize = view.getUint32(4), format = view.getUint16(8), count = view.getUint16(10), division = view.getUint16(12);
  if (format > 1 || !division || division & 0x8000) fail();
  let pos = 8 + headerSize, tempo = 0;
  let meter = [4, 4];
  const names = new Map<number, string>(), programs = new Map<string, number>();
  const notes: { track: number; channel: number; pitch: number; velocity: number; start: number; end: number }[] = [];
  for (let track = 0; track < count; track++) {
    if (pos + 8 > data.length) fail();
    const id = text(pos, 4), size = view.getUint32(pos + 4);
    const start = pos + 8, end = start + size;
    if (end > data.length) fail();
    pos = end;
    if (id !== 'MTrk') continue;
    const open = new Map<string, typeof notes>();
    let i = start, tick = 0, status = 0;
    const read = () => { let v = 0; for (let k = 0; k < 4; k++) { if (i >= end) fail(); const b = data[i++]; v = (v << 7) | (b & 0x7f); if (!(b & 0x80)) return v; } return fail(); };
    while (i < end) {
      tick += read();
      if (i >= end) fail();
      if (data[i] & 0x80) status = data[i++];
      if (status === 0xff) {
        const kind = data[i++], length = read();
        if (i + length > end) fail();
        if (kind === 0x51 && length === 3 && !tempo) tempo = 60_000_000 / ((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
        if (kind === 0x58 && length >= 2 && tick === 0) meter = [data[i], 2 ** data[i + 1]];
        if (kind === 0x03 && !names.has(track)) names.set(track, text(i, length));
        i += length;
      } else if (status === 0xf0 || status === 0xf7) {
        i += read();
      } else if (status >= 0x80) {
        const width = (status & 0xf0) === 0xc0 || (status & 0xf0) === 0xd0 ? 1 : 2;
        if (i + width > end) fail();
        const a = data[i], b = width === 2 ? data[i + 1] : 0, channel = status & 0x0f;
        i += width;
        const key = `${channel}:${a}`;
        if ((status & 0xf0) === 0xc0) programs.set(`${track}:${channel}`, a);
        if ((status & 0xf0) === 0x90 || (status & 0xf0) === 0x80) {
          const pending = open.get(key) ?? [];
          const done = pending.shift();
          if (done) notes.push({ ...done, end: tick });
          if ((status & 0xf0) === 0x90 && b > 0) pending.push({ track, channel, pitch: a, velocity: b, start: tick, end: tick });
          open.set(key, pending);
        }
      } else fail();
    }
  }
  const score: Score = { tempo: Math.round(Math.min(300, Math.max(30, tempo || 120)) * 100) / 100, timeSignature: meter[0] >= 1 && meter[0] <= 16 && [2, 4, 8, 16].includes(meter[1]) ? meter : [4, 4], key: '', sections: [], tracks: [] };
  const per = beatsPerBar(score);
  const index = new Map<string, ScoreTrack>();
  for (const n of notes) {
    if (n.end <= n.start) continue;
    const key = `${n.track}:${n.channel}`;
    let track = index.get(key);
    if (!track) {
      if (score.tracks.length === 32) continue;
      track = { id: `t${score.tracks.length + 1}`, name: [...(names.get(n.track) || fallbackName(score.tracks.length + 1))].slice(0, 40).join(''), role: n.channel === 9 ? 'drums' : 'other', program: programs.get(key) ?? 0, drums: n.channel === 9 || undefined, notes: [] };
      index.set(key, track); score.tracks.push(track);
    }
    const beats = n.start / division, bar = Math.floor(beats / per) + 1;
    track.notes.push({ bar, beat: Math.round((beats - (bar - 1) * per + 1) * 1000) / 1000, pitch: n.pitch, length: Math.round((n.end - n.start) / division * 1000) / 1000, velocity: n.velocity });
  }
  for (const track of score.tracks) track.notes.sort((a, b) => a.bar - b.bar || a.beat - b.beat);
  if (!score.tracks.length) fail();
  return score;
}
