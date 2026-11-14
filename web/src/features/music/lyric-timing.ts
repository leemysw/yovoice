// 播放页的歌词时间轴。生成模型不返回逐句时间：校准过的版本按记录的时间显示，
// 否则按每句的音节数在整首时长里按比例分配；没有歌词的段落（如 [intro]、[instrumental]）当作器乐间隔，显示为省略号。
export interface LyricLine { text: string; start: number; end: number; instrumental?: boolean; words?: LyricWord[] }
// 逐字（拉丁文逐词）的时间，播放页逐字点亮、导出逐字 LRC 用。
export interface LyricWord { text: string; start: number; end: number }

// 估算一句的音节数：中日韩文字每字一拍，拉丁文按元音组计，其余符号不计。
export function syllables(line: string) {
  const cjk = line.match(/[぀-ヿ㐀-鿿가-힯]/g)?.length ?? 0;
  const latin = (line.match(/[\p{Script=Latin}']+/gu) ?? []).reduce((sum, word) => sum + Math.max(1, word.match(/[aeiouyàâäéèêëîïôöùûü]+/gi)?.length ?? 0), 0);
  return cjk + latin;
}

// 拆成逐字单元：中日韩每字一个，拉丁文每词一个；标点、空格并入前一个单元（句首的并入后一个），weight 是音节数。
export function lyricTokens(line: string) {
  const tokens: { text: string; weight: number }[] = [];
  let prefix = '';
  for (const part of line.match(/[぀-ヿ㐀-鿿가-힯]|[\p{Script=Latin}'\p{N}]+|[^぀-ヿ㐀-鿿가-힯\p{Script=Latin}'\p{N}]+/gu) ?? []) {
    const weight = syllables(part) || (/\p{N}/u.test(part) ? 1 : 0);
    if (weight) { tokens.push({ text: prefix + part, weight }); prefix = ''; }
    else if (tokens.length) tokens[tokens.length - 1].text += part;
    else prefix += part;
  }
  if (prefix) tokens.push({ text: prefix, weight: 1 });
  return tokens;
}

// 没有音频分析时的逐字时间：按音节数在这一行里均分，行尾留出换气；唱得比行短时按每拍约 0.3 秒收住，不把字拖到下一句。
export function estimateWords(line: LyricLine): LyricWord[] {
  const tokens = lyricTokens(line.text), total = tokens.reduce((sum, token) => sum + token.weight, 0), span = line.end - line.start;
  const sung = Math.min(span, Math.max(total * .3, span * .75));
  let at = 0;
  return tokens.map(token => {
    const start = line.start + at / total * sung; at += token.weight;
    return { text: token.text, start, end: line.start + at / total * sung };
  });
}

// 权重单位：每句至少 3 拍外加 1.5 拍换气；器乐段落 12 拍，段落之间 2 拍。
const instrumentalWeight = 12, sectionGap = 2, leadIn = 6, tail = 6;

type Item = { text: string; weight: number; instrumental?: boolean };

// 歌词里括号括起来的是给模型的注释（音效、乐器、唱法说明），不唱也不显示：[]、()、（）、【】里的内容连同括号去掉。
// 括号可以跨行，depth 是上一行结束时还没合上的层数；与后端对齐用的 sungLyrics 规则一致。
const opening = '[(（【', closing = '])）】';
function stripNotes(line: string, depth: number) {
  let text = '';
  for (const char of line) {
    if (opening.includes(char)) depth++;
    else if (closing.includes(char)) depth = Math.max(0, depth - 1);
    else if (!depth) text += char;
  }
  return { text: text.replace(/\s+/g, ' ').trim(), depth };
}

// 按段落拆出带权重的条目：演唱行、器乐间隔和段落之间的停顿。只有注释的行不算演唱行。
function lyricItems(lyrics: string) {
  const items: Item[] = [];
  let sectionLines = 0, sectionOpen = false, depth = 0;
  const closeSection = () => { if (sectionOpen && sectionLines === 0) items.push({ text: '', weight: instrumentalWeight, instrumental: true }); sectionOpen = false; sectionLines = 0; };
  for (const raw of lyrics.split('\n')) {
    const trimmed = raw.trim();
    if (!depth && /^\[[^\]]*\]$/.test(trimmed)) {
      closeSection();
      if (items.length) items.push({ text: '', weight: sectionGap });
      sectionOpen = true;
      continue;
    }
    const stripped = stripNotes(trimmed, depth);
    depth = stripped.depth;
    const line = stripped.text;
    if (!line) continue;
    sectionLines++;
    items.push({ text: line, weight: Math.max(3, syllables(line)) + 1.5 });
  }
  closeSection();
  return items;
}

// 播放页显示的行（演唱行与器乐间隔），校准时逐行记录开始时间；不含估算时补的前奏。
// breakBefore 标出新段落的第一行，音频对齐时段落之间允许较长的间奏。
export interface LyricRow { text: string; instrumental?: boolean; breakBefore?: boolean }
export function lyricRows(lyrics: string) {
  const rows: LyricRow[] = [];
  let pending = false;
  for (const item of lyricItems(lyrics)) {
    if (!item.text && !item.instrumental) { pending = true; continue; }
    rows.push({ text: item.text, ...(item.instrumental ? { instrumental: true } : {}), ...(pending && rows.length ? { breakBefore: true } : {}) });
    pending = false;
  }
  return rows;
}

// times 是校准过的每行开始时间，行数对得上时直接使用，否则按音节估算。
export function lyricTimeline(lyrics: string, duration: number, times?: number[]): LyricLine[] {
  const items = lyricItems(lyrics);
  if (!items.some(item => item.text) || !(duration > 0)) return [];
  const rows = lyricRows(lyrics);
  if (times?.length === rows.length) {
    const lines = rows.map(({ text, instrumental }, index) => ({ text, ...(instrumental ? { instrumental } : {}), start: times[index], end: times[index + 1] ?? duration }));
    // 第一句之前留出前奏，显示为省略号。
    return times[0] > 1 && !rows[0].instrumental ? [{ text: '', start: 0, end: times[0], instrumental: true }, ...lines] : lines;
  }
  // 歌曲通常有前奏和尾奏：开头不是器乐段落时补一段前奏，结尾同理补尾奏。
  if (!items[0].instrumental) items.unshift({ text: '', weight: leadIn, instrumental: true });
  if (!items[items.length - 1].instrumental) items.push({ text: '', weight: tail });
  const unit = duration / items.reduce((sum, item) => sum + item.weight, 0);
  const lines: LyricLine[] = [];
  let at = 0;
  for (const item of items) {
    const start = at; at += item.weight * unit;
    // 段落间隔并入上一句；器乐间隔单独占一行。
    if (item.text || item.instrumental) lines.push({ text: item.text, start, end: at, ...(item.instrumental ? { instrumental: true } : {}) });
    else if (lines.length) lines[lines.length - 1].end = at;
  }
  return lines;
}

// 当前时间所在的行：最后一个已开始的行。
export const activeLyric = (lines: LyricLine[], time: number) => {
  let index = -1;
  for (let i = 0; i < lines.length && lines[i].start <= time; i++) index = i;
  return index;
};

// LRC 时间标签 [mm:ss.xx]：先取整到百分之一秒再进位，超过 99 分钟时分钟位照常增长。
export function lrcTime(seconds: number) {
  const total = Math.max(0, Math.round(seconds * 100));
  return `[${String(Math.floor(total / 6000)).padStart(2, '0')}:${String(Math.floor(total / 100) % 60).padStart(2, '0')}.${String(total % 100).padStart(2, '0')}]`;
}

// 按播放页的歌词时间导出 LRC：段落标记行已在拆行时去掉；器乐间隔写成空行让播放器清掉上一句，开头的前奏不写。
// words 为真时导出逐字 LRC（增强格式）：行内每个字前加 <mm:ss.xx>，行尾再加一个结束时间。
export function lyricsToLrc(lines: LyricLine[], title?: string, words = false) {
  const wordTag = (seconds: number) => `<${lrcTime(seconds).slice(1, -1)}>`;
  const out = title?.trim() ? [`[ti:${title.trim().replace(/[\r\n\]]/g, ' ')}]`] : [];
  let clear = false;
  for (const line of lines) {
    if (line.instrumental) { if (clear) out.push(lrcTime(line.start)); clear = false; continue; }
    const text = words && line.words?.length ? `${line.words.map(word => wordTag(word.start) + word.text).join('')}${wordTag(line.words.at(-1)!.end)}` : line.text;
    out.push(`${lrcTime(line.start)}${text}`); clear = true;
  }
  return `${out.join('\n')}\n`;
}
