import { useRef } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Grid } from '@astryxdesign/core/Grid';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Switch } from '@astryxdesign/core/Switch';
import { TextArea } from '@astryxdesign/core/TextArea';
import { useTranslator } from '@astryxdesign/core/i18n';
import { AudioLines, Play, Sparkles } from 'lucide-react';
import { formatTime, type Draft, type Generation, type UiLocale } from '../../shared/workbench';
import { createMusicDraft, lyricSections, styleTags } from './music-draft';
import { SongCover } from './song-cover';

const splitTags = (style: string) => style.split(/[,，]/).map(tag => tag.trim()).filter(Boolean);

// 音乐创作区：风格描述 + 标签、带段落标记的歌词，以及每次生成的版本封面。
export function MusicEditor({ draft, change, locale, takes, current, select }: {
  draft: Draft; change: (patch: Partial<Draft>) => void; locale: UiLocale;
  takes: Generation[]; current?: string; select: (take: Generation) => void;
}) {
  const t = useTranslator();
  const lyrics = useRef<HTMLTextAreaElement>(null);
  const tags = splitTags(draft.text);
  const toggleTag = (tag: string) => {
    const next = tags.includes(tag) ? tags.filter(item => item !== tag) : [...tags, tag];
    change({ text: next.join(', ').slice(0, 512) });
  };
  // 在光标处插入段落标记；标记单独占一行，便于 ACE-Step 识别结构。
  const insertSection = (section: string) => {
    const element = lyrics.current; const value = draft.lyrics ?? '';
    const start = element?.selectionStart ?? value.length, end = element?.selectionEnd ?? value.length;
    const before = value.slice(0, start);
    const tag = `${before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : ''}[${section}]\n`;
    change({ lyrics: (before + tag + value.slice(end)).slice(0, 4000) });
    requestAnimationFrame(() => { element?.focus(); element?.setSelectionRange(start + tag.length, start + tag.length); });
  };
  const empty = !draft.text.trim() && !draft.lyrics?.trim();
  return <VStack className="music-editor" gap={6}>
    <VStack gap={3}>
      <HStack hAlign="between" vAlign="center" gap={2} wrap="wrap">
        <h2>{t('@yovoice.music.style')}</h2>
        {empty ? <Button size="sm" variant="secondary" icon={<Sparkles />} label={t('@yovoice.music.example')} onClick={() => { const example = createMusicDraft(locale); change({ text: example.text, lyrics: example.lyrics, synthesisLanguage: example.synthesisLanguage, ...(draft.title === createMusicDraft(locale, false).title ? { title: example.title } : {}) }); }} /> : null}
      </HStack>
      <TextArea className="music-style" label={t('@yovoice.music.style')} isLabelHidden value={draft.text} maxLength={512} rows={2} hasSpellCheck={false} placeholder={t('@yovoice.music.stylePlaceholder')} onChange={text => change({ text: text.slice(0, 512) })} />
      <VStack gap={2} role="group" aria-label={t('@yovoice.music.tags')}>
        {(Object.keys(styleTags) as (keyof typeof styleTags)[]).map(group => <HStack key={group} gap={2} vAlign="center" wrap="wrap">
          <small className="music-tag-group">{t(`@yovoice.music.tagGroup.${group}`)}</small>
          {styleTags[group].map(tag => <Button key={tag} className="music-tag" size="sm" variant={tags.includes(tag) ? 'primary' : 'secondary'} aria-pressed={tags.includes(tag)} label={tag} onClick={() => toggleTag(tag)} />)}
        </HStack>)}
      </VStack>
    </VStack>
    <VStack gap={3}>
      <HStack hAlign="between" vAlign="center" gap={2} wrap="wrap">
        <h2>{t('@yovoice.music.lyrics')}</h2>
        <HStack gap={1} vAlign="center" wrap="wrap">
          {!draft.instrumental ? lyricSections.map(section => <Button key={section} className="music-section" size="sm" variant="ghost" label={`[${section}]`} tooltip={t('@yovoice.music.insertSection')} onClick={() => insertSection(section)} />) : null}
          <Switch label={t('@yovoice.music.instrumental')} size="sm" value={!!draft.instrumental} onChange={instrumental => change({ instrumental })} />
        </HStack>
      </HStack>
      {draft.instrumental
        ? <p className="music-instrumental">{t('@yovoice.music.instrumentalHint')}</p>
        : <TextArea ref={lyrics} className="music-lyrics" label={t('@yovoice.music.lyrics')} isLabelHidden value={draft.lyrics ?? ''} maxLength={4000} rows={14} hasSpellCheck={false} placeholder={t('@yovoice.music.lyricsPlaceholder')} onChange={value => change({ lyrics: value.slice(0, 4000) })} />}
    </VStack>
    <VStack gap={3}>
      <HStack hAlign="between" vAlign="center"><h2>{t('@yovoice.music.takes')}</h2>{takes.length ? <small>{t('@yovoice.music.takeCount', { count: takes.length })}</small> : null}</HStack>
      {takes.length ? <Grid columns={{ minWidth: 160 }} gap={4}>
        {takes.map((take, index) => <Button key={take.id} variant="ghost" className="music-take" aria-current={take.id === current ? 'true' : undefined} label={t('@yovoice.music.take', { n: takes.length - index })} onClick={() => select(take)}>
          <VStack gap={2} width="100%">
            <SongCover seed={take.id} animated={take.id === current} />
            <HStack hAlign="between" vAlign="center" gap={2}>
              <HStack gap={1} vAlign="center">{take.id === current ? <AudioLines size={14} aria-hidden /> : <Play size={14} aria-hidden />}<b>{t('@yovoice.music.take', { n: takes.length - index })}</b></HStack>
              <small className="music-take-duration">{formatTime(take.duration)}</small>
            </HStack>
            <small className="music-take-style">{take.settings.instrumental ? `${t('@yovoice.music.instrumental')} · ` : ''}{take.settings.text}</small>
          </VStack>
        </Button>)}
      </Grid> : <p className="music-empty">{t('@yovoice.music.noTakes')}</p>}
    </VStack>
  </VStack>;
}
