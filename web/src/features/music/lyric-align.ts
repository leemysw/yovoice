import type { AlignedWord } from '../../shared/workbench';
import { estimateWords, lyricTokens, syllables, type LyricLine, type LyricRow, type LyricWord } from './lyric-timing';

// 用音频给歌词定位：先找出有人声的片段，再按每行的音节数把歌词行对到这些片段上。
// 生成模型不返回逐句时间，这里只依赖混音后的音频，结果用于初始化播放页的歌词时间，仍可手动校准。

// 分析帧移（秒）、FFT 点数与人声频段（Hz）：人声的主要共振峰集中在这一段。
const frameSeconds = 0.02, fftSize = 512, vocalLow = 250, vocalHigh = 4000;
// 伴奏底噪按前后 floorWindow 秒内最安静的 floorQuantile 那部分帧估计；窗口要比一段连续演唱长，才能落到换气和间奏上。
const floorWindow = 10, floorQuantile = 0.1, minRise = 1;
// 片段整理：短于 minRun 的演唱视为乐器起音或鼓点，短于 gapFill 的停顿并入前后演唱；长于 longGap 的停顿算间奏。
const gapFill = 0.15, minRun = 0.3, longGap = 1.5;
// 对齐时短于 strongRun 的片段只按 weakWeight 计入。
const strongRun = 0.6, weakWeight = 0.3;
// 可信度门槛：较长的演唱片段至少占全曲 minStrong，平均每行代价不超过 maxCost，否则交给按时长估算。
const minStrong = 0.08, maxCost = 1.2;

export interface VocalActivity {
  step: number;
  // 每帧是否有人声。
  voiced: Uint8Array;
  // 有人声与无人声两类分得开的程度（0~1），太低时说明判断不可靠。
  separation: number;
  // 每帧居中人声频段能量（对数），逐字对齐时找起音用。
  energy: Float32Array;
}

