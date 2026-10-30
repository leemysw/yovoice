import type { SubtitleDocument } from '../../shared/workbench';
import { fileExtension } from '../../shared/lib/file-name';

const invalid = () => new Error('@yovoice.subtitle.invalid');

// 字幕只提供明确标注的人名，不从标点或台词内容猜测身份。
export class SubtitleParser {
  parse(name: string, content: string): SubtitleDocument {
    const extension = fileExtension(name);
    if (!['srt', 'vtt', 'ass', 'ssa'].includes(extension)) throw invalid();
    const result: SubtitleDocument = { speakers: [], cues: [] };
    const source = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
    const add = (start: number, end: number, text: string, name = '') => {
      text = this.clean(text);
      if (!text) return;
      name = this.clean(name);
      if (name.length > 120 || end <= start) throw invalid();
      let speaker = result.speakers.find(item => item.sourceName === name);
      if (!speaker) {
        speaker = { id: String(result.speakers.length + 1), sourceName: name };
        result.speakers.push(speaker);
      }
      result.cues.push({ id: crypto.randomUUID(), start, end, text, speakerId: speaker.id });
    };
    if (extension === 'ass' || extension === 'ssa') {
      let events = false;
      let fields: string[] = [];
      for (const line of source.split('\n')) {
        if (line.trim().startsWith('[')) events = line.trim().toLowerCase() === '[events]';
        if (!events) continue;
        if (/^Format:/i.test(line)) fields = line.slice(line.indexOf(':') + 1).split(',').map(v => v.trim().toLowerCase());
        if (!/^Dialogue:/i.test(line)) continue;
        if (!fields.includes('start') || !fields.includes('end') || fields.at(-1) !== 'text') throw invalid();
        const values = line.slice(line.indexOf(':') + 1).split(',');
        if (values.length < fields.length) throw invalid();
        const field = (key: string) => values[fields.indexOf(key)]?.trim() ?? '';
        // ASS 的文本列允许逗号；样式名称不等同于说话人。
        const text = values.slice(fields.length - 1).join(',').replace(/\{[^}]*\}/g, '').replace(/\\[Nn]/g, '\n').replace(/\\h/g, ' ');
        add(this.time(field('start')), this.time(field('end')), text, field('name') || field('actor'));
      }
    } else {
      for (const block of source.split(/\n[ \t]*\n/)) {
        const lines = block.split('\n');
        if (/^(WEBVTT(?:\s|$)|NOTE(?:\s|$)|STYLE(?:\s|$)|REGION(?:\s|$))/.test(lines[0])) continue;
        const index = lines.findIndex(line => line.includes('-->'));
        if (index < 0 || index > 1) throw invalid();
        const match = lines[index].match(/^(\S+)\s+-->\s+(\S+)(?:\s.*)?$/);
        if (!match) throw invalid();
        const start = this.time(match[1]); const end = this.time(match[2]);
        const text = lines.slice(index + 1).join('\n');
        const parts = text.split(/(<v(?:\.[^\s>]+)*\s+[^>]+>|<\/v>)/i);
        let voice = '';
        for (const part of parts) {
          const tag = part.match(/^<v(?:\.[^\s>]+)*\s+([^>]+)>$/i);
          if (tag) voice = tag[1];
          else if (/^<\/v>$/i.test(part)) voice = '';
          else add(start, end, part, voice);
        }
      }
    }
    if (!result.cues.length || result.cues.length > 2000 || result.speakers.length > 100 || result.cues.map(c => c.text).join('\n').length > 12000) throw invalid();
    result.cues.sort((a, b) => a.start - b.start);
    return result;
  }

  private time(value: string): number {
    const match = value.match(/^(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{2,3})$/);
    if (!match || +match[2] > 59 || +match[3] > 59) throw invalid();
    const ms = ((+(match[1] ?? 0) * 60 + +match[2]) * 60 + +match[3]) * 1000 + +(match[4].padEnd(3, '0'));
    if (!Number.isSafeInteger(ms) || ms > 86400000) throw invalid();
    return ms;
  }

  private clean(text: string): string {
    const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', nbsp: ' ', quot: '"', apos: "'", lrm: '', rlm: '' };
    return text.replace(/<[^>]*>/g, '').replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (match, entity: string) => {
      if (!entity.startsWith('#')) return entities[entity] ?? match;
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : +entity.slice(1);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }).trim();
  }
}
