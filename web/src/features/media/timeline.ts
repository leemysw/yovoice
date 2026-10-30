import { stableJSON, type AudioClip, type AudioLane, type AudioTimeline, type Draft, type Generation } from '../../shared/workbench';

// 时间线可引用的音频源：工程历史里的生成，或导入的音频资源（键为 asset:<id>）。
export type AudioSource = { title: string; duration: number; fileName: string; segment?: Generation['segment'] };

// 所有剪辑使用源音频范围，不改写生成文件。
export class Timeline {
  static sourceKey(clip: AudioClip): string {
    return clip.assetId ? `asset:${clip.assetId}` : clip.generationId ?? '';
  }

  static duration(value: AudioTimeline): number {
    return Math.max(0, ...value.tracks.flatMap(track => track.clips.map(clip => clip.start + clip.duration)));
  }

  static split(value: AudioTimeline, id: string, time: number): AudioTimeline {
    if (!Number.isFinite(time) || value.tracks.reduce((sum, track) => sum + track.clips.length, 0) >= 2000) return value;
    return { ...value, tracks: value.tracks.map(track => ({ ...track, clips: track.clips.flatMap(clip => {
      if (track.locked) return [clip];
      const left = time - clip.start;
      if (clip.id !== id || left < 0.01 || clip.duration - left < 0.01) return [clip];
      return [{ ...clip, duration: left }, { ...clip, id: crypto.randomUUID(), start: time, offset: clip.offset + left, duration: clip.duration - left }];
    }) })) };
  }

  static move(value: AudioTimeline, id: string, laneId: string, start: number): AudioTimeline {
    const clip = value.tracks.flatMap(track => track.clips).find(c => c.id === id);
    if (value.tracks.some(t => t.locked && (t.id === laneId || t.clips.some(c => c.id === id)))) return value;
    if (!clip || !Number.isFinite(start) || start < 0 || start + clip.duration > 86400 || !value.tracks.some(t => t.id === laneId)) return value;
    return { ...value, tracks: value.tracks.map(track => ({ ...track, clips: [...track.clips.filter(c => c.id !== id), ...(track.id === laneId ? [{ ...clip, start }] : [])].sort((a, b) => a.start - b.start) })) };
  }

  // 磁吸裁剪保持片段起点，同轨后续片段按实际时长差移动；源音频不变。
  static trimEdge(value: AudioTimeline, id: string, edge: 'start' | 'end', delta: number, sourceDuration: number, ripple = false): AudioTimeline {
    const lane = value.tracks.find(t => t.clips.some(c => c.id === id));
    const clip = lane?.clips.find(c => c.id === id);
    if (!lane || lane.locked || !clip || !Number.isFinite(delta) || !Number.isFinite(sourceDuration) || sourceDuration <= 0) return value;
    const end = clip.start + clip.duration;
    const room = 86400 - Math.max(end, ...(ripple ? lane.clips.filter(c => c.id !== id && c.start >= end - 1e-7).map(c => c.start + c.duration) : []));
    const shift = edge === 'start'
      ? Math.max(-Math.min(clip.offset, ripple ? room : clip.start), Math.min(delta, clip.duration - 0.01))
      : Math.max(0.01 - clip.duration, Math.min(delta, sourceDuration - clip.offset - clip.duration, room));
    if (!shift) return value;
    const durationDelta = edge === 'start' ? -shift : shift;
    return { ...value, tracks: value.tracks.map(track => track.id !== lane.id ? track : { ...track, clips: track.clips.map(c => c.id === id ? {
      ...c, start: c.start + (edge === 'start' && !ripple ? shift : 0), offset: c.offset + (edge === 'start' ? shift : 0), duration: c.duration + durationDelta,
    } : ripple && c.start >= end - 1e-7 ? { ...c, start: c.start + durationDelta } : c) }) };
  }