// 原地基 2 FFT。
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = -2 * Math.PI / size, wr = Math.cos(angle), wi = Math.sin(angle);
    for (let start = 0; start < n; start += size) {
      let cr = 1, ci = 0;
      for (let k = 0; k < size / 2; k++) {
        const a = start + k, b = a + size / 2, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
}

const quantile = (sorted: ArrayLike<number>, p: number) => sorted[Math.floor(p * (sorted.length - 1))] ?? 0;

// 大津法求两类的分界，同时给出类间方差占比作为可信度。
function otsu(values: Float64Array) {
  let min = Infinity, max = -Infinity;
  for (const value of values) { min = Math.min(min, value); max = Math.max(max, value); }
  const bins = 100;
  if (!(max > min)) return { threshold: max, separation: 0 };
  const histogram = new Array<number>(bins).fill(0), width = (max - min) / bins;
  for (const value of values) histogram[Math.min(bins - 1, Math.floor((value - min) / width))]++;
  const total = values.length;
  let mean = 0; for (const value of values) mean += value / total;
  let variance = 0; for (const value of values) variance += (value - mean) ** 2 / total;
  let weight = 0, sum = 0, best = 0, threshold = min;
  for (let i = 0; i < bins; i++) {
    weight += histogram[i]; sum += histogram[i] * (min + (i + .5) * width);
    if (!weight || weight === total) continue;
    const m0 = sum / weight, m1 = (mean * total - sum) / (total - weight);
    const between = weight / total * (1 - weight / total) * (m0 - m1) ** 2;
    if (between > best) { best = between; threshold = min + (i + 1) * width; }
  }
  return { threshold, separation: variance > 0 ? best / variance : 0 };
}

// 逐帧判断有没有人声。人声通常在声像正中，伴奏铺得更开：只取中声道比侧声道多出来的那部分能量，
// 再减去前后几秒的伴奏底噪，高出底噪的地方才算在唱；单声道时退化为人声频段能量高出底噪。
export function vocalActivity(left: Float32Array, right: Float32Array, sampleRate: number): VocalActivity {
  // 先降到约 16 kHz，人声频段之外的细节用不上。
  const factor = Math.max(1, Math.floor(sampleRate / 16000)), rate = sampleRate / factor, length = Math.floor(left.length / factor);
  const mid = new Float32Array(length), side = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let l = 0, r = 0;
    for (let j = 0; j < factor; j++) { l += left[i * factor + j]; r += right[i * factor + j]; }
    mid[i] = (l + r) / (2 * factor); side[i] = (l - r) / (2 * factor);
  }
  const hop = Math.max(1, Math.round(rate * frameSeconds)), frames = Math.max(0, Math.floor((length - fftSize) / hop) + 1);
  const low = Math.ceil(vocalLow * fftSize / rate), high = Math.min(fftSize / 2 - 1, Math.floor(vocalHigh * fftSize / rate));
  const window = Float64Array.from({ length: fftSize }, (_, i) => .5 - .5 * Math.cos(2 * Math.PI * i / fftSize));
  const re = new Float64Array(fftSize), im = new Float64Array(fftSize), level = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    // 中、侧声道合成一个复数序列做一次 FFT，再按共轭对称拆开。
    for (let i = 0; i < fftSize; i++) { re[i] = mid[f * hop + i] * window[i]; im[i] = side[f * hop + i] * window[i]; }
    fft(re, im);
    let centred = 0;
    for (let k = low; k <= high; k++) {
      const ar = re[k], ai = im[k], br = re[fftSize - k], bi = im[fftSize - k];
      const m = ((ar + br) ** 2 + (ai - bi) ** 2) / 4, s = ((ai + bi) ** 2 + (br - ar) ** 2) / 4;
      centred += Math.max(0, m - s);
    }
    level[f] = Math.log(centred + 1e-10);
  }
  // 伴奏底噪：每 10 帧取一次前后 floorWindow 秒的低分位数，中间线性插值；也不低于整首较安静的水平，免得静音前奏里一点声音就算人声。
  const sortedAll = Float64Array.from(level).sort(), quiet = quantile(sortedAll, .2), span = Math.round(floorWindow / frameSeconds), stride = 10;
  const anchors: number[] = [];
  for (let f = 0; f < frames + stride; f += stride) {
    const slice = level.slice(Math.max(0, f - span), Math.min(frames, f + span + 1)).sort();
    anchors.push(Math.max(quiet, quantile(slice, floorQuantile)));
  }
  const rise = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    const a = Math.floor(f / stride), w = f / stride - a;
    rise[f] = level[f] - (anchors[a] * (1 - w) + (anchors[a + 1] ?? anchors[a]) * w);
  }
  // 约 0.2 秒的滑动平均，压掉单帧抖动。
  const radius = Math.round(.1 / frameSeconds), score = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0, count = 0;
    for (let j = Math.max(0, f - radius); j <= Math.min(frames - 1, f + radius); j++) { sum += rise[j]; count++; }
    score[f] = sum / count;
  }
  const { threshold, separation } = otsu(score);
  // 至少高出底噪 minRise（自然对数，约 4 dB）才算。
  const voiced = Uint8Array.from(score, value => value > Math.max(threshold, minRise) ? 1 : 0);
  // 先去掉过短的片段（鼓点），再填平短停顿，避免鼓点粘到相邻的演唱上。
  const fill = (state: number, limit: number) => {
    for (let i = 0; i < voiced.length;) {
      if (voiced[i] !== state) { i++; continue; }
      let j = i; while (j < voiced.length && voiced[j] === state) j++;
      if (i > 0 && j < voiced.length && (j - i) * frameSeconds < limit) voiced.fill(1 - state, i, j);
      i = j;
    }
  };
  fill(1, minRun); fill(0, gapFill);
  return { step: frameSeconds, voiced, separation, energy: Float32Array.from(level) };
}

