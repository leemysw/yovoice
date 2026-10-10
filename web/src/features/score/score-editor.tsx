import { useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Switch } from '@astryxdesign/core/Switch';
import { Table, pixel, proportional } from '@astryxdesign/core/Table';
import { useTranslator } from '@astryxdesign/core/i18n';
import { ClipboardCopy, Download, Ellipsis, FileMusic, Sparkles, WandSparkles } from 'lucide-react';
import { Selector } from '../../shared/selector';
import { AIDialog } from '../../shared/ui/ai-dialog';
import { call, isDesktop } from '../../shared/lib/client';
import { formatTime, type Draft, type Score, type ScoreRole, type ScoreTrack, type State, type UiLocale } from '../../shared/workbench';
import { agentPrompt, exampleScore, noteCount, scoreBars, scoreDuration, scoreRoles, targetLevel } from './score-draft';
import { gmPrograms } from './score-instruments';
import { midiToScore, scoreToMidi } from './score-midi';
import { ScoreRoll } from './score-roll';

type Row = { index: number; track: ScoreTrack } & Record<string, unknown>;

// 浏览器预览只做最基本的结构检查，完整校验在保存时由 Go 完成。
function parseScore(text: string): Score {
  const value = JSON.parse(text) as Score;
  if (!value || typeof value.tempo !== 'number' || !Array.isArray(value.timeSignature) || !Array.isArray(value.tracks)) throw new Error('@yovoice.error.scoreInvalid');
  return value;
}