  // 已接收的版本单独记忆，删除片段或重新打开作品不会把它再次插入。
  static accept(draft: Draft, history: Generation[]): Draft {
    const accepted = new Set(draft.timeline?.acceptedGenerations ?? []);
    const pending = history.filter(g => g.segment && g.settings.id === draft.id && !accepted.has(g.id)).slice().reverse();
    if (!pending.length) return draft;
    const timeline = structuredClone(draft.timeline ?? { tracks: [] });
    let changed = false;
    for (const g of pending) {
      const segment = g.segment!;
      if (segment.targetClipId) {
        const lane = timeline.tracks.find(t => t.clips.some(c => c.id === segment.targetClipId));
        const clip = lane?.clips.find(c => c.id === segment.targetClipId);
        if (lane && clip) {
          if (lane.locked) continue;
          const end = clip.start + clip.duration;
          const delta = g.duration - clip.duration;
          if (lane.clips.some(c => (c.id === clip.id ? c.start + g.duration : c.start + c.duration + (c.start >= end ? delta : 0)) > 86400)) continue;
          lane.clips = lane.clips.map(c => c.id === clip.id ? { ...c, generationId: g.id, assetId: undefined, offset: 0, duration: g.duration } : c.start >= end ? { ...c, start: c.start + delta } : c);
        }
        // 生成期间已删除的片段不复活，保留源文件，不再次插入时间轴。
      } else {
        let lane = timeline.tracks.find(t => t.id === segment.batchId);
        if (!lane) {
          if (timeline.tracks.length >= 32) continue;
          lane = { id: segment.batchId, name: draft.title, muted: timeline.tracks.some(t => !t.muted && t.clips.length > 0), clips: [] };
          timeline.tracks.push(lane);
        }
        const start = Math.max(0, ...lane.clips.map(c => c.start + c.duration));
        if (start + g.duration > 86400 || timeline.tracks.reduce((sum, t) => sum + t.clips.length, 0) >= 2000) continue;
        lane.clips.push({ id: g.id, generationId: g.id, start, offset: 0, duration: g.duration });
      }
      changed = true; accepted.add(g.id);
    }
    return changed ? { ...draft, timeline: { ...timeline, acceptedGenerations: [...accepted] } } : draft;
  }

  static playback(clip: AudioClip, time: number) {
    const elapsed = Math.max(0, time - clip.start);
    return { delay: Math.max(0, clip.start - time), offset: clip.offset + elapsed, duration: Math.max(0, clip.duration - elapsed) };
  }

  static audible(value: AudioTimeline): AudioLane[] {
    const solo = value.tracks.some(t => t.solo);
    return value.tracks.filter(t => !t.muted && (!solo || t.solo));
  }

  // 导出范围：track:单条音轨（忽略静音和独奏），role:某位说话人的片段；全部和所选范围不改动音轨。
  static scoped(value: AudioTimeline, scope: string, history: Generation[]): AudioTimeline {
    if (scope.startsWith('track:')) return { ...value, tracks: value.tracks.filter(t => t.id === scope.slice(6)).map(t => ({ ...t, muted: false, solo: false })) };
    if (scope.startsWith('role:')) {
      const role = scope.slice(5);
      return { ...value, tracks: value.tracks.map(t => ({ ...t, clips: t.clips.filter(c => history.find(g => g.id === c.generationId)?.segment?.speakerId === role) })) };
    }
    return value;
  }

  static snap(value: AudioTimeline, ids: string[], edges: number[], threshold: number, cursor: number) {
    const targets = [0, cursor, ...value.tracks.flatMap(t => t.clips.filter(c => !ids.includes(c.id)).flatMap(c => [c.start, c.start + c.duration]))];
    let delta = 0, guide: number | undefined, distance = threshold;
    for (const edge of edges) for (const target of targets) {
      if (Math.abs(target - edge) < distance) { delta = target - edge; distance = Math.abs(delta); guide = target; }
    }
    return { delta, guide };
  }

  // 同轨从最早选中片段起整体移动，内部间隙不逐段转移。
  static following(value: AudioTimeline, ids: string[]): string[] {
    return value.tracks.flatMap(track => {
      const start = Math.min(...track.clips.filter(c => ids.includes(c.id)).map(c => c.start));
      return track.clips.filter(c => c.start >= start).map(c => c.id);
    });
  }

