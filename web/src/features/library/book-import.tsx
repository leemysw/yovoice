import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useTranslator } from '@astryxdesign/core/i18n';
import { BookOpen, LoaderCircle, Settings2, UsersRound } from 'lucide-react';
import { AppDialog } from '../../shared/ui/app-dialog';
import { Selector } from '../../shared/selector';
import { call, CallError } from '../../shared/lib/client';
import { formatCallError } from '../../shared/i18n/format';
import { aiServiceHidden, createDraft, formatTime, type Draft, type State } from '../../shared/workbench';
import { Player } from '../media/player';
import { SpeakerAvatar } from '../create/subtitles';
import { bookDrafts, castRoles, manuscriptAccept, proposeCast, readManuscript, scriptChapters, type CastRole, type Manuscript, type ScriptChapter } from '../create/manuscript';

// AI 分角色的结果，与 Go 的 workbench.Cast 一致。
interface CastResult { lines: string[][]; roles: { name: string; gender: string; age: string; description: string }[]; voices: Record<string, string>; failed: number }

// 规则与 AI 都无法判断的对白归到这个说话人，方便在作品里一起改。
const unknownKey = '@unknown';

/**
 * 导入小说 / 有声书：选章节 → 分角色与选角 → 每章生成一个故事作品。
 * 规则识别离线完成；配置了 AI 服务时可让 AI 补全说话人和角色特征，并按特征从声音库选角。
 */
export function BookImport({ state, modelId, configureAI, create, onError }: {
  state: State; modelId?: string; configureAI: () => void; create: (drafts: Draft[], saved: Set<string>) => Promise<void>; onError: (error: string) => void;
}) {
  const t = useTranslator();
  const input = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [book, setBook] = useState<Manuscript | null>(null);
  async function open(file: File) {
    setLoading(true);
    try { setBook(await readManuscript(file)); }
    catch (error) { onError(formatCallError(t, error)); }
    finally { setLoading(false); }
  }
  return <>
    <Button size="sm" variant="secondary" icon={<BookOpen />} label={t('@yovoice.book.import')} isLoading={loading} onClick={() => input.current?.click()} />
    <input ref={input} hidden type="file" accept={manuscriptAccept} aria-label={t('@yovoice.book.file')} onChange={event => {
      const file = event.target.files?.[0]; event.target.value = '';
      if (file) void open(file);
    }} />
    {book ? <BookDialog key={book.title + book.chapters.length} book={book} state={state} modelId={modelId} configureAI={configureAI} create={create} close={() => setBook(null)} onError={onError} /> : null}
  </>;
}