// 歌词行的开始时间：动态规划在候选时间点里为每行选一个开始，让每行覆盖的演唱时长与音节数成比例，
// 行内少有长停顿，间奏落在段落之间。人声判断不可靠或歌词对不上时返回 null，由调用方退回按时长估算。
export function alignLyrics(rows: LyricRow[], activity: VocalActivity, duration: number): number[] | null {
  const { step, voiced, separation } = activity;
  if (!rows.length || separation < .4 || !(duration > 0)) return null;
  const runs: [number, number][] = [];
  for (let i = 0; i < voiced.length;) {
    if (!voiced[i]) { i++; continue; }
    let j = i; while (j < voiced.length && voiced[j]) j++;
    runs.push([i, j]); i = j;
  }
  // 短促的片段更可能是乐器的起音，只按 weakWeight 计入人声时长。
  const weight = new Float64Array(voiced.length);
  for (const [i, j] of runs) weight.fill((j - i) * step >= strongRun ? 1 : weakWeight, i, j);
  const prefix = new Float64Array(voiced.length + 1);
  weight.forEach((value, i) => { prefix[i + 1] = prefix[i] + value; });
  const frame = (time: number) => Math.max(0, Math.min(voiced.length, Math.round(time / step)));
  const voicedTime = (a: number, b: number) => (prefix[frame(b)] - prefix[frame(a)]) * step;
  const total = voicedTime(0, duration);
  const strong = runs.reduce((sum, [i, j]) => sum + ((j - i) * step >= strongRun ? (j - i) * step : 0), 0);
  if (strong < duration * minStrong || total > duration * .97) return null;
  // 每帧之前最近一段人声的结束时间，用来算一行唱完后的空白。
  const lastEnd = new Float64Array(voiced.length + 1);
  for (let i = 1; i <= voiced.length; i++) lastEnd[i] = voiced[i - 1] ? i * step : lastEnd[i - 1];
  // 演唱行从一段人声的开头开始；连着唱没有停顿时，在长片段内部每 0.6 秒补一个候选点（略加惩罚）。
  const sung: { time: number; penalty: number }[] = runs.map(([i, j]) => ({ time: i * step, penalty: (j - i) * step >= strongRun ? 0 : .5 }));
  for (const [i, j] of runs) for (let t = i * step + .6; t < j * step - .3; t += .6) sung.push({ time: t, penalty: .6 });
  sung.sort((a, b) => a.time - b.time);
  // 器乐间隔从一段人声结束处开始，后面停顿越短越不像间奏；歌曲开头也可以是器乐。
  const breaks = [{ time: 0, penalty: 0 }, ...runs.map(([, j], k) => ({ time: j * step, penalty: ((runs[k + 1]?.[0] ?? voiced.length) - j) * step >= longGap ? 0 : 1 }))];
  const beats = rows.map(row => row.instrumental ? 0 : Math.max(2, syllables(row.text)));
  const rate = total / beats.reduce((sum, value) => sum + value, 0);
  // 一行从 start 到下一行开始 end 的代价。
  const cost = (index: number, start: number, end: number) => {
    const row = rows[index], span = end - start, inside = voicedTime(start, end);
    // 器乐间隔里每秒人声都算错位；太短的间隔不像间奏。
    if (row.instrumental) return inside + (span < 2 ? 1 : 0);
    const expected = beats[index] * rate;
    const sungEnd = Math.max(start, Math.min(end, lastEnd[frame(end)])), pause = sungEnd - start - inside, trailing = end - sungEnd;
    const next = rows[index + 1], boundary = !next || next.instrumental || next.breakBefore;
    // 演唱时长与音节数不成比例、行内停顿太长、唱完后空太久（段落结尾可以长一些）都加代价。
    return 2 * Math.log((inside + .3) / (expected + .3)) ** 2
      + Math.max(0, pause - .8)
      + (boundary ? .15 * Math.max(0, trailing - 8) : .8 * Math.max(0, trailing - 1.2));
  };
  const candidates = rows.map((row, index) => row.instrumental ? (index === 0 ? [{ time: 0, penalty: 0 }] : breaks) : sung);
  // best[i][k]：前 i 行已排好、第 i 行从候选 k 开始时的最小代价。
  let best = candidates[0].map(c => ({ cost: c.penalty + (rows[0].instrumental ? 0 : .5 * voicedTime(0, c.time)), path: [c.time] }));
  for (let i = 1; i < rows.length; i++) {
    best = candidates[i].map(c => {
      let choice: { cost: number; path: number[] } | null = null;
      for (let k = 0; k < best.length; k++) {
        const previous = best[k], start = previous.path[previous.path.length - 1];
        if (start > c.time - .5 || !Number.isFinite(previous.cost)) continue;
        const value = previous.cost + cost(i - 1, start, c.time) + c.penalty;
        if (!choice || value < choice.cost) choice = { cost: value, path: previous.path };
      }
      return choice ? { cost: choice.cost, path: [...choice.path, c.time] } : { cost: Infinity, path: [c.time] };
    });
  }
  let result: { cost: number; path: number[] } | null = null;
  for (const option of best) {
    const value = option.cost + cost(rows.length - 1, option.path[option.path.length - 1], duration);
    if (Number.isFinite(value) && (!result || value < result.cost)) result = { cost: value, path: option.path };
  }
  return result && result.cost / rows.length <= maxCost ? result.path : null;
}

// 人声判断做过约 0.2 秒的滑动平均，片段结尾比实际收声晚约半个窗口，逐字分配时扣掉（秒）。
const smoothingLag = .1;