  static moveGroup(value: AudioTimeline, ids: string[], delta: number, laneDelta = 0, ripple = false): AudioTimeline {
    if (ripple && laneDelta === 0) ids = Timeline.following(value, ids);
    const selected = value.tracks.flatMap((t, lane) => t.clips.filter(c => ids.includes(c.id)).map(c => ({ c, lane })));
    if (!selected.length || !Number.isFinite(delta) || selected.some(({ lane }) => value.tracks[lane].locked || !value.tracks[lane + laneDelta] || value.tracks[lane + laneDelta].locked)) return value;
    const minimum = ripple && laneDelta === 0
      ? Math.max(...[...new Set(selected.map(v => v.lane))].map(lane => {
        const previousEnd = Math.max(0, ...value.tracks[lane].clips.filter(c => !ids.includes(c.id)).map(c => c.start + c.duration));
        return previousEnd - Math.min(...selected.filter(v => v.lane === lane).map(v => v.c.start));
      }))
      : -Math.min(...selected.map(({ c }) => c.start));
    delta = Math.max(minimum, Math.min(delta, 86400 - Math.max(...selected.map(({ c }) => c.start + c.duration))));
    return { ...value, tracks: value.tracks.map((t, lane) => ({ ...t, clips: [...t.clips.filter(c => !ids.includes(c.id)), ...selected.filter(v => v.lane + laneDelta === lane).map(({ c }) => ({ ...c, start: c.start + delta }))].sort((a, b) => a.start - b.start) })) };
  }

  static remove(value: AudioTimeline, ids: string[], ripple = false): AudioTimeline {
    return { ...value, tracks: value.tracks.map(t => {
      if (t.locked) return t;
      // 合并重叠删除区间，防止波纹删除重复扣掉同一段时长。
      const ranges: [number, number][] = [];
      for (const c of t.clips.filter(c => ids.includes(c.id)).sort((a, b) => a.start - b.start)) {
        const last = ranges.at(-1);
        if (last && c.start <= last[1]) last[1] = Math.max(last[1], c.start + c.duration);
        else ranges.push([c.start, c.start + c.duration]);
      }
      return { ...t, clips: t.clips.filter(c => !ids.includes(c.id)).map(c => ({ ...c, start: c.start - (ripple ? ranges.reduce((sum, [a, b]) => sum + Math.max(0, Math.min(c.start, b) - a), 0) : 0) })) };
    }) };
  }

  static paste(value: AudioTimeline, clips: { clip: AudioClip; lane: number }[], time: number, lane: number): AudioTimeline {
    if (!clips.length || value.tracks.reduce((n, t) => n + t.clips.length, 0) + clips.length > 2000) return value;
    const first = Math.min(...clips.map(c => c.clip.start)), firstLane = Math.min(...clips.map(c => c.lane));
    const items = clips.map(c => ({ lane: lane + c.lane - firstLane, clip: { ...c.clip, id: crypto.randomUUID(), start: time + c.clip.start - first } }));
    if (items.some(c => !value.tracks[c.lane] || value.tracks[c.lane].locked || c.clip.start < 0 || c.clip.start + c.clip.duration > 86400)) return value;
    return { ...value, tracks: value.tracks.map((t, i) => ({ ...t, clips: [...t.clips, ...items.filter(c => c.lane === i).map(c => c.clip)].sort((a, b) => a.start - b.start) })) };
  }

  static gap(value: AudioTimeline, id: string, seconds: number): AudioTimeline {
    const track = value.tracks.find(t => t.clips.some(c => c.id === id));
    const clip = track?.clips.find(c => c.id === id);
    if (!track || !clip || track.locked || !Number.isFinite(seconds)) return value;
    const previousEnd = Math.max(0, ...track.clips.filter(c => c.id !== id && c.start < clip.start).map(c => c.start + c.duration));
    const delta = previousEnd + Math.max(0, seconds) - clip.start;
    return Timeline.moveGroup(value, track.clips.filter(c => c.start >= clip.start).map(c => c.id), delta);
  }

