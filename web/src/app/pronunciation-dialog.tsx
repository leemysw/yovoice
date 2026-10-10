import type { Dispatch, RefObject, SetStateAction } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useTranslator } from '@astryxdesign/core/i18n';
import { AppDialog } from '../shared/ui/app-dialog';
import type { Draft } from '../shared/workbench';

export type Pronunciation = { start: number; end: number; word: string; sound: string };

// 为选中的文字指定读音；IndexTTS 2.5 使用 <词|读音> 标注，其他模型直接替换文字。
export function PronunciationDialog({ pronunciation, setPronunciation, draft, change, editor }: { pronunciation: Pronunciation; setPronunciation: Dispatch<SetStateAction<Pronunciation | null>>; draft: Draft; change: (patch: Partial<Draft>) => void; editor: RefObject<HTMLTextAreaElement | null> }) {
  const t = useTranslator();
  return <AppDialog title={t('@yovoice.app.pronunciationTitle')} width={480} onClose={() => setPronunciation(null)} actions={<><Button label={t('@yovoice.action.cancel')} onClick={() => setPronunciation(null)} /><Button label={t('@yovoice.app.pronunciationApply')} variant="primary" isDisabled={!pronunciation.sound.trim()} onClick={() => { const { start, end, word, sound } = pronunciation; const replacement = draft.modelId.startsWith('index-2.5') ? `<${word}|${sound.trim()}>` : sound.trim(); change({ text: draft.text.slice(0, start) + replacement + draft.text.slice(end) }); setPronunciation(null); requestAnimationFrame(() => { editor.current?.focus(); editor.current?.setSelectionRange(start + replacement.length, start + replacement.length); }); }} /></>}><p>{t('@yovoice.app.pronunciationBody', { word: pronunciation.word })}</p><TextInput label={draft.modelId.startsWith('index-2.5') ? t('@yovoice.app.pronunciationLabel25') : t('@yovoice.app.pronunciationLabel')} value={pronunciation.sound} onChange={sound => setPronunciation({ ...pronunciation, sound })} placeholder={t('@yovoice.app.pronunciationPlaceholder')} /></AppDialog>;
}
