import { useRef } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { useTranslator } from '@astryxdesign/core/i18n';
import { Download, FileMusic, Lightbulb, Upload } from 'lucide-react';
import { call, isDesktop } from '../../shared/lib/client';
import { noticeMessage } from '../../shared/lib/call-error';
import { formatTime, type Draft, type Score, type UiLocale } from '../../shared/workbench';
import { emptyScore, exampleScore, noteCount, scoreBars, scoreDuration } from './score-draft';
import { midiToScore, scoreToMidi } from './score-midi';


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

// 编曲区：曲子概要与导入导出、一句话交给 AI 写谱，以及 DAW 式的轨道视图（轨头调音色与电平，右侧音块对齐段落）。
export function ScoreEditor({ draft, change, locale, onError }: { draft: Draft; change: (patch: Partial<Draft>) => void; locale: UiLocale; onError: (error: string) => void }) {
  const t = useTranslator();
  const score = draft.score ?? emptyScore();
  const input = useRef<HTMLInputElement>(null);
  const notes = noteCount(score);
  const replace = (next: Score) => change({ score: next });
  const fileName = (draft.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 100) || 'score');
  async function importScore() {
    if (!isDesktop) { input.current?.click(); return; }
    try { const next = await call<Score | null>('score.import'); if (next) replace(next); }
    catch (error) { onError(noticeMessage(error)); }
  }
  async function exportScore(format: 'mid' | 'json') {
    try {
      if (isDesktop) { await call('score.export', { name: fileName, format, score }); return; }
      if (format === 'mid') download(scoreToMidi(score) as BlobPart, 'audio/midi', `${fileName}.mid`);
      else download(JSON.stringify(score, null, 2), 'application/json', `${fileName}.json`);
    } catch (error) { onError(noticeMessage(error)); }
  }
  const summary = [score.key, `${score.tempo} BPM`, score.timeSignature.join('/'), t('@yovoice.score.barCount', { count: scoreBars(score) }), formatTime(scoreDuration(score))].filter(Boolean).join(' · ');
  return <VStack className="score-editor" gap={5}>
    <HStack hAlign="between" vAlign="center" gap={2} wrap="wrap">
      <VStack gap={0}><h2>{t('@yovoice.score.arrangement')}</h2><small className="score-summary">{summary}</small></VStack>
      <HStack gap={2} vAlign="center" wrap="wrap">
        <DropdownMenu hasChevron alignment="end" button={{ size: 'sm', variant: 'secondary', icon: <Download />, label: t('@yovoice.score.export'), isDisabled: !notes }} items={[
          { id: 'mid', label: t('@yovoice.score.exportMidi'), onClick: () => void exportScore('mid') },
          { id: 'json', label: t('@yovoice.score.exportJson'), onClick: () => void exportScore('json') },
        ]} />
        <Button size="sm" variant="secondary" icon={<Upload />} label={t('@yovoice.score.importShort')} tooltip={t('@yovoice.score.import')} onClick={() => void importScore()} />
      </HStack>
      <input ref={input} hidden type="file" accept=".mid,.midi,.json" aria-label={t('@yovoice.score.file')} onChange={async event => {
        const file = event.target.files?.[0]; event.target.value = '';
        if (!file) return;
        try {
          if (file.size > 4 * 1024 * 1024) throw new Error('@yovoice.error.scoreInvalid');
          const bytes = new Uint8Array(await file.arrayBuffer());
          replace(/\.json$/i.test(file.name) ? parseScore(new TextDecoder().decode(bytes)) : midiToScore(bytes, n => t('@yovoice.score.trackName', { n })));
        } catch (error) { onError(error instanceof SyntaxError ? '@yovoice.error.scoreInvalid' : noticeMessage(error)); }
      }} />
    </HStack>
    {notes ? null
      : <VStack className="score-empty" gap={3} hAlign="center">
        <p>{t('@yovoice.score.empty')}</p>
        <HStack gap={2} wrap="wrap" hAlign="center">
          <Button variant="secondary" icon={<Lightbulb />} label={t('@yovoice.score.example')} onClick={() => replace(exampleScore(locale))} />
          <Button variant="secondary" icon={<FileMusic />} label={t('@yovoice.score.import')} onClick={() => void importScore()} />
        </HStack>
      </VStack>}
  </VStack>;
}
