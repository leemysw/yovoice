// 分轨混音器：运行在音频线程（AudioWorklet）里，像 DAW 的音频引擎一样只有一个时钟。
// 每轨的采样由主线程按块（约 2 秒）送来，这里逐个采样把各轨乘以增益后相加输出，所以各轨天然对齐到采样，
// 不存在“各自播放再对齐”的漂移问题。某一轨的数据没及时送到时只有这一轨暂时无声，时钟照走，不会拖慢其他轨道。
// 静音、独奏、音量只是改目标增益，增益在几毫秒内平滑过渡，切换时没有爆音。

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;

type Block = { start: number; frames: number; channels: Float32Array[] };
type Track = { ratio: number; frames: number; blocks: Block[]; cursor: number; gain: number; target: number };
type Message =
  | { type: 'track'; id: string; rate: number; frames: number; gain: number }
  | { type: 'block'; id: string; start: number; channels: Float32Array[] }
  | { type: 'gain'; id: string; value: number }
  | { type: 'play' } | { type: 'pause' }
  | { type: 'seek'; frame: number };

// 约每 1024 帧（44.1 kHz 下 23 毫秒）报告一次位置，主线程据此画播放头、预读后面的数据。
const reportEvery = 1024;

class StemMixer extends AudioWorkletProcessor {
  private tracks = new Map<string, Track>();
  private playing = false;
  private frame = 0;
  private length = 0;
  private sinceReport = 0;
  // 增益平滑：约 8 毫秒的一阶跟随，静音、独奏切换时不爆音。
  private readonly smooth = 1 - Math.exp(-1 / (0.008 * sampleRate));

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<Message>) => this.receive(event.data);
  }

  private receive(message: Message) {
    switch (message.type) {
      case 'track': {
        const ratio = message.rate / sampleRate;
        this.tracks.set(message.id, { ratio, frames: message.frames, blocks: [], cursor: 0, gain: message.gain, target: message.gain });
        this.length = Math.max(this.length, Math.ceil(message.frames / ratio));
        break;
      }
      case 'block': {
        const track = this.tracks.get(message.id);
        if (!track) return;
        track.blocks.push({ start: message.start, frames: message.channels[0]?.length ?? 0, channels: message.channels });
        track.blocks.sort((a, b) => a.start - b.start);
        track.cursor = 0;
        break;
      }
      case 'gain': {
        const track = this.tracks.get(message.id);
        if (track) { track.target = message.value; if (!this.playing) track.gain = message.value; }
        break;
      }
      case 'play': this.playing = true; this.report(); break;
      case 'pause': this.playing = false; this.report(); break;
      case 'seek':
        this.frame = Math.max(0, Math.min(this.length, message.frame));
        for (const track of this.tracks.values()) { track.blocks = []; track.cursor = 0; }
        this.report();
        break;
    }
  }

  private report() {
    this.sinceReport = 0;
    this.port.postMessage({ type: 'time', frame: this.frame, playing: this.playing });
  }

  // 取某一轨第 index 帧、第 channel 声道的采样；不在已送到的块里时返回 0。
  private at(track: Track, index: number, channel: number): number {
    const blocks = track.blocks;
    let block = blocks[track.cursor];
    if (!block || index < block.start || index >= block.start + block.frames) {
      track.cursor = blocks.findIndex(item => index >= item.start && index < item.start + item.frames);
      if (track.cursor < 0) { track.cursor = 0; return 0; }
      block = blocks[track.cursor];
    }
    const data = block.channels[Math.min(channel, block.channels.length - 1)];
    return data[index - block.start];
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const left = outputs[0][0], right = outputs[0][1] ?? outputs[0][0];
    const n = left.length;
    left.fill(0);
    if (right !== left) right.fill(0);
    if (!this.playing) return true;
    for (const track of this.tracks.values()) {
      for (let i = 0; i < n; i++) {
        track.gain += (track.target - track.gain) * this.smooth;
        if (track.gain < 1e-4 && track.target === 0) continue;
        const position = (this.frame + i) * track.ratio;
        if (position >= track.frames) break;
        const index = Math.floor(position), fraction = position - index;
        let l = this.at(track, index, 0), r = this.at(track, index, 1);
        // 采样率与输出不同的轨道做线性插值。
        if (fraction > 0) { l += (this.at(track, index + 1, 0) - l) * fraction; r += (this.at(track, index + 1, 1) - r) * fraction; }
        left[i] += l * track.gain;
        right[i] += r * track.gain;
      }
      // 已经播过的块丢掉，内存只保留播放头前后几秒。
      const done = this.frame * track.ratio - 4096;
      if (track.blocks.length && track.blocks[0].start + track.blocks[0].frames < done) { track.blocks = track.blocks.filter(block => block.start + block.frames >= done); track.cursor = 0; }
    }
    this.frame += n;
    this.sinceReport += n;
    if (this.frame >= this.length) {
      this.playing = false;
      this.port.postMessage({ type: 'ended', frame: this.frame });
    } else if (this.sinceReport >= reportEvery) this.report();
    return true;
  }
}

registerProcessor('stem-mixer', StemMixer);
