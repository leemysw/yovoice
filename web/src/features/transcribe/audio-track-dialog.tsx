import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { useLocale, useTranslator } from '@astryxdesign/core/i18n';
import { Selector } from '../../shared/selector';
import { AppDialog } from '../../shared/ui/app-dialog';
import type { TranscribeTrack } from '../../shared/lib/client';

export function AudioTrackDialog({ name, tracks, onCancel, onSelect }: { name: string; tracks: TranscribeTrack[]; onCancel: () => void; onSelect: (track: number) => void }) {
  const t = useTranslator();
  const locale = useLocale();
  const [selected, setSelected] = useState(String((tracks.find(track => track.default) ?? tracks[0]).number));
  const languages = new Intl.DisplayNames([locale], { type: 'language' });
  const options = tracks.map(track => {
    const language = languageLabel(languages, track.language);
    const title = track.title?.slice(0, 100);
    return {
      value: String(track.number),
      label: [t('@yovoice.transcribe.audioTrack', { number: track.number }), title, language, track.codec?.toUpperCase(),
        track.default ? t('@yovoice.transcribe.defaultTrack') : ''].filter(Boolean).join(' · '),
    };
  });
  return <AppDialog title={t('@yovoice.transcribe.chooseTrack')} subtitle={name} width={520} onClose={onCancel} actions={<>
    <Button label={t('@yovoice.action.cancel')} onClick={onCancel} />
    <Button label={t('@yovoice.transcribe.startTrack')} variant="primary" onClick={() => onSelect(Number(selected))} />
  </>}>
    <Selector label={t('@yovoice.transcribe.chooseTrack')} isLabelHidden value={selected} options={options} onChange={setSelected} width="100%" />
  </AppDialog>;
}

function languageLabel(languages: Intl.DisplayNames, tag?: string): string {
  if (!tag || tag.toLowerCase() === 'und') return '';
  try { return languages.of(tag) ?? tag; }
  catch { return tag; }
}