function download(data: BlobPart, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 编曲区：曲子概要、导入导出、按段落着色的音块总览，以及逐声部的音色和电平。
export function ScoreEditor({ draft, state, change, locale, onError, configureAI }: { draft: Draft; state: State; change: (patch: Partial<Draft>) => void; locale: UiLocale; onError: (error: string) => void; configureAI: () => void }) {
  const t = useTranslator();
  const score = draft.score!;
  const input = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [composing, setComposing] = useState(false);
  const notes = noteCount(score);
  const replace = (next: Score) => { setSelected(undefined); change({ score: next }); };
  const updateTrack = (id: string, patch: Partial<ScoreTrack>) => change({ score: { ...score, tracks: score.tracks.map(track => track.id === id ? { ...track, ...patch } : track) } });
  const fileName = (draft.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 100) || 'score');
  async function importScore() {
    if (!isDesktop) { input.current?.click(); return; }
    try { const next = await call<Score | null>('score.import'); if (next) replace(next); }
    catch (error) { onError((error as Error).message); }
  }
  async function exportScore(format: 'mid' | 'json') {
    try {
      if (isDesktop) { await call('score.export', { name: fileName, format, score }); return; }
      if (format === 'mid') download(scoreToMidi(score) as BlobPart, 'audio/midi', `${fileName}.mid`);
      else download(JSON.stringify(score, null, 2), 'application/json', `${fileName}.json`);
    } catch (error) { onError((error as Error).message); }
  }
  async function copyPrompt() {
    try { await navigator.clipboard.writeText(agentPrompt(locale, draft)); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch (error) { onError((error as Error).message); }
  }
  const aiButton = (size?: 'sm') => <Button size={size} variant={size ? 'secondary' : 'primary'} icon={<WandSparkles />} label={t('@yovoice.ai.scoreAction')} onClick={() => setComposing(true)} />;
  const summary = [score.key, `${score.tempo} BPM`, score.timeSignature.join('/'), t('@yovoice.score.barCount', { count: scoreBars(score) }), formatTime(scoreDuration(score))].filter(Boolean).join(' · ');
  const roleLabel = (role: ScoreRole) => t(`@yovoice.score.role.${role}`);
  return <VStack className="score-editor" gap={5}>
    <HStack hAlign="between" vAlign="center" gap={2} wrap="wrap">
      <VStack gap={0}><h2>{t('@yovoice.score.arrangement')}</h2><small className="score-summary">{summary}</small></VStack>
      <HStack gap={2} vAlign="center" wrap="wrap">
        {copied ? <small role="status">{t('@yovoice.score.promptCopied')}</small> : null}
        {notes ? aiButton('sm') : null}
        <DropdownMenu hasChevron alignment="end" button={{ size: 'sm', variant: 'secondary', icon: <Download />, label: t('@yovoice.score.export'), isDisabled: !notes }} items={[
          { id: 'mid', label: t('@yovoice.score.exportMidi'), onClick: () => void exportScore('mid') },
          { id: 'json', label: t('@yovoice.score.exportJson'), onClick: () => void exportScore('json') },
        ]} />
        <DropdownMenu hasChevron={false} alignment="end" button={{ size: 'sm', variant: 'ghost', isIconOnly: true, icon: <Ellipsis />, label: t('@yovoice.project.more') }} items={[
          { id: 'import', label: t('@yovoice.score.import'), icon: <FileMusic />, onClick: () => void importScore() },
          { id: 'prompt', label: t('@yovoice.score.copyPrompt'), icon: <ClipboardCopy />, onClick: () => void copyPrompt() },
        ]} />
      </HStack>
      <input ref={input} hidden type="file" accept=".mid,.midi,.json" aria-label={t('@yovoice.score.file')} onChange={async event => {
        const file = event.target.files?.[0]; event.target.value = '';
        if (!file) return;
        try {
          if (file.size > 4 * 1024 * 1024) throw new Error('@yovoice.error.scoreInvalid');
          const bytes = new Uint8Array(await file.arrayBuffer());
          replace(/\.json$/i.test(file.name) ? parseScore(new TextDecoder().decode(bytes)) : midiToScore(bytes, n => t('@yovoice.score.trackName', { n })));
        } catch (error) { onError(error instanceof SyntaxError ? '@yovoice.error.scoreInvalid' : (error as Error).message); }
      }} />
    </HStack>
    {notes ? <>
      <ScoreRoll score={score} selected={selected} select={setSelected} label={t('@yovoice.score.rollLabel', { tracks: score.tracks.length, notes })} />
      <VStack gap={3}>
        <HStack hAlign="between" vAlign="center"><h2>{t('@yovoice.score.tracks')}</h2><small>{t('@yovoice.score.trackHint')}</small></HStack>
        <Table<Row> className="score-tracks" density="compact" hasHover idKey={row => row.track.id} data={score.tracks.map((track, index) => ({ index, track }))} columns={[
          { key: 'name', header: t('@yovoice.score.trackColumn'), width: proportional(2), renderCell: ({ track }) => <HStack gap={2} vAlign="center" className={`score-track-name ${track.id === selected ? 'selected' : ''}`} onClick={() => setSelected(track.id)}>
            <span className={`score-role-dot ${track.role === 'melody' ? 'lead' : ''}`} aria-hidden="true" />
            <VStack gap={0}><b>{track.name}</b><small>{roleLabel(track.role ?? 'other')} · {t('@yovoice.score.noteCount', { count: track.notes.length })}</small></VStack>
          </HStack> },
          { key: 'program', header: t('@yovoice.score.instrument'), width: proportional(2), renderCell: ({ track }) => track.drums ? <small>{t('@yovoice.score.drumKit')}</small>
            : <Selector label={t('@yovoice.score.instrument')} isLabelHidden size="sm" width="100%" value={String(track.program)} options={gmPrograms.map((name, program) => ({ value: String(program), label: `${program} · ${name}` }))} onChange={value => updateTrack(track.id, { program: Number(value) })} /> },
          { key: 'role', header: t('@yovoice.score.roleColumn'), width: proportional(1), renderCell: ({ track }) => <Selector label={t('@yovoice.score.roleColumn')} isLabelHidden size="sm" width="100%" value={track.role ?? 'other'} options={scoreRoles.map(role => ({ value: role, label: roleLabel(role) }))} onChange={role => updateTrack(track.id, { role: role as ScoreRole, level: undefined })} /> },
          { key: 'level', header: t('@yovoice.score.level'), width: pixel(136), renderCell: ({ track }) => <label className="number-field compact"><input type="number" aria-label={t('@yovoice.score.levelOf', { name: track.name })} min={-60} max={0} step={1} value={targetLevel(track)} onChange={event => { const level = Number(event.target.value); if (level >= -60 && level < 0) updateTrack(track.id, { level }); }} />dB</label> },
          { key: 'mute', header: t('@yovoice.score.play'), width: pixel(72), renderCell: ({ track }) => <Switch label={t('@yovoice.score.playTrack', { name: track.name })} isLabelHidden size="sm" value={!track.mute} onChange={on => updateTrack(track.id, { mute: !on || undefined })} /> },
        ]} />
      </VStack>
    </> : <VStack className="score-empty" gap={3} hAlign="center">
      <p>{t('@yovoice.score.empty')}</p>
      <HStack gap={2} wrap="wrap" hAlign="center">
        {aiButton()}
        <Button variant="secondary" icon={<Sparkles />} label={t('@yovoice.score.example')} onClick={() => replace(exampleScore(locale))} />
        <Button variant="secondary" icon={<FileMusic />} label={t('@yovoice.score.import')} onClick={() => void importScore()} />
      </HStack>
    </VStack>}
    {composing ? <ScoreAIDialog state={state} locale={locale} seconds={notes ? Math.round(scoreDuration(score)) : 60} replace={replace} configure={configureAI} close={() => setComposing(false)} /> : null}
  </VStack>;
}

// AI 写谱：描述需求和时长，结果替换当前编曲。
function ScoreAIDialog({ state, locale, seconds: initial, replace, configure, close }: { state: State; locale: UiLocale; seconds: number; replace: (score: Score) => void; configure: () => void; close: () => void }) {
  const t = useTranslator();
  const [seconds, setSeconds] = useState(Math.min(Math.max(initial, 10), 600));
  return <AIDialog title={t('@yovoice.ai.scoreTitle')} hint={t('@yovoice.ai.scoreHint')} placeholder={t('@yovoice.ai.scorePlaceholder')} submitLabel={t('@yovoice.ai.scoreSubmit')} state={state} configure={configure} close={close}
    submit={async brief => replace(await call<Score>('ai.score', { brief, seconds, locale }))}>
    <label className="number-field">{t('@yovoice.ai.scoreSeconds')}<input type="number" min={10} max={600} step={5} value={seconds} onChange={event => { const value = Number(event.target.value); if (value >= 10 && value <= 600) setSeconds(value); }} /></label>
  </AIDialog>;
}