  // 试听与离线导出共用增益曲线；自动压低只响应可听的对白轨。
  static schedule(audio: BaseAudioContext, value: AudioTimeline, buffers: Map<string, AudioBuffer>, from: number, to: number, when: number): AudioBufferSourceNode[] {
    const tracks = Timeline.audible(value);
    // 先校验整次播放，不能让前面的片段在后续源无效时继续出声。
    for (const clip of tracks.flatMap(t => t.clips)) {
      if (clip.start >= to || clip.start + clip.duration <= from) continue;
      const buffer = buffers.get(Timeline.sourceKey(clip));
      if (!buffer || clip.offset + clip.duration > buffer.duration + 0.02) throw new Error('@yovoice.timeline.invalid');
    }
    const duckAt = Timeline.ducking(tracks);
    const nodes: AudioBufferSourceNode[] = [];
    for (const track of tracks) for (const clip of track.clips) {
      const begin = Math.max(from, clip.start), end = Math.min(to, clip.start + clip.duration);
      if (end <= begin) continue;
      const buffer = buffers.get(Timeline.sourceKey(clip))!;
      const db = (clip.gainDb ?? 0) + (track.gainDb ?? 0);
      const gainAt = (time: number) => {
        const duck = track.duckDb ? duckAt(time) : 0;
        return 10 ** ((db - (track.duckDb ?? 0) * duck) / 20);
      };
      const source = audio.createBufferSource(), gain = audio.createGain();
      source.buffer = buffer; source.connect(gain); gain.connect(audio.destination);
      // 10ms 采样处理背景压低曲线，预览与导出完全一致。
      const count = Math.max(2, Math.ceil((end - begin) * 100) + 1);
      gain.gain.setValueCurveAtTime(Float32Array.from({ length: count }, (_, i) => gainAt(begin + i / (count - 1) * (end - begin))), when + begin - from, end - begin);
      source.onended = () => { source.disconnect(); gain.disconnect(); };
      source.start(when + begin - from, clip.offset + begin - clip.start, end - begin); nodes.push(source);
    }
    return nodes;
  }

