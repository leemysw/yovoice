import { bufferPeaks, decodeAudio } from '../../shared/lib/sound';

// 波形峰值：WAV 边读取边取峰值，不解码整段音频，几十分钟的长音频也只占用固定内存，并随读取分段让出主线程；
// 其他格式只在文件较小时整段解码，过大时不画波形。
export type Waveform = { peaks: number[]; duration: number };

// 非 WAV 音频整段解码的体积上限。
const decodeLimit = 32 * 1024 * 1024;
// 文件头里找不到数据块时放弃按 WAV 读取的上限。
const headerLimit = 1024 * 1024;
// 每个峰值最多取的采样数，超长音频按间隔取样，控制计算量。
const samplesPerBin = 256;

type Format = { encoding: 'int' | 'float'; bits: number; channels: number; sampleRate: number; align: number; dataOffset: number; dataSize: number };
export type WavFormat = Format;

// 解析 RIFF/WAVE 文件头：返回数据块位置与采样格式；字节不够时返回 'more'，不是可读的 WAV 时返回 null。
export function parseWavHeader(bytes: Uint8Array): Format | 'more' | null {
  if (bytes.length < 12) return 'more';
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let format: Omit<Format, 'dataOffset' | 'dataSize'> | undefined;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const id = tag(offset), size = view.getUint32(offset + 4, true);
    if (id === 'data') return format ? { ...format, dataOffset: offset + 8, dataSize: size } : null;
    if (id === 'fmt ') {
      if (offset + 8 + Math.min(size, 26) > bytes.length) return 'more';
      let code = view.getUint16(offset + 8, true);
      // WAVE_FORMAT_EXTENSIBLE 的真实格式写在子格式 GUID 的前两个字节。
      if (code === 0xfffe && size >= 26) code = view.getUint16(offset + 32, true);
      const channels = view.getUint16(offset + 10, true), sampleRate = view.getUint32(offset + 12, true);
      const align = view.getUint16(offset + 20, true), bits = view.getUint16(offset + 22, true);
      const encoding = code === 1 && [8, 16, 24, 32].includes(bits) ? 'int' : code === 3 && (bits === 32 || bits === 64) ? 'float' : null;
      if (!encoding || !channels || !sampleRate || align < channels * bits / 8) return null;
      format = { encoding, bits, channels, sampleRate, align };
    }
    offset += 8 + size + (size & 1);
  }
  return bytes.length > headerLimit ? null : 'more';
}

// 读取第一声道的一个采样，范围 -1~1。
function sample(view: DataView, position: number, format: Format): number {
  if (format.encoding === 'float') return format.bits === 32 ? view.getFloat32(position, true) : view.getFloat64(position, true);
  switch (format.bits) {
    case 8: return (view.getUint8(position) - 128) / 128;
    case 16: return view.getInt16(position, true) / 32768;
    case 24: return ((view.getUint8(position + 2) << 24 | view.getUint8(position + 1) << 16 | view.getUint8(position) << 8) >> 8) / 8388608;
    default: return view.getInt32(position, true) / 2147483648;
  }
}

/** 把一段按整帧对齐的 WAV 数据转成每声道一条 Float32 采样（最多两声道），供多轨混音按块读取。 */
export function wavFrames(bytes: Uint8Array, format: Format): Float32Array[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const frames = Math.floor(bytes.length / format.align);
  const count = Math.min(2, format.channels), step = format.bits / 8;
  const out = Array.from({ length: count }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) for (let c = 0; c < count; c++) out[c][i] = sample(view, i * format.align + c * step, format);
  return out;
}

// 已缓冲的数据会在微任务里连续交付，按时间片主动让出主线程，读取期间界面仍能响应。
const slice = 16;
const yieldFrame = () => new Promise(resolve => setTimeout(resolve, 0));

const concat = (a: Uint8Array, b: Uint8Array) => {
  if (!a.length) return b;
  const result = new Uint8Array(a.length + b.length); result.set(a); result.set(b, a.length);
  return result;
};

// 把音频分成 bins 段，返回每段的最大振幅（0~1）与时长。读取失败或格式无法处理时抛错，调用方不画波形即可。
export async function waveform(url: string, bins: number, signal?: AbortSignal): Promise<Waveform> {
  const response = await fetch(url, { signal });
  if (!response.ok || !response.body) throw new Error('@yovoice.error.audioReadFailed');
  const length = Number(response.headers.get('content-length')) || 0;
  const reader = response.body.getReader();
  try {
    let head: Uint8Array = new Uint8Array(0);
    let format: Format | 'more' | null = 'more';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      head = concat(head, value);
      format = parseWavHeader(head);
      if (format !== 'more') break;
    }
    if (format === 'more') throw new Error('@yovoice.error.audioReadFailed');
    if (!format) return await decodeSmall(reader, head, length, bins);
    // 边录边写的 WAV 可能没有填写数据长度，按文件长度推算。
    const available = length ? length - format.dataOffset : Infinity;
    const dataSize = format.dataSize && format.dataSize !== 0xffffffff ? Math.min(format.dataSize, available) : available;
    const frames = Math.floor(dataSize / format.align);
    if (!Number.isFinite(frames) || frames <= 0) throw new Error('@yovoice.error.audioReadFailed');
    const peaks = new Array<number>(bins).fill(0);
    const step = Math.max(1, Math.floor(frames / bins / samplesPerBin)), width = format.bits / 8;
    // rest 是尚未处理的数据字节，从数据区的 start 字节处开始；next 是下一个要取样的帧。
    let rest = head.subarray(format.dataOffset), start = 0, next = 0, since = performance.now();
    for (;;) {
      if (performance.now() - since > slice) { await yieldFrame(); since = performance.now(); }
      const view = new DataView(rest.buffer, rest.byteOffset, rest.byteLength);
      for (let position = next * format.align - start; next < frames && position + width <= rest.length; next += step, position += step * format.align) {
        const bin = Math.min(bins - 1, Math.floor(next * bins / frames));
        peaks[bin] = Math.max(peaks[bin], Math.abs(sample(view, position, format)));
      }
      if (next >= frames) break;
      const keep = Math.min(rest.length, next * format.align - start);
      rest = rest.subarray(keep); start += keep;
      const { done, value } = await reader.read();
      if (done) break;
      rest = concat(rest, value);
    }
    return { peaks: peaks.map(peak => Math.min(1, peak)), duration: frames / format.sampleRate };
  } finally { void reader.cancel().catch(() => undefined); }
}

// 其他格式：文件不大时读完整段解码，过大时直接放弃。
async function decodeSmall(reader: ReadableStreamDefaultReader<Uint8Array>, head: Uint8Array, length: number, bins: number): Promise<Waveform> {
  if (length > decodeLimit) throw new Error('@yovoice.error.audioReadFailed');
  const parts = [head];
  let size = head.length;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); size += value.length;
    if (size > decodeLimit) throw new Error('@yovoice.error.audioReadFailed');
  }
  const buffer = await decodeAudio(new Blob(parts as BlobPart[]));
  return { peaks: bufferPeaks(buffer, bins), duration: buffer.duration };
}

// 按目标段数合并峰值，每段取最大值，保留短促声音的轮廓。
export function resamplePeaks(peaks: number[], bins: number): number[] {
  if (peaks.length <= bins) return peaks;
  return Array.from({ length: bins }, (_, i) => {
    let peak = 0;
    for (let j = Math.floor(i * peaks.length / bins); j < Math.ceil((i + 1) * peaks.length / bins); j++) peak = Math.max(peak, peaks[j]);
    return peak;
  });
}
