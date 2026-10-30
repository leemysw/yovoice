import { CallError } from '../../shared/lib/call-error';
import { fileExtension } from '../../shared/lib/file-name';
import type { Character, Draft, SubtitleDocument, SubtitleSpeaker } from '../../shared/workbench';
import { fileTitle, markdownText, readTextFile } from './file-import';
import { readEpub } from './epub';

// 整本文本（小说、有声书稿）导入为按章节拆分、按角色分配声音的故事作品。
export const manuscriptAccept = '.txt,.md,.markdown,.epub';
// 单个故事作品的正文与句数上限与后端一致，留出余量给用户后续编辑。
const partTextLimit = 11000;
const partCueLimit = 1800;
// 旁白长段按句切分，便于逐句重生成。
const narrationChunk = 160;

export interface ManuscriptChapter { title: string; text: string }
export interface Manuscript { title: string; chapters: ManuscriptChapter[] }
/** 一句台词：speaker 为空表示旁白；quote 标记引号内的对白。 */
export interface ScriptLine { text: string; quote: boolean; speaker: string }
export interface ScriptChapter { title: string; lines: ScriptLine[] }
/** 角色表的一项：AI 分角色时补全性别、年龄和声音描述。 */
export interface CastRole { name: string; lines: number; sample: string; gender?: string; age?: string; description?: string }

const chapterHeading = /^\s*(第[0-9０-９零〇一二两三四五六七八九十百千]+[章回节卷集部篇幕](?:\s|$|[:：、.．·\-—]).{0,40}|第[0-9０-９零〇一二两三四五六七八九十百千]+[章回节卷集部篇幕]|(?:chapter|part|book)\s+(?:\d+|[ivxlcdm]+|[a-z-]+)\b.{0,60}|(?:序章|序言|序|楔子|引子|前言|尾声|后记|终章|番外.{0,20}|prologue|epilogue|interlude)(?:\s.{0,40})?)\s*$/i;

/** 读取书稿：txt、Markdown 按标题行切章，EPUB 按阅读顺序取正文。 */
export async function readManuscript(file: File): Promise<Manuscript> {
  const type = fileExtension(file.name);
  const title = fileTitle(file.name);
  let chapters: ManuscriptChapter[];
  if (type === 'epub') {
    if (file.size > 32 * 1024 * 1024) throw new CallError('@yovoice.book.tooLarge');
    const book = await readEpub(new Uint8Array(await file.arrayBuffer()));
    chapters = book.chapters;
    if (book.title) return finish(book.title.slice(0, 120), chapters);
  } else if (['txt', 'md', 'markdown'].includes(type)) {
    const raw = await readTextFile(file, '@yovoice.book.tooLarge', 16 * 1024 * 1024);
    chapters = splitChapters(raw, title, type !== 'txt');
  } else throw new CallError('@yovoice.book.unsupported');
  return finish(title, chapters);
}

function finish(title: string, chapters: ManuscriptChapter[]): Manuscript {
  chapters = chapters.map(c => ({ title: c.title.trim().slice(0, 80), text: tidy(c.text) })).filter(c => c.text);
  if (!chapters.length) throw new CallError('@yovoice.import.empty');
  return { title, chapters };
}