// create 的第二个参数记录已入库的章节 id：逐章保存中途失败后再点创建，沿用同一批作品，已保存的不再重复创建。
function BookDialog({ book, state, modelId, configureAI, create, close, onError }: {
  book: Manuscript; state: State; modelId?: string; configureAI: () => void; create: (drafts: Draft[], saved: Set<string>) => Promise<void>; close: () => void; onError: (error: string) => void;
}) {
  const t = useTranslator();
  const characters = useMemo(() => state.characters ?? [], [state.characters]);
  const [step, setStep] = useState<'chapters' | 'cast'>('chapters');
  const [title, setTitle] = useState(book.title);
  // 书名页、版权页这类极短的部分默认不选。
  const [picked, setPicked] = useState(() => new Set(book.chapters.map((c, i) => c.text.length >= 20 || book.chapters.length === 1 ? i : -1).filter(i => i >= 0)));
  const [script, setScript] = useState<ScriptChapter[]>([]);
  const [roles, setRoles] = useState<CastRole[]>([]);
  const [cast, setCast] = useState<Record<string, string>>({});
  const [playing, setPlaying] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const chapterName = (title: string, index: number) => title || t('@yovoice.book.part', { n: index + 1 });
  const selected = book.chapters.map((c, i) => ({ ...c, title: chapterName(c.title, i) })).filter((_, i) => picked.has(i));
  const totalChars = selected.reduce((sum, c) => sum + c.text.length, 0);

  // 进入选角：规则拆句并识别说话人，按台词多少自动选角。
  function startCasting() {
    const next = scriptChapters(selected, unknownKey);
    const found = castRoles(next);
    setScript(next); setRoles(found); setStep('cast');
    setCast(proposeCast(['', ...found.filter(r => r.name !== unknownKey).map(r => r.name)], characters));
  }

  const task = state.aiTask?.kind === 'cast' ? state.aiTask : undefined;
  const provider = state.aiProviders?.find(p => p.id === state.aiProviderID);
  const elsewhere = state.aiTask?.status === 'running' && !task;
  async function runAI() {
    setError('');
    try {
      if (task && task.status !== 'running') await call('ai.dismiss', { id: task.id });
      await call('ai.cast', {
        title, locale: state.preferences.uiLocale,
        chapters: script.map(c => ({ title: c.title, lines: c.lines })),
        voices: characters.map(c => ({ id: c.id, name: c.name, description: [c.settings.voiceDescription, c.settings.emotionText].filter(Boolean).join('；') })),
      });
    } catch (e) { setError(formatCallError(t, e)); }
  }
  // AI 结果回来后覆盖说话人，合并角色特征，并以 AI 的选角建议重新分配（同名角色仍然优先）。
  const settle = useEffectEvent(() => {
    if (!task || task.status === 'running') return;
    if (task.status === 'completed') {
      const result = task.result as Partial<CastResult> | undefined;
      // 结果结构对不上（服务版本不一致或内容被截断）时按失败处理，不让界面崩掉。
      if (!Array.isArray(result?.lines) || !Array.isArray(result.roles)) setError(formatCallError(t, new CallError('@yovoice.error.unknown', { detail: 'cast result invalid' })));
      else {
        const next = script.map((c, ci) => ({ ...c, lines: c.lines.map((l, li) => l.quote ? { ...l, speaker: result.lines?.[ci]?.[li] ?? l.speaker } : l) }));
        const found = castRoles(next, result.roles.map(r => ({ ...r, lines: 0, sample: '' })));
        setScript(next); setRoles(found);
        setCast(proposeCast(['', ...found.filter(r => r.name !== unknownKey).map(r => r.name)], characters, result.voices ?? {}));
        if (result.failed) setError(t('@yovoice.book.aiPartial', { count: result.failed }));
      }
    } else if (task.status === 'failed') setError(formatCallError(t, task));
    void call('ai.dismiss', { id: task.id }).catch(e => setError(formatCallError(t, e)));
  });
  useEffect(() => settle(), [task?.status, task?.id]);
  const running = task?.status === 'running';
  function dismiss() {
    // 对话框随即关闭，取消失败只能走全局提示。
    if (running) void call('ai.cancel').catch(e => onError(formatCallError(t, e)));
    close();
  }

  // 上一次创建用的作品列表：内容没变时重试沿用同一批（id 不变），saved 里是其中已入库的章节。
  const attempt = useRef<{ key: string; drafts: Draft[]; saved: Set<string> } | null>(null);
  async function finish() {
    setBusy(true); setError('');
    try {
      const narrator = t('@yovoice.library.narrator');
      const named = script.map(c => ({ ...c, lines: c.lines.map(l => l.speaker === unknownKey ? { ...l, speaker: t('@yovoice.book.unknown') } : l) }));
      const assigned = Object.fromEntries(Object.entries(cast).map(([name, id]) => [name === unknownKey ? t('@yovoice.book.unknown') : name, id]));
      const name = title.trim() || book.title;
      const key = JSON.stringify([name, named, assigned, modelId, state.preferences.uiLocale]);
      if (attempt.current?.key !== key) attempt.current = { key, drafts: bookDrafts(name, named, assigned, characters, narrator, () => createDraft(false, state.preferences.uiLocale, modelId)), saved: new Set() };
      await create(attempt.current.drafts, attempt.current.saved);
      close();
    } catch (e) {
      const saved = attempt.current?.saved.size ?? 0;
      setError(saved ? `${formatCallError(t, e)} ${t('@yovoice.book.savedPartial', { count: saved })}` : formatCallError(t, e)); setBusy(false);
    }
  }

  const narration = script.flatMap(c => c.lines).filter(l => !l.speaker).length;
  const parts = useMemo(() => step === 'cast' ? bookDrafts('', script, {}, [], '', () => createDraft()).length : 0, [script, step]);
  const voiceOptions = [{ value: '', label: t('@yovoice.subtitle.currentSettings') }, ...characters.map(c => ({ value: c.id, label: c.name }))];
  const roleRow = (key: string, name: string, meta: string, sample: string) => {
    const character = characters.find(c => c.id === cast[key]);
    return <HStack key={key || '@narrator'} className="book-role" gap={3} vAlign="center" data-testid="book-role">
      {character?.preview ? <Player compact avatar={{ seed: character.id, label: t('@yovoice.book.listen', { name: character.name }), select: () => setPlaying(key) }} suspended={false} onError={setError}
        track={playing === key ? { id: character.preview.id, name: character.name, fileName: character.preview.fileName, kind: 'outputs', subtitle: '', playRequest: 1 } : null} />
        : <SpeakerAvatar seed={character?.id ?? `book:${name}`} />}
      <VStack gap={0} className="grow book-role-text">
        <HStack gap={2} vAlign="center"><b>{name}</b><small className="muted">{meta}</small></HStack>
        {sample ? <small className="muted book-role-sample">「{sample}」</small> : null}
      </VStack>
      <Selector size="sm" label={t('@yovoice.book.voiceFor', { name })} isLabelHidden width="calc(var(--spacing-10) * 4)" value={cast[key] ?? ''} options={voiceOptions}
        onChange={id => { setPlaying(''); setCast(current => { const next = { ...current }; if (id) next[key] = id; else delete next[key]; return next; }); }} />
    </HStack>;
  };

  if (step === 'chapters') return <AppDialog title={t('@yovoice.book.title')} width={640} onClose={dismiss} closeLabel={t('@yovoice.action.cancel')} error={error} actions={<>
    <Button label={t('@yovoice.action.cancel')} onClick={dismiss} />
    <Button label={t('@yovoice.book.next')} variant="primary" isDisabled={!picked.size} onClick={startCasting} />
  </>}>
    <TextInput label={t('@yovoice.book.name')} value={title} onChange={value => setTitle(value.slice(0, 120))} />
    <HStack gap={2} vAlign="center" hAlign="between">
      <CheckboxInput size="sm" label={t('@yovoice.book.chapters', { count: book.chapters.length })} value={picked.size === book.chapters.length ? true : picked.size ? 'indeterminate' : false}
        onChange={checked => setPicked(new Set(checked ? book.chapters.map((_, i) => i) : []))} />
      <small className="muted">{t('@yovoice.book.selected', { count: picked.size, chars: totalChars.toLocaleString() })}</small>
    </HStack>
    <VStack className="book-chapters" gap={0}>
      {book.chapters.map((chapter, index) => <HStack key={index} className="book-chapter" gap={3} vAlign="center" hAlign="between">
        <CheckboxInput size="sm" label={chapterName(chapter.title, index)} value={picked.has(index)} onChange={checked => setPicked(current => { const next = new Set(current); if (checked) next.add(index); else next.delete(index); return next; })} />
        <small className="muted">{t('@yovoice.app.charCount', { count: chapter.text.length })}</small>
      </HStack>)}
    </VStack>
  </AppDialog>;

  return <AppDialog title={t('@yovoice.book.cast')} width={720} onClose={dismiss} closeLabel={t('@yovoice.action.cancel')} busy={busy} error={error} actions={<>
    <Button label={t('@yovoice.book.back')} isDisabled={busy || running} onClick={() => { setStep('chapters'); setError(''); }} />
    <Button label={t('@yovoice.book.create', { count: parts })} variant="primary" isLoading={busy} isDisabled={running} onClick={() => void finish()} />
  </>}>
    <HStack className="book-cast-bar" gap={3} vAlign="center" wrap="wrap">
      <VStack gap={0} className="grow">
        <b>{t('@yovoice.book.summary', { chapters: script.length, roles: roles.filter(r => r.name !== unknownKey).length, lines: script.reduce((sum, c) => sum + c.lines.length, 0) })}</b>
        <small className="muted">{running && task ? t('@yovoice.book.aiRunning', { model: task.model, done: task.done ?? 0, total: task.total || '…', time: formatTime(Math.floor((Date.now() - Date.parse(task.startedAt)) / 1000)) }) : t('@yovoice.book.castHelp')}</small>
      </VStack>
      {aiServiceHidden(state.preferences) ? null : running ? <><LoaderCircle className="generation-spinner" size={16} aria-hidden /><Button size="sm" label={t('@yovoice.create.cancelGenerate')} onClick={() => void call('ai.cancel').catch(e => setError(formatCallError(t, e)))} /></>
        : provider?.model ? <Button size="sm" variant="secondary" icon={<UsersRound />} label={t('@yovoice.book.aiCast')} isDisabled={elsewhere} onClick={() => void runAI()} />
        : <Button size="sm" variant="secondary" icon={<Settings2 />} label={t('@yovoice.ai.configure')} onClick={() => { dismiss(); configureAI(); }} />}
    </HStack>
    {running && task?.total ? <progress className="ai-composer-progress" value={task.done ?? 0} max={task.total} aria-label={t('@yovoice.book.aiCast')} /> : null}
    <VStack className="book-roles" gap={0}>
      {roleRow('', t('@yovoice.library.narrator'), t('@yovoice.book.lines', { count: narration }), '')}
      {[...roles.filter(r => r.name !== unknownKey), ...roles.filter(r => r.name === unknownKey)].map(role => roleRow(role.name, role.name === unknownKey ? t('@yovoice.book.unknown') : role.name,
        [t('@yovoice.book.lines', { count: role.lines }), role.gender && role.gender !== 'unknown' ? t(`@yovoice.book.gender.${role.gender === 'female' ? 'female' : 'male'}`) : '', role.description ?? ''].filter(Boolean).join(' · '), role.sample))}
    </VStack>
  </AppDialog>;
}