  /**
   * 背景压低的曲线：返回某一时刻的压低程度（0 不压、1 压满）。参照专业混音的做法：
   * 音乐在说话前 0.25 秒开始让位、说完后 0.6 秒内回来；两句之间不到 1.2 秒的停顿保持压低，
   * 避免音乐随每一句忽高忽低（“抽吸”）。过渡用余弦曲线，比直线更不易察觉。
   */
  static ducking(tracks: AudioLane[]): (time: number) => number {
    const lead = 0.25, release = 0.6, bridge = 1.2;
    const speech: { start: number; end: number }[] = [];
    for (const c of tracks.filter(t => !t.duckDb).flatMap(t => t.clips.filter(c => !!c.generationId)).sort((a, b) => a.start - b.start)) {
      const previous = speech.at(-1);
      if (previous && c.start <= previous.end + bridge) previous.end = Math.max(previous.end, c.start + c.duration);
      else speech.push({ start: c.start, end: c.start + c.duration });
    }
    const ease = (x: number) => x <= 0 ? 0 : x >= 1 ? 1 : (1 - Math.cos(Math.PI * x)) / 2;
    return (time: number) => {
      let lo = 0, hi = speech.length;
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (speech[mid].start - lead <= time) lo = mid + 1; else hi = mid; }
      return Math.max(0, ...speech.slice(Math.max(0, lo - 1), lo + 1).map(c => ease(Math.min((time - c.start + lead) / lead, (c.end + release - time) / release))));
    };
  }

  static async render(value: AudioTimeline, load: (id: string) => Promise<AudioBuffer>, range?: { start: number; end: number }): Promise<AudioBuffer> {
    const tracks = Timeline.audible(value);
    const from = range?.start ?? 0, to = range?.end ?? Math.max(0, ...tracks.flatMap(t => t.clips.map(c => c.start + c.duration)));
    const duration = to - from;
    if (duration <= 0 || !tracks.some(t => t.clips.some(c => c.start < to && c.start + c.duration > from))) throw new Error('@yovoice.timeline.emptyExport');
    // ponytail: 离线渲染限制一小时控制内存，长篇导出再换为流式文件渲染。
    if (duration > 3600) throw new Error('@yovoice.timeline.exportLimit');
    const audio = new OfflineAudioContext(1, Math.ceil(duration * 24000), 24000);
    const buffers = new Map<string, AudioBuffer>();
    for (const id of new Set(tracks.flatMap(t => t.clips.filter(c => c.start < to && c.start + c.duration > from).map(c => Timeline.sourceKey(c))))) buffers.set(id, await load(id));
    Timeline.schedule(audio, value, buffers, from, to, 0);
    return audio.startRendering();
  }

  static peak(buffer: AudioBuffer): number {
    let peak = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) for (const sample of buffer.getChannelData(channel)) peak = Math.max(peak, Math.abs(sample));
    return peak;
  }

  static balance(value: AudioTimeline, history: Generation[], buffers: Map<string, AudioBuffer>): AudioTimeline {
    const groups = new Map<string, { sum: number; count: number; peak: number }>();
    for (const track of value.tracks.filter(t => !t.locked && !t.duckDb)) for (const clip of track.clips) {
      const role = history.find(g => g.id === clip.generationId)?.segment?.speakerId;
      const buffer = buffers.get(Timeline.sourceKey(clip));
      if (!role || !buffer) continue;
      const group = groups.get(role) ?? { sum: 0, count: 0, peak: 0 };
      const data = buffer.getChannelData(0);
      // 按非静音采样的 RMS 均衡角色，保留动态，不标称为 LUFS 归一化。
      for (let i = Math.floor(clip.offset * buffer.sampleRate); i < Math.min(data.length, (clip.offset + clip.duration) * buffer.sampleRate); i++) {
        const x = data[i] * 10 ** ((track.gainDb ?? 0) / 20);
        group.peak = Math.max(group.peak, Math.abs(x));
        if (Math.abs(x) > 0.001) { group.sum += x * x; group.count++; }
      }
      groups.set(role, group);
    }
    return { ...value, tracks: value.tracks.map(t => t.locked || t.duckDb ? t : { ...t, clips: t.clips.map(c => {
      const role = history.find(g => g.id === c.generationId)?.segment?.speakerId;
      const g = role ? groups.get(role) : undefined;
      return g?.sum ? { ...c, gainDb: Math.max(-60, Math.min(12, 20 * Math.log10(Math.min(0.126 / Math.sqrt(g.sum / g.count), 0.89 / g.peak)))) } : c;
    }) }) };
  }

}

interface TimelineSnapshot { value: AudioTimeline; selected: string }

// 只保存工程数据，不复制音频；撤销栈随当前作品的编辑会话释放。
export class TimelineHistory {
  private past: TimelineSnapshot[] = [];
  private future: TimelineSnapshot[] = [];

  constructor(private current: AudioTimeline) {}

  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }

  record(value: AudioTimeline, selected: string): boolean {
    if (stableJSON(value) === stableJSON(this.current)) return false;
    this.past.push({ value: this.current, selected });
    // 最多保留 100 步，避免长时间编辑持续占用内存。
    if (this.past.length > 100) this.past.shift();
    this.future = []; this.current = value;
    return true;
  }

  restore(direction: 'undo' | 'redo', selected: string): TimelineSnapshot | undefined {
    const from = direction === 'undo' ? this.past : this.future;
    const to = direction === 'undo' ? this.future : this.past;
    const snapshot = from.pop();
    if (!snapshot) return;
    to.push({ value: this.current, selected });
    // 接收记录只增不减，撤销生成结果后不能被自动接收逻辑再次插入。
    this.current = { ...snapshot.value, acceptedGenerations: [...new Set([...(this.current.acceptedGenerations ?? []), ...(snapshot.value.acceptedGenerations ?? [])])] };
    return { value: this.current, selected: snapshot.selected };
  }
}