// 一行里逐字的时间。先按人声找出这一行实际在唱的部分（去掉行首行尾的空白），再在有人声的帧上按音节数分配，
// 行内的停顿基本不占字。伴奏里的鼓点同样落在声像正中，按能量起伏找字头并不可靠，所以只用人声片段。人声太少时退回按音节均分。
export function alignWords(line: LyricLine, activity: VocalActivity): LyricWord[] {
  const { step, voiced } = activity, tokens = lyricTokens(line.text);
  const total = tokens.reduce((sum, token) => sum + token.weight, 0);
  const frame = (time: number) => Math.max(0, Math.min(voiced.length, Math.round(time / step)));
  const a = frame(line.start), b = frame(line.end);
  let first = a, last = b, sung = 0;
  while (first < b && !voiced[first]) first++;
  while (last > first && !voiced[last - 1]) last--;
  for (let f = first; f < last; f++) sung += voiced[f];
  // 行首空白超过 1 秒多半是人声判断漏了，仍从行开始算。
  if (first - a > 1 / step) first = a;
  last = Math.max(first + tokens.length, last - Math.round(smoothingLag / step));
  if (!tokens.length || sung * step < Math.min(total * .12, (line.end - line.start) * .3)) return estimateWords(line);
  // 有人声的帧按 1 计，停顿按 0.2 计，避免一个字跨过长停顿。
  const cumulative = new Float64Array(last - first + 1);
  for (let f = first; f < last; f++) cumulative[f - first + 1] = cumulative[f - first] + (voiced[f] ? 1 : .2);
  const length = cumulative[last - first], starts: number[] = [];
  let weight = 0, cursor = 0;
  for (const token of tokens) {
    const target = weight / total * length;
    while (cursor < last - first && cumulative[cursor + 1] <= target) cursor++;
    starts.push(first + cursor);
    weight += token.weight;
  }
  return tokens.map((token, index) => {
    const start = starts[index], next = starts[index + 1] ?? last;
    // 字在下一字开始前的停顿处结束，至少保留一帧。
    let end = next;
    while (end > start + 1 && !voiced[end - 1]) end--;
    return { text: token.text, start: Math.max(line.start, start * step), end: Math.min(line.end, Math.max(end, start + 1) * step) };
  });
}

// 给演唱行补上逐字时间：人声判断可靠时按音频对齐，否则按音节均分。
export function withWords(lines: LyricLine[], activity?: VocalActivity): LyricLine[] {
  const usable = activity && activity.separation >= .4 ? activity : undefined;
  return lines.map(line => line.instrumental || !line.text ? line : { ...line, words: usable ? alignWords(line, usable) : estimateWords(line) });
}

// 对齐模型送入前会清洗歌词，只保留这些字符：ASCII 字母数字、撇号、中日韩文字、假名、谚文以及拉丁扩展、希腊、西里尔、泰文字母。
// 两边按同一套字符计数，结果才能一一对上。
const kept = /[A-Za-z0-9'\u00C0-\u02AF\u0370-\u03FF\u0400-\u052F\u0E00-\u0E7F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\u{20000}-\u{2CEAF}]/gu;
const letters = (text: string) => text.toLowerCase().match(kept)?.join('') ?? '';

// 把歌词对齐模型的逐字结果放回歌词行。模型可能把一个词拆开、把几个字合成一个词（日文、韩文常按词给时间），
// 所以先把每个词的时间按字数平分到每个字上，再按字的顺序对回逐字单元。字数有少量出入时按比例对应；
// 差得太多（歌词改过）时返回 null，交给自动定位或估算。
export function alignedTimeline(rows: LyricRow[], aligned: AlignedWord[], duration: number): LyricLine[] | null {
  const sung = rows.map(row => row.instrumental ? [] : lyricTokens(row.text).map(token => ({ text: token.text, size: [...letters(token.text)].length })));
  const total = sung.flat().reduce((sum, token) => sum + token.size, 0);
  const chars = aligned.filter(word => word.end >= word.start).flatMap(word => {
    const size = [...letters(word.word)].length, span = (word.end - word.start) / Math.max(1, size);
    return Array.from({ length: size }, (_, k) => ({ start: word.start + k * span, end: word.start + (k + 1) * span }));
  });
  if (!total || !chars.length || Math.abs(chars.length - total) > total * .1) return null;
  const at = (position: number) => chars[Math.min(chars.length - 1, Math.floor(position * chars.length / total))];
  let position = 0;
  const timed = sung.map(tokens => tokens.map(token => {
    // 没有可对齐文字的单元（纯符号）贴着下一个字。
    const first = at(position), last = token.size ? at(position + token.size - 1) : first;
    position += token.size;
    return { text: token.text, start: first.start, end: token.size ? Math.max(first.start, last.end) : first.start };
  }));
  const lines: LyricLine[] = [];
  rows.forEach((row, i) => {
    const words = timed[i];
    if (row.instrumental) { lines.push({ text: '', instrumental: true, start: 0, end: 0 }); return; }
    if (words.length) lines.push({ text: row.text, start: words[0].start, end: words.at(-1)!.end, words });
  });
  // 行一直显示到下一行开始；器乐间隔从上一句唱完开始。
  for (let i = 0; i < lines.length; i++) {
    const next = lines.slice(i + 1).find(line => !line.instrumental)?.start ?? duration;
    if (lines[i].instrumental) { lines[i].start = lines[i - 1]?.end ?? 0; lines[i].end = Math.max(lines[i].start, next); }
    else lines[i].end = lines[i + 1]?.instrumental ? lines[i].end : Math.max(lines[i].end, next);
  }
  // 第一句之前留出前奏，显示为省略号。
  return lines[0] && !lines[0].instrumental && lines[0].start > 1 ? [{ text: '', start: 0, end: lines[0].start, instrumental: true }, ...lines] : lines;
}