function tidy(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/\u00a0|\u3000/g, ' ').split('\n').map(line => line.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** 按章节标题行切分纯文本；Markdown 还认一到三级标题。标题前的正文作为开篇。 */
export function splitChapters(source: string, title: string, markdown = false): ManuscriptChapter[] {
  const lines = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const chapters: ManuscriptChapter[] = [];
  let current: ManuscriptChapter = { title, text: '' };
  const body: string[] = [];
  const flush = () => { current.text = markdown ? markdownText(body.join('\n')) : body.join('\n'); chapters.push(current); body.length = 0; };
  for (const line of lines) {
    const heading = markdown ? /^\s{0,3}#{1,3}\s+(.+?)\s*#*\s*$/.exec(line)?.[1] : undefined;
    const plain = line.trim();
    if (heading || (plain.length <= 60 && chapterHeading.test(plain))) {
      flush();
      current = { title: (heading ?? plain).replace(/[*_`]/g, ''), text: '' };
    } else body.push(line);
  }
  flush();
  // 只有标题没有正文的卷名并入下一章标题。
  const merged: ManuscriptChapter[] = [];
  let prefix = '';
  for (const chapter of chapters) {
    if (!chapter.text.trim()) { if (chapter !== chapters[0]) prefix = chapter.title; continue; }
    merged.push(prefix && chapter.title !== title ? { ...chapter, title: `${prefix} ${chapter.title}` } : chapter);
    prefix = '';
  }
  return merged;
}

// 引号对：中文双引号、直角引号与英文直引号。
const quotePairs: Record<string, string> = { '“': '”', '「': '」', '『': '』', '"': '"', '«': '»' };
const speechVerb = /(说道|问道|答道|笑道|喊道|叫道|叹道|骂道|吼道|嚷道|哭道|应道|回答|插嘴|开口|嘀咕|嘟囔|喃喃|低语|补充|解释|反问|追问|说|道|问|答|喊|叫|嚷|叹|骂|吼)/;
const englishVerb = /\b(said|asked|replied|answered|shouted|cried|whispered|called|added|muttered|exclaimed|continued|began|says|asks|replies)\b/i;
// 第一人称叙述中“我”说的话由旁白来读。
const me = '@me';
const firstPerson = new Set(['我', 'i']);
const pronouns = new Set(['他', '她', '它', '你', '您', '他们', '她们', '它们', '我们', '你们', '咱们', '大家', '众人', '有人', '对方', '那人', '这人', '自己', 'he', 'she', 'i', 'you', 'they', 'we', 'it']);
// 主语和动词之间常见的状语、对象，剥掉后剩下的才是名字。
const modifiers = /(?:[一-龥]{2}地|[一-龥]{1,2}着|轻声|低声|大声|小声|高声|柔声|冷声|沉声|急忙|连忙|赶紧|赶忙|忙|又|也|便|就|还|才|只|却|都|再|突然|忽然|终于|立刻|马上|继续|接着|于是|然后|随即|一边|(?:对|向|朝|跟|和|冲)[一-龥]{1,6})$/;

/** 从一句叙述里找出说话人：取说话动词前的主语，剥掉状语和对象；代词视为未知。 */
function subjectOf(clause: string, known: Set<string>, after: boolean): string {
  clause = clause.trim();
  const english = englishVerb.exec(clause);
  if (english) {
    const before = clause.slice(0, english.index).trim().split(/\s+/).filter(Boolean);
    const behind = clause.slice(english.index + english[0].length).trim().split(/[\s,.;!?]+/).filter(Boolean);
    const name = (after && behind.length && /^[A-Z]/.test(behind[0]) ? behind.slice(0, 2).filter(w => /^[A-Z]/.test(w)).join(' ') : '') || before.slice(-2).filter(w => /^[A-Z]/.test(w)).join(' ');
    if (firstPerson.has(name.toLowerCase())) return me;
    return name && !pronouns.has(name.toLowerCase()) ? name.replace(/[^\p{L}\p{N} '-]/gu, '') : '';
  }
  const verb = speechVerb.exec(clause);
  if (!verb) return '';
  let head = clause.slice(0, verb.index).split(/[，,；;：:]/).pop()!.trim();
  // 已识别过的名字优先：取主语位置最靠前的那个。
  const hit = [...known].filter(name => head.includes(name)).sort((a, b) => head.indexOf(a) - head.indexOf(b) || b.length - a.length)[0];
  if (hit) return hit;
  for (let i = 0; i < 4 && modifiers.test(head); i++) head = head.replace(modifiers, '');
  head = head.replace(/^(?:这时|此时|于是|然后|接着|只听|只见|但|而|可|又|便)/, '');
  if (firstPerson.has(head)) return me;
  if (!/^[一-龥·]{1,6}$/.test(head) || pronouns.has(head)) return '';
  return head;
}

function chunkNarration(text: string): string[] {
  if (text.length <= narrationChunk) return [text];
  const sentences = text.match(/[^。！？!?；;…]+[。！？!?；;…]+["”」』]?|[^。！？!?；;…]+$/g) ?? [text];
  const chunks: string[] = [];
  for (const sentence of sentences) {
    const last = chunks.at(-1);
    if (last !== undefined && last.length + sentence.length <= narrationChunk) chunks[chunks.length - 1] = last + sentence;
    else chunks.push(sentence);
  }
  return chunks.map(s => s.trim()).filter(Boolean);
}

/** 把一段拆成旁白与引号对白交替的片段。 */
function segments(paragraph: string): { text: string; quote: boolean }[] {
  const parts: { text: string; quote: boolean }[] = [];
  let i = 0, start = 0;
  while (i < paragraph.length) {
    const close = quotePairs[paragraph[i]];
    if (close) {
      const end = paragraph.indexOf(close, i + 1);
      if (end > i + 1) {
        if (i > start) parts.push({ text: paragraph.slice(start, i), quote: false });
        parts.push({ text: paragraph.slice(i + 1, end), quote: true });
        i = start = end + 1; continue;
      }
    }
    i++;
  }
  if (start < paragraph.length) parts.push({ text: paragraph.slice(start), quote: false });
  return parts.map(p => ({ ...p, text: p.text.trim() })).filter(p => /[\p{L}\p{N}]/u.test(p.text));
}

/**
 * 规则分角色：引号内是对白，引号外是旁白；从“某某说：”“……”某某问道”这类叙述识别说话人。
 * 同一段里没有标注的对白沿用该段已识别的说话人；连续两段一来一回的对白按轮流推断。
 * 无法确定的对白 speaker 为 unknown，交给用户或 AI 补全。
 */
export function scriptChapters(chapters: ManuscriptChapter[], unknown: string): ScriptChapter[] {
  const known = new Set<string>();
  const parsed = chapters.map(chapter => chapter.text.split(/\n+/).map(p => p.trim()).filter(Boolean).map(segments));
  // 第一遍收集确定的名字，第二遍借助已知名字识别带状语的主语。
  for (const pass of [0, 1]) {
    const result = parsed.map((paragraphs, index) => {
      const lines: ScriptLine[] = [];
      const turns: { speaker: string; pure: boolean }[] = [];
      for (const parts of paragraphs) {
        const speakers = parts.map((part, j) => {
          if (!part.quote) return '';
          const before = parts[j - 1] && !parts[j - 1].quote ? parts[j - 1].text.split(/[。！？!?]/).pop()! : '';
          const after = parts[j + 1] && !parts[j + 1].quote ? parts[j + 1].text.split(/[。！？!?]/)[0] : '';
          return (/[：:，,]\s*$/.test(before) || englishVerb.test(before) ? subjectOf(before, known, false) : '') || subjectOf(after, known, true);
        });
        const found = speakers.find(Boolean) ?? '';
        const pure = parts.every(p => p.quote);
        const previous = turns.at(-1), earlier = turns.at(-2);
        // 纯对白段落：前两段是两个人一来一回时，这一段轮到更早的那位。
        const guess = !found && pure && previous?.speaker && earlier?.speaker && previous.speaker !== earlier.speaker ? earlier.speaker : '';
        const speaker = found || guess;
        if (parts.some(p => p.quote)) turns.push({ speaker, pure }); else turns.length = 0;
        parts.forEach((part, j) => {
          if (!part.quote) { for (const text of chunkNarration(part.text)) lines.push({ text, quote: false, speaker: '' }); return; }
          const name = speakers[j] || speaker;
          if (pass === 0 && name && name !== me) known.add(name);
          lines.push({ text: part.text, quote: true, speaker: name === me ? '' : name || unknown });
        });
      }
      return { title: chapters[index].title, lines };
    });
    if (pass === 1) return result;
  }
  return [];
}

/** 统计角色：按台词数排序，附一句示例台词用于试听选角。 */
export function castRoles(chapters: ScriptChapter[], previous: CastRole[] = []): CastRole[] {
  const roles = new Map<string, CastRole>();
  for (const line of chapters.flatMap(c => c.lines)) {
    if (!line.speaker) continue;
    const role = roles.get(line.speaker) ?? { ...previous.find(r => r.name === line.speaker), name: line.speaker, lines: 0, sample: '' };
    role.lines++;
    if (!role.sample || (role.sample.length < 8 && line.text.length > role.sample.length)) role.sample = line.text.slice(0, 80);
    roles.set(line.speaker, role);
  }
  return [...roles.values()].sort((a, b) => b.lines - a.lines);
}

/**
 * 自动选角：同名角色优先；AI 给出的建议次之；其余按台词多少依次分配尚未使用的角色，
 * 让主要角色尽量用不同的声音。旁白优先使用名字里带“旁白/叙述/narrator”的角色。
 */
export function proposeCast(roles: string[], characters: Character[], suggested: Record<string, string> = {}): Record<string, string> {
  const cast: Record<string, string> = {};
  const used = new Set<string>();
  const take = (role: string, id?: string) => { if (id && characters.some(c => c.id === id)) { cast[role] = id; used.add(id); } };
  for (const role of roles) take(role, characters.find(c => c.name.trim() === role)?.id);
  for (const role of roles) if (!cast[role]) take(role, suggested[role]);
  const narrator = roles[0];
  if (!cast[narrator]) take(narrator, characters.find(c => !used.has(c.id) && /旁白|叙述|讲述|narrat/i.test(c.name))?.id);
  for (const role of roles) if (!cast[role]) take(role, characters.find(c => !used.has(c.id))?.id);
  return cast;
}

/** 一章超过单个作品上限时按句切成几部分。 */
export function chapterParts(chapter: ScriptChapter): ScriptLine[][] {
  const parts: ScriptLine[][] = [[]];
  let length = 0;
  for (const line of chapter.lines) {
    const size = line.text.length + 1;
    if (parts.at(-1)!.length && (length + size > partTextLimit || parts.at(-1)!.length >= partCueLimit)) { parts.push([]); length = 0; }
    parts.at(-1)!.push({ ...line, text: line.text.slice(0, partTextLimit) });
    length += size;
  }
  return parts.filter(p => p.length);
}

/**
 * 生成故事作品：每章（或每章的一部分）一个，旁白和各角色成为说话人，
 * 已选角的说话人带上角色声音；时间只是按字数估算的占位，生成后以实际音频为准。
 */
export function bookDrafts(book: string, chapters: ScriptChapter[], cast: Record<string, string>, characters: Character[], narrator: string, base: () => Draft): Draft[] {
  const drafts: Draft[] = [];
  const width = String(chapters.length).length;
  chapters.forEach((chapter, index) => {
    const parts = chapterParts(chapter);
    parts.forEach((lines, part) => {
      const speakers = new Map<string, SubtitleSpeaker>();
      const speakerFor = (name: string) => {
        const key = name || narrator;
        let speaker = speakers.get(key);
        if (!speaker) {
          const character = characters.find(c => c.id === cast[name]);
          speaker = { id: crypto.randomUUID(), sourceName: key.slice(0, 120), ...(character ? { characterId: character.id, settings: structuredClone(character.settings) } : {}) };
          speakers.set(key, speaker);
        }
        return speaker;
      };
      speakerFor('');
      let time = 0;
      const cues = lines.map(line => {
        const start = time;
        time = Math.min(time + Math.max(1000, line.text.length * 220), 86400000);
        return { id: crypto.randomUUID(), start: Math.min(start, 86399999), end: Math.max(time, start + 1), text: line.text, speakerId: speakerFor(line.speaker).id };
      });
      const subtitles: SubtitleDocument = { speakers: [...speakers.values()], cues };
      // 章名缺失时用序号代替；作品列表的先后由保存顺序保证。
      const name = chapter.title && chapter.title !== book ? chapter.title : chapters.length > 1 ? String(index + 1).padStart(width, '0') : '';
      const suffix = parts.length > 1 ? ` (${part + 1}/${parts.length})` : '';
      drafts.push({ ...base(), kind: 'story', title: `${book}${name ? ' · ' : ''}${name}${suffix}`.slice(0, 120), text: cues.map(c => c.text).join('\n'), subtitles });
    });
  });
  return drafts;
}
