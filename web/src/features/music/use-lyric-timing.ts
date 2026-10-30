import { useEffect, useEffectEvent, useMemo, useRef, useState, type RefObject } from 'react';
import { call, saveText } from '../../shared/lib/client';
import { noticeMessage } from '../../shared/lib/call-error';
import type { Activity, AlignedWord, Generation } from '../../shared/workbench';
import { alignLines, alignedTimeline, alignLyrics, withWords } from './lyric-align';
import { activeLyric, lyricRows, lyricTimeline, lyricsToLrc, type LyricLine } from './lyric-timing';
import { editableLines } from './lyric-word-editor';
import type { SongVoice } from './use-song-analysis';

// 校准时撤销一行后往回退的秒数，方便重新听到这一句的开头。
const undoRewind = 3;

export type LyricTiming = ReturnType<typeof useLyricTiming>;

// 播放页的歌词时间状态：歌词时间先按音频里的人声片段自动定位，判断不可靠时按时长估算；可以边听边逐行校准，校准结果随版本保存。
// 每行再按人声分出逐字时间；下载了歌词对齐模型时可以一键逐字对齐，结果随版本保存，和手动校准以最近一次为准；也可以逐字编辑。
// voice 是音频分析得到的人声片段；title 用于导出 LRC；读取、保存、对齐、导出失败都通过 setNotice 在页内提示。
export function useLyricTiming({ item, versions, title, voice, duration, time, audio, stage, aligner, activity, getAligner, seek, play, setNotice }: {
  item: Generation; versions: Generation[]; title: string; voice: SongVoice | null; duration: number; time: number;
  audio: RefObject<HTMLAudioElement | null>; stage: RefObject<HTMLElement | null>; aligner: boolean; activity?: Activity | null; getAligner?: () => void;
  seek: (value: number) => void; play: () => void; setNotice: (value: string) => void;
}) {
  const fail = (error: unknown) => setNotice(noticeMessage(error));
  // times 是已保存的校准时间；sync 是正在校准时已标记的行开始时间，null 表示不在校准。
  const [times, setTimes] = useState(item.lyricTimes);
  // 对齐模型给出的逐字时间，有它时优先使用。
  const [aligned, setAligned] = useState(item.lyricWords);
  const [sync, setSync] = useState<number[] | null>(null);
  // 逐字编辑中的歌词（含器乐段落）和正在编辑的行号，null 表示不在编辑；编辑结果实时显示在歌词上。
  const [edit, setEdit] = useState<LyricLine[] | null>(null);
  const [editLine, setEditLine] = useState(0);
  const lineClick = useRef<((index: number) => void) | null>(null);
  const lyrics = item.settings.instrumental ? '' : item.settings.lyrics ?? '';
  const rows = useMemo(() => lyricRows(lyrics), [lyrics]);
  const auto = useMemo(() => voice ? alignLyrics(rows, voice.activity, voice.duration) ?? undefined : undefined, [rows, voice]);
  // 逐字时间按音频里的人声片段分配；没有可靠的人声判断时按音节均分。
  const fromModel = useMemo(() => aligned?.length ? alignedTimeline(rows, aligned, duration) : null, [rows, aligned, duration]);
  const timeline = useMemo(() => fromModel ?? withWords(lyricTimeline(lyrics, duration, times ?? auto), voice?.activity), [fromModel, lyrics, duration, times, auto, voice]);
  // 校准时逐行显示，不补前奏；刚标记的一行视为当前句，下一行是待标记的目标。
  const lines: LyricLine[] = sync ? rows.map(row => ({ ...row, start: 0, end: 0 })) : edit ?? timeline;
  const current = sync ? sync.length - 1 : activeLyric(lines, time);
  const focus = sync ? Math.min(sync.length, lines.length - 1) : edit ? editLine : current;

  // 对齐在后台完成后版本记录随状态更新，这里同步最新结果。
  const saved = versions.find(entry => entry.id === item.id);
  const savedKey = saved ? JSON.stringify([saved.lyricWords ?? null, saved.lyricTimes ?? null]) : '';
  const syncSaved = useEffectEvent(() => { if (saved) { setAligned(saved.lyricWords); setTimes(saved.lyricTimes); } });
  useEffect(() => { syncSaved(); }, [savedKey]);
  const running = activity?.status === 'running', aligning = running && activity.task === 'align' && activity.projectId === item.settings.id;
  const alignNow = () => {
    if (!aligner) { getAligner?.(); return; }
    void call('generation.alignLyrics', { id: item.id, lines: alignLines(timeline, duration) }).catch(fail);
  };

  // 保存校准时间：成功后才更新本地状态并收起提示；失败时在页内提示，调用方据返回值决定是否退出校准。
  const save = (next: number[] | undefined) => call('generation.lyricTimes', { id: item.id, times: next ?? [] })
    .then(() => { setTimes(next); setAligned(undefined); setNotice(''); return true; }, (error: unknown) => { fail(error); return false; });
  // 逐字编辑从当前唱到的那一句开始；保存后与对齐结果一样记作逐字时间，替换逐行校准。
  const startEdit = () => {
    const draft = editableLines(timeline), at = activeLyric(draft, time);
    setEditLine(draft.findIndex((line, i) => i >= at && !line.instrumental && line.words?.length) >= 0 ? draft.findIndex((line, i) => i >= at && !line.instrumental && line.words?.length) : Math.max(0, draft.findIndex(line => !line.instrumental)));
    setEdit(draft); stage.current?.focus({ preventScroll: true });
  };
  const saveWords = (words: AlignedWord[]) => {
    void call('generation.lyricWords', { id: item.id, words }).then(() => { setAligned(words); setTimes(undefined); setEdit(null); setNotice(''); }, fail);
  };
  // 从头播放开始校准；开头是器乐段落时它从 0 秒开始，自动标好。
  const startSync = () => { setSync(rows[0]?.instrumental ? [0] : []); seek(0); void play(); stage.current?.focus({ preventScroll: true }); };
  // 标记下一行从当前播放位置开始；最后一行标完即保存，保存成功才退出校准，失败时标记都还在，可以撤销一行后重试。
  const mark = () => {
    if (!sync || !audio.current || sync.length >= rows.length) return;
    const next = [...sync, Math.max(audio.current.currentTime, sync.at(-1) ?? 0)];
    if (next.length < rows.length) { setSync(next); return; }
    setSync(next);
    void save(next).then(saved => { if (saved) setSync(null); });
  };
  // 按当前显示的歌词时间（校准、自动定位或估算）导出 LRC；words 为真时导出逐字时间。
  const exportLrc = (words = false) => { void saveText(lyricsToLrc(timeline, title, words), title, 'lrc').catch(fail); };
  const undo = () => {
    if (!sync?.length) return;
    const last = sync.at(-1)!;
    setSync(sync.slice(0, -1)); seek(last - undoRewind);
  };
  // 切换版本：换成新版本已保存的时间，退出校准和逐字编辑。
  const reset = (next: Generation) => { setTimes(next.lyricTimes); setAligned(next.lyricWords); setSync(null); setEdit(null); };

  return { times, sync, setSync, edit, setEdit, editLine, setEditLine, lineClick, rows, auto, fromModel, timeline, lines, current, focus, running, aligning, alignNow, save, startEdit, saveWords, startSync, mark, exportLrc, undo, reset };
}
