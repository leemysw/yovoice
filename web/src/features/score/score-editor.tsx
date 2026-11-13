import { useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { useTranslator } from '@astryxdesign/core/i18n';
import { Download, FileMusic, Headphones, Lightbulb, Upload } from 'lucide-react';
import { call, download, exportName, isDesktop } from '../../shared/lib/client';
import { noticeMessage } from '../../shared/lib/call-error';
import { formatTime, type Draft, type Score, type UiLocale } from '../../shared/workbench';
import { emptyScore, exampleScore, noteCount, scoreBars, scoreDuration } from './score-draft';
import { midiToScore, scoreToMidi } from './score-midi';
import { useHotkey, useHotkeyAria, useHotkeyText, withHotkey } from '../../shared/hotkeys/hotkeys';


// 浏览器预览只做最基本的结构检查，完整校验在保存时由 Go 完成。
function parseScore(text: string): Score {
  const value = JSON.parse(text) as Score;
  if (!value || typeof value.tempo !== 'number' || !Array.isArray(value.timeSignature) || !Array.isArray(value.tracks)) throw new Error('@yovoice.error.scoreInvalid');
  return value;
}

// 编曲区：曲子概要与导入导出、一句话交给 AI 写谱，以及 DAW 式的轨道视图（轨头调音色与电平，右侧音块对齐段落）。
// 编辑页常驻挂载、切走只隐藏，active 表示它此刻显示着，导入、导出、分轨试听的快捷键只在这时生效。
export function ScoreEditor({ draft, change, locale, onError, previewTracks, active }: { draft: Draft; change: (patch: Partial<Draft>) => void; locale: UiLocale; onError: (error: string) => void; previewTracks?: () => void; active: boolean }) {
  const t = useTranslator();
  const score = draft.score ?? emptyScore();
  const input = useRef<HTMLInputElement>(null);
  const notes = noteCount(score);
  const replace = (next: Score) => change({ score: next });
  const fileName = exportName(draft.title, 'score');
  async function importScore() {
    if (!isDesktop) { input.current?.click(); return; }
    try { const next = await call<Score | null>('score.import'); if (next) replace(next); }
    catch (error) { onError(noticeMessage(error)); }
  }
  async function exportScore(format: 'mid' | 'json') {
    try {
      if (isDesktop) { await call('score.export', { name: fileName, format, score }); return; }
      if (format === 'mid') download(new Blob([scoreToMidi(score) as BlobPart], { type: 'audio/midi' }), `${fileName}.mid`);
      else download(new Blob([JSON.stringify(score, null, 2)], { type: 'application/json' }), `${fileName}.json`);
    } catch (error) { onError(noticeMessage(error)); }
  }
  // 导出有 MIDI 与 JSON 两种格式，快捷键打开导出菜单。
  const [exportOpen, setExportOpen] = useState(false);
  const preview = previewTracks && notes ? previewTracks : undefined;
  useHotkey('score.import', () => void importScore(), { enabled: active });
  useHotkey('score.export', () => setExportOpen(true), { enabled: active && !!notes });
  useHotkey('score.stems', () => preview?.(), { enabled: active && !!preview });
  const importKeys = useHotkeyText('score.import'), exportKeys = useHotkeyText('score.export'), stemsKeys = useHotkeyText('score.stems');
  const importAria = useHotkeyAria('score.import'), exportAria = useHotkeyAria('score.export'), stemsAria = useHotkeyAria('score.stems');
  const summary = [score.key, `${score.tempo} BPM`, score.timeSignature.join('/'), t('@yovoice.score.barCount', { count: scoreBars(score) }), formatTime(scoreDuration(score))].filter(Boolean).join(' · ');
  return <VStack className="score-editor" gap={5}>
    <HStack hAlign="between" vAlign="center" gap={2} wrap="wrap">
      <VStack gap={0}><h2>{t('@yovoice.score.arrangement')}</h2><small className="score-summary">{summary}</small></VStack>
      <HStack gap={2} vAlign="center" wrap="wrap">
        <DropdownMenu hasChevron alignment="end" isMenuOpen={exportOpen} onOpenChange={setExportOpen} button={{ size: 'sm', variant: 'secondary', icon: <Download />, label: t('@yovoice.score.export'), tooltip: exportKeys ? withHotkey(t('@yovoice.score.export'), exportKeys) : undefined, 'aria-keyshortcuts': exportAria, isDisabled: !notes }} items={[
          { id: 'mid', label: t('@yovoice.score.exportMidi'), onClick: () => void exportScore('mid') },
          { id: 'json', label: t('@yovoice.score.exportJson'), onClick: () => void exportScore('json') },
        ]} />
        {preview ? <Button size="sm" variant="secondary" icon={<Headphones />} label={t('@yovoice.score.previewTracks')} tooltip={stemsKeys ? withHotkey(t('@yovoice.score.previewTracks'), stemsKeys) : undefined} aria-keyshortcuts={stemsAria} onClick={preview} /> : null}
        <Button size="sm" variant="secondary" icon={<Upload />} label={t('@yovoice.score.importShort')} tooltip={withHotkey(t('@yovoice.score.import'), importKeys)} aria-keyshortcuts={importAria} onClick={() => void importScore()} />
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
          <Button variant="secondary" icon={<FileMusic />} label={t('@yovoice.score.import')} aria-keyshortcuts={importAria} onClick={() => void importScore()} />
        </HStack>
      </VStack>}
  </VStack>;
}
