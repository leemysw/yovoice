import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { TextArea } from '@astryxdesign/core/TextArea';
import { useTranslator } from '@astryxdesign/core/i18n';
import { CircleAlert, FileMusic, ListMusic, LoaderCircle, Mic2, MoreHorizontal, Pause, Play, Undo2 } from 'lucide-react';
import { call, CallError, coverMelodyFile, saveText } from '../../shared/lib/client';
import { formatActivity, formatCallError, formatMelodyIssue } from '../../shared/i18n/format';
import { formatTime, type Draft, type MelodyInspection, type MelodyResult, type State } from '../../shared/workbench';
import { ScoreArrangement } from '../score/score-arrangement';
import { MelodyStaff } from './melody-staff';
import { useMelodyPreview } from './melody-preview';

const maxLength = 64 << 10;

type Notice = { kind: 'truncated' | 'cover' };
type View = 'staff' | 'tracks' | 'source';

// 谱面校验与换算只在 Go 里做一份：编辑稍停后请后端检查，返回概要、问题位置和换算出的轨道。
// 校验本身失败（服务不可用等）与谱面有问题不同：error 带回原因，界面说明无法校验，而不是悄悄当作没有谱。
function useInspection(abc: string) {
  const [inspection, setInspection] = useState<MelodyInspection | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (!abc.trim()) { setInspection(null); setError(null); return; }
    let live = true;
    const timer = setTimeout(() => {
      call<MelodyInspection>('melody.inspect', { abc }).then(value => { if (live) { setInspection(value); setError(null); } }, (e: unknown) => { if (live) { setInspection(null); setError(e); } });
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [abc]);
  return { inspection, error };
}

// 旋律谱：YuE2 先按歌词写出旋律与和弦（或从一首歌提取旋律做翻唱），在这里看轨道、改谱面或让创作助手改，
// 然后按谱生成整首歌。参照 YuE 官方的 ABC 方言：人声行带和弦、伴奏行写配器动机，两行成组。
export function MelodyScore({ draft, state, change, onError }: {
  draft: Draft; state: State; change: (patch: Partial<Draft>) => void; onError: (message: string) => void;
}) {
  const t = useTranslator();
  const abc = draft.abc ?? '';
  const { inspection, error: inspectError } = useInspection(abc);
  const [view, setView] = useState<View>('staff');
  const root = useRef<HTMLDivElement>(null);
  const anchor = useRef<{ element: HTMLElement; top: number } | null>(null);
  // WebKit 在替换视图内容时会把外层滚动区顶回上方（跳到歌词）；切换前记住滚动位置，换完后放回去。
  const switchView = (next: View) => {
    let element = root.current?.parentElement ?? null;
    while (element && !(element.scrollHeight > element.clientHeight && /auto|scroll/.test(getComputedStyle(element).overflowY))) element = element.parentElement;
    anchor.current = element ? { element, top: element.scrollTop } : null;
    setView(next);
  };
  useLayoutEffect(() => {
    const saved = anchor.current;
    if (!saved) return;
    const restore = () => { if (saved.element.scrollTop !== saved.top) saved.element.scrollTop = saved.top; };
    restore();
    const frame = requestAnimationFrame(restore);
    const timer = setTimeout(() => { restore(); anchor.current = null; }, 300);
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); };
  }, [view]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [tempo, setTempo] = useState('');
  const [selected, setSelected] = useState<string>();
  const audio = useRef<HTMLInputElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const activity = state.activity;
  const busy = activity?.status === 'running';
  // 出谱与扒谱占用生成通道，进度在这里显示；失败由全局通知说明。
  const working = busy && activity?.projectId === draft.id && activity.task === 'melody' ? activity : null;
  const pending = state.melody?.projectId === draft.id ? state.melody : undefined;
  useEffect(() => { setTempo(inspection?.tempo ? String(inspection.tempo) : ''); }, [inspection?.tempo]);

  // 操作失败走全局的错误提示，不在谱面区域插入提示条。
  const fail = (e: unknown) => onError(formatCallError(t, e));
  const attempt = async (job: () => Promise<unknown>) => { try { await job(); } catch (e) { fail(e); } };
  // 谱面改动的撤回记录：记下改之前的谱和改之后的谱；谱被别处改过（手改源码、Ocho 改谱）就作废，避免撤回覆盖新内容。
  const [undo, setUndo] = useState<{ before: string; after: string; action: string }[]>([]);
  useEffect(() => { setUndo(stack => stack.length && stack[stack.length - 1].after !== abc ? [] : stack); }, [abc]);
  const replace = (next: string, action: string) => {
    if (next === abc) return;
    setUndo(stack => [...stack.slice(-19), { before: abc, after: next, action }]);
    change({ abc: next });
  };
  const revert = () => {
    const last = undo[undo.length - 1];
    if (!last) return;
    setUndo(stack => stack.slice(0, -1));
    change({ abc: last.before }); setNotice(null);
  };
  const lastAction = undo.length ? undo[undo.length - 1].action : '';
  const undoButton = lastAction ? <Button size="sm" variant="ghost" isIconOnly icon={<Undo2 />} label={t('@yovoice.melody.undo', { action: lastAction })} tooltip={t('@yovoice.melody.undo', { action: lastAction })} onClick={revert} /> : null;
  const apply = (melody: MelodyResult) => {
    if (abc.trim()) replace(melody.abc, t('@yovoice.melody.replace')); else change({ abc: melody.abc });
    setNotice(melody.truncated ? { kind: 'truncated' } : melody.source === 'cover' ? { kind: 'cover' } : null);
    switchView('tracks');
    void call('melody.dismiss', { id: melody.id }).catch(fail);
  };
  // 作品里还没有谱时，写好的谱直接填入；已有谱时等用户决定是否替换。
  const settle = useEffectEvent(() => { if (pending && !abc.trim()) apply(pending); });
  useEffect(() => settle(), [pending?.id]);

  const transformLabel = { stripChords: '@yovoice.melody.stripChords', tempo: '@yovoice.melody.tempo', instrumental: '@yovoice.melody.toInstrumental' } as const;
  const transform = (op: 'stripChords' | 'tempo' | 'instrumental', value = 0) => attempt(async () => replace(await call<string>('melody.transform', { abc, op, tempo: value }), t(transformLabel[op])));
  const commitTempo = () => { const value = Number(tempo); if (inspection?.tempo && value && value !== inspection.tempo) void transform('tempo', value); else setTempo(inspection?.tempo ? String(inspection.tempo) : ''); };
  const plan = () => attempt(() => call('melody.plan', draft));
  // 试听：用已装的音色库把谱渲染成音频，在谱面里播放并显示进度，底部播放器留给歌曲。
  const preview = useMelodyPreview(abc, fail);
  const playing = preview.status === 'playing';
  const canPlan = !busy && !!draft.text.trim() && (draft.instrumental || !!draft.lyrics?.trim());
  // 谱里还有人声旋律时，菜单里可以把它转给乐器。
  const sung = !!inspection?.score?.tracks.some(track => track.id === 'vocal');
  const summary = inspection && !inspection.issue ? [inspection.key, inspection.meter?.join('/'), t('@yovoice.score.barCount', { count: inspection.bars ?? 0 }), formatTime(inspection.seconds ?? 0), t(inspection.chords ? '@yovoice.melody.withChords' : '@yovoice.melody.melodyOnly')].filter(Boolean).join(' · ') : '';
  const score = inspection?.score ? { ...inspection.score, tracks: inspection.score.tracks.map(track => ({ ...track, name: t(`@yovoice.melody.track.${track.id}`) })) } : undefined;

  const pickers = <>
    <input ref={audio} hidden type="file" accept="audio/*,.mp3,.wav,.flac,.m4a,.aac,.ogg,.opus" aria-label={t('@yovoice.melody.coverFile')} onChange={event => {
      const picked = event.target.files?.[0]; event.target.value = '';
      if (picked) void attempt(() => coverMelodyFile(draft.id, picked));
    }} />
    <input ref={file} hidden type="file" accept=".abc,.txt,text/plain" aria-label={t('@yovoice.melody.abcFile')} onChange={event => {
      const picked = event.target.files?.[0]; event.target.value = '';
      if (!picked) return;
      if (picked.size > maxLength) { fail(new CallError('@yovoice.error.melodyInvalid', { code: 'length' })); return; }
      void attempt(async () => { replace((await picked.text()).replace(/\r\n?/g, '\n'), t('@yovoice.melody.import')); setNotice(null); });
    }} />
  </>;
  const progress = working ? <HStack className="melody-progress" gap={2} vAlign="center" role="status">
    <LoaderCircle size={14} className="generation-spinner" aria-hidden="true" />
    <small className="grow">{formatActivity(t, working)}</small>
    <Button size="sm" label={t('@yovoice.action.cancel')} onClick={() => void attempt(() => call('operation.cancel'))} />
  </HStack> : null;

  return <VStack ref={root} className="music-block melody-score" gap={3}>
    {pickers}
    {/* 标题行与歌词区一致：左侧标题，右侧视图切换和「⋯」谱面操作。 */}
    <HStack vAlign="center" gap={2}>
      <h2 className="grow">{t('@yovoice.melody.title')}</h2>
      {abc.trim() ? <>
        {/* 视图切换和「⋯」谱面操作并成一个控件：共用底色和边框，中间一条细分隔。 */}
        <HStack className="melody-view-bar" gap={0} vAlign="center">
          <SegmentedControl label={t('@yovoice.melody.view')} size="sm" value={view} onChange={value => switchView(value as View)}>
            <SegmentedControlItem value="staff" label={t('@yovoice.melody.viewStaff')} />
            <SegmentedControlItem value="tracks" label={t('@yovoice.melody.viewTracks')} />
            <SegmentedControlItem value="source" label={t('@yovoice.melody.viewSource')} />
          </SegmentedControl>
          <DropdownMenu hasChevron={false} alignment="end" button={{ size: 'sm', variant: 'ghost', isIconOnly: true, icon: <MoreHorizontal />, label: t('@yovoice.melody.more'), tooltip: t('@yovoice.melody.more') }} items={[
            { id: 'plan', label: t('@yovoice.melody.replan'), isDisabled: !canPlan, onClick: () => void plan() },
            { id: 'cover', label: t('@yovoice.melody.cover'), isDisabled: busy, onClick: () => audio.current?.click() },
            { id: 'strip', label: t('@yovoice.melody.stripChords'), isDisabled: !inspection?.chords, onClick: () => void transform('stripChords') },
            { id: 'instrumental', label: t('@yovoice.melody.toInstrumental'), isDisabled: !sung, onClick: () => void transform('instrumental') },
            { id: 'import', label: t('@yovoice.melody.import'), onClick: () => file.current?.click() },
            { id: 'export', label: t('@yovoice.melody.export'), onClick: () => void attempt(() => saveText(abc, draft.title || 'melody', 'abc')) },
            { id: 'clear', label: t('@yovoice.melody.clear'), onClick: () => { replace('', t('@yovoice.melody.clear')); setNotice(null); } },
          ]} />
        </HStack>
      </> : null}
    </HStack>
    {/* 谱面信息行：试听、调号拍号等概要，右侧可直接改速度。 */}
    {abc.trim() ? <HStack className="melody-meta" vAlign="center" gap={2}>
      <Button size="sm" variant="secondary" isIconOnly className="melody-listen"
        icon={preview.status === 'rendering' ? <LoaderCircle className="generation-spinner" /> : playing ? <Pause /> : <Play />}
        label={t(preview.status === 'rendering' ? '@yovoice.melody.listening' : playing ? '@yovoice.melody.pause' : '@yovoice.melody.listen')}
        tooltip={t(preview.status === 'rendering' ? '@yovoice.melody.listening' : playing ? '@yovoice.melody.pause' : '@yovoice.melody.listen')}
        isDisabled={preview.status === 'rendering' || !!inspection?.issue} onClick={() => void preview.toggle()} />
      <small className="score-summary grow" title={summary}>{summary || ' '}</small>
      {undoButton}
      <label className="number-field compact melody-tempo" title={t('@yovoice.melody.tempo')}><input type="number" aria-label={t('@yovoice.melody.tempo')} min={30} max={300} step={1} value={tempo} disabled={!inspection?.tempo}
        onChange={event => setTempo(event.target.value)} onBlur={commitTempo} onKeyDown={event => { if (event.key === 'Enter') commitTempo(); }} /><small aria-hidden="true">BPM</small></label>
    </HStack> : null}

    {pending && abc.trim() ? <HStack className="melody-notice" data-tone="info" gap={3} vAlign="center" wrap="wrap" role="status">
      <VStack className="grow" gap={0}><b>{t(pending.source === 'cover' ? '@yovoice.melody.readyCover' : '@yovoice.melody.readyPlan')}</b><small>{t('@yovoice.melody.readyReplace')}</small></VStack>
      <Button size="sm" variant="ghost" label={t('@yovoice.ai.discard')} onClick={() => void call('melody.dismiss', { id: pending.id }).catch(fail)} />
      <Button size="sm" variant="primary" label={t('@yovoice.melody.replace')} onClick={() => apply(pending)} />
    </HStack> : null}

    {progress}

    {/* 还没有谱时只留三个来源按钮，不再放说明文字。 */}
    {!abc.trim() ? working ? null : <HStack className="melody-empty" gap={2} wrap="wrap" vAlign="center">
      <Button variant="primary" icon={<ListMusic />} label={t('@yovoice.melody.plan')} isDisabled={!canPlan} tooltip={canPlan ? undefined : t('@yovoice.melody.planNeeds')} onClick={() => void plan()} />
      <Button variant="secondary" icon={<Mic2 />} label={t('@yovoice.melody.cover')} isDisabled={busy} tooltip={t('@yovoice.melody.coverHint')} onClick={() => audio.current?.click()} />
      <Button variant="ghost" icon={<FileMusic />} label={t('@yovoice.melody.import')} onClick={() => file.current?.click()} />
      {undoButton}
    </HStack> : <>
      {notice ? <HStack className="melody-notice" data-tone={notice.kind === 'truncated' ? 'warning' : 'info'} gap={2} vAlign="start" role="status">
        <VStack className="grow" gap={0}>
          <small>{t(`@yovoice.melody.notice.${notice.kind}`)}</small>
        </VStack>
        <Button size="sm" variant="ghost" label={t('@yovoice.action.closeNotice')} onClick={() => setNotice(null)} />
      </HStack> : null}
      {inspection?.issue ? <HStack className="melody-notice" data-tone="danger" gap={2} vAlign="start" role="alert">
        <CircleAlert size={16} aria-hidden="true" />
        <VStack className="grow" gap={0}><b>{t('@yovoice.melody.invalid')}</b><small>{formatMelodyIssue(t, inspection.issue)}</small></VStack>
      </HStack> : inspectError ? <HStack className="melody-notice" data-tone="warning" gap={2} vAlign="start" role="alert">
        <CircleAlert size={16} aria-hidden="true" />
        <VStack className="grow" gap={0}><b>{t('@yovoice.melody.inspectFailed')}</b><small>{formatCallError(t, inspectError)}</small></VStack>
      </HStack> : null}
      {view === 'staff' && !inspection?.issue ? <MelodyStaff abc={abc} label={t('@yovoice.melody.viewStaff')} time={preview.time} active={preview.status !== 'idle'} seek={preview.seek} />
        : view === 'tracks' && score ? <ScoreArrangement readOnly score={score} selected={selected} select={setSelected} updateTrack={() => {}}
          playhead={preview.status !== 'idle' ? { time: preview.time, playing } : undefined} seek={preview.seek}
          label={t('@yovoice.melody.tracksLabel', { bars: inspection?.bars ?? 0 })} />
        : <TextArea className="melody-source" label={t('@yovoice.melody.source')} isLabelHidden value={abc} rows={16} hasSpellCheck={false}
          onChange={value => change({ abc: value.slice(0, maxLength) })} />}
    </>}
  </VStack>;
}
