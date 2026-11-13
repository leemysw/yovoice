import { useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { TextArea } from '@astryxdesign/core/TextArea';
import { Token } from '@astryxdesign/core/Token';
import { useTranslator } from '@astryxdesign/core/i18n';
import { ImagePlus, Lightbulb, LoaderCircle, Maximize2 } from 'lucide-react';
import { call, isDesktop } from '../../shared/lib/client';
import { formatCallError } from '../../shared/i18n/format';
import { AppDialog } from '../../shared/ui/app-dialog';
import { isStableAudio, isUntitled, isYuE, musicStyleLimit, type Draft, type State, type UiLocale } from '../../shared/workbench';
import { createMusicDraft, instrumentalSections, lyricSections, splitTags } from './music-draft';
import { MelodyScore } from './melody-score';
import { overflowTitle } from '../../shared/ui/overflow-title';
import { composing, useHotkey, useHotkeyAria, useHotkeyText, withHotkey } from '../../shared/hotkeys/hotkeys';

// 音乐创作区：从上到下是“风格 → 歌词”，生成的版本在“版本记录”里查看；让 AI 写风格和歌词走创作助手。
// 纯音乐与填写歌词是并列的两种模式。YuE2 还可以先出旋律谱、改谱后再生成。
// 编辑页常驻挂载、切走只隐藏，active 表示它此刻显示着，快捷键只在这时生效。
export function MusicEditor({ draft, state, change, locale, onError, active }: {
  draft: Draft; state: State; change: (patch: Partial<Draft>) => void; locale: UiLocale; onError: (message: string) => void; active: boolean;
}) {
  const t = useTranslator();
  // YuE2 的纯音乐先出谱，再把人声旋律交给乐器演奏；歌词可留空，或只写段落标记安排结构。
  const yue = isYuE(draft.modelId);
  // Stable Audio 只读英文描述生成纯音乐或音效，没有歌词。
  const stable = isStableAudio(draft.modelId);
  const sfx = stable && draft.modelId.includes('-sfx-');
  const lyrics = useRef<HTMLTextAreaElement>(null);
  const expandedLyrics = useRef<HTMLTextAreaElement>(null);
  // 歌词框在 YuE2 下收矮，让下方旋律谱露出来；需要细看或长段编辑时放大到对话框里。
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputVal, setInputVal] = useState('');
  const tags = splitTags(draft.text);
  // 看图取风格：图片先缩到 1024 像素以内再交给接入的 AI 服务，读出的英文风格标签并进风格栏。
  const imageInput = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const styleFromImage = async (file: File) => {
    setReading(true);
    try {
      const base64 = await shrinkImage(file);
      const result = await call<{ tags: string[] }>('music.styleFromImage', { mediaType: 'image/jpeg', base64, language: locale });
      const next = [...tags, ...result.tags.filter(tag => !tags.some(item => item.toLowerCase() === tag.toLowerCase()))];
      change({ text: next.join(', ').slice(0, musicStyleLimit(draft.modelId)) });
    } catch (e) { onError(formatCallError(t, e)); } finally { setReading(false); }
  };

  const toggleTag = (tag: string) => {
    const next = tags.includes(tag) ? tags.filter(item => item !== tag) : [...tags, tag];
    change({ text: next.join(', ').slice(0, musicStyleLimit(draft.modelId)) });
  };
  const addTag = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const newItems = splitTags(trimmed);
    const combined = Array.from(new Set([...tags, ...newItems]));
    change({ text: combined.join(', ').slice(0, musicStyleLimit(draft.modelId)) });
    setInputVal('');
  };
  // 输入法组字时的回车是确认候选，不能把还没上屏的拼音当成标签加进去。
  // 只处理不带 ⌘/Ctrl、⌥ 的按键：⌘↩ / Ctrl+Enter（生成）、⌘,（设置）这类组合交给快捷键。
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (composing(e.nativeEvent) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
      e.preventDefault();
      addTag(inputVal);
    } else if (e.key === 'Backspace' && !inputVal && tags.length > 0) {
      change({ text: tags.slice(0, -1).join(', ') });
    }
  };
  const handleBlur = () => {
    if (inputVal.trim()) {
      addTag(inputVal);
    }
  };
  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    if (text.includes(',') || text.includes('，') || text.includes('\n')) {
      e.preventDefault();
      addTag(text);
    }
  };
  // 在光标处插入段落标记；标记单独占一行，便于 ACE-Step 识别结构。
  const insertSection = (section: string) => {
    const element = (expanded ? expandedLyrics : lyrics).current; const value = draft.lyrics ?? '';
    const start = element?.selectionStart ?? value.length, end = element?.selectionEnd ?? value.length;
    const before = value.slice(0, start);
    const tag = `${before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : ''}[${section}]\n`;
    change({ lyrics: (before + tag + value.slice(end)).slice(0, 4000) });
    requestAnimationFrame(() => { element?.focus(); element?.setSelectionRange(start + tag.length, start + tag.length); });
  };
  // 段落标记菜单在歌词区和放大的对话框里各有一个，快捷键打开当前可见的那个。
  const [sectionOpen, setSectionOpen] = useState(false);
  const sectionKeys = useHotkeyText('music.section'), sectionAria = useHotkeyAria('music.section');
  const sectionMenu = (inDialog: boolean) => <DropdownMenu hasChevron alignment="end" isMenuOpen={sectionOpen && inDialog === expanded} onOpenChange={setSectionOpen}
    button={{ size: 'sm', variant: 'ghost', label: t('@yovoice.music.insertSection'), tooltip: withHotkey(t('@yovoice.music.insertSection'), sectionKeys), 'aria-keyshortcuts': sectionAria }}
    items={[...lyricSections.map(section => ({ label: `[${section}]`, onClick: () => insertSection(section) })), { type: 'divider' as const }, ...instrumentalSections.map(section => ({ label: `[${section}]`, onClick: () => insertSection(section) }))]} />;
  const empty = !draft.text.trim() && !draft.lyrics?.trim();
  // 快捷键：人声与纯音乐切换、插入段落标记、放大编辑歌词；放大的歌词对话框里也能插入段落标记。
  const withLyrics = !stable && (!draft.instrumental || yue);
  useHotkey('music.instrumental', () => change({ instrumental: !draft.instrumental }), { enabled: active && !stable });
  // 放大编辑时页面被对话框盖住：改由对话框里的歌词框接这个快捷键（焦点在其中时响应）。
  useHotkey('music.section', () => setSectionOpen(true), { enabled: active && withLyrics && !expanded });
  useHotkey('music.section', () => setSectionOpen(true), { enabled: active && withLyrics && expanded, within: expandedLyrics });
  useHotkey('music.expandLyrics', () => setExpanded(true), { enabled: active && withLyrics && !expanded });
  const instrumentalAria = useHotkeyAria('music.instrumental'), expandKeys = useHotkeyText('music.expandLyrics'), expandAria = useHotkeyAria('music.expandLyrics');
  return <VStack className="music-editor" gap={5}>
    <VStack className="music-block" gap={3}>
      <HStack className="music-style-header" hAlign="between" vAlign="center" gap={2}>
        <h2>{t('@yovoice.music.style')}</h2>
        {yue && isDesktop ? <>
          <input ref={imageInput} hidden type="file" accept="image/png,image/jpeg,image/webp" aria-label={t('@yovoice.music.styleFromImage')} onChange={event => { const picked = event.target.files?.[0]; event.target.value = ''; if (picked) void styleFromImage(picked); }} />
          <Button size="sm" variant="ghost" icon={reading ? <LoaderCircle className="generation-spinner" /> : <ImagePlus />} label={t('@yovoice.music.styleFromImage')} tooltip={t('@yovoice.music.styleFromImageHint')} isDisabled={reading} onClick={() => imageInput.current?.click()} />
        </> : null}
        {empty && !stable ? <Button size="sm" variant="secondary" icon={<Lightbulb />} label={t('@yovoice.music.example')} onClick={() => { const example = createMusicDraft(locale); change({ text: example.text, lyrics: example.lyrics, synthesisLanguage: example.synthesisLanguage, ...(isUntitled(draft.title) ? { title: example.title } : {}) }); }} /> : null}
      </HStack>

      {/* 风格标签输入区：展示已选Token胶囊，并在行内支持直接打字、回车/逗号追加、退格删除 */}
      <HStack
        className="music-style-box"
        gap={1}
        vAlign="center"
        wrap="wrap"
        onClick={() => inputRef.current?.focus()}
      >
        <input
          className="music-style-field"
          aria-label={t('@yovoice.music.style')}
          value={draft.text}
          readOnly
          tabIndex={-1}
        />
        {tags.map(tag => (
          <Token key={tag} size="sm" label={tag} onRemove={() => toggleTag(tag)} />
        ))}
        <input
          ref={inputRef}
          className="music-inline-input grow"
          aria-label={t('@yovoice.music.addTag')}
          placeholder={tags.length === 0 ? t(sfx ? '@yovoice.music.soundPlaceholder' : '@yovoice.music.stylePlaceholder') : t('@yovoice.music.addTagPlaceholder')}
          value={inputVal}
          onChange={e => setInputVal(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          onPaste={handlePaste}
        />
      </HStack>
      {stable ? <small>{t('@yovoice.music.englishPrompt')}</small> : null}
    </VStack>
    {stable ? null : <VStack className="music-block" gap={3}>
      <HStack vAlign="center" gap={2} wrap="wrap">
        <h2 className="grow">{t('@yovoice.music.lyrics')}</h2>
        {withLyrics ? sectionMenu(false) : null}
        {withLyrics ? <Button size="sm" variant="ghost" isIconOnly icon={<Maximize2 />} label={t('@yovoice.music.expandLyrics')} tooltip={withHotkey(t('@yovoice.music.expandLyrics'), expandKeys)} aria-keyshortcuts={expandAria} onClick={() => setExpanded(true)} /> : null}
        <SegmentedControl label={t('@yovoice.music.lyricsMode')} aria-keyshortcuts={instrumentalAria} size="sm" value={draft.instrumental ? 'instrumental' : 'vocal'} onChange={value => change({ instrumental: value === 'instrumental' })}>
          <SegmentedControlItem onPointerEnter={overflowTitle} value="vocal" label={t('@yovoice.music.vocal')} />
          <SegmentedControlItem onPointerEnter={overflowTitle} value="instrumental" label={t('@yovoice.music.instrumental')} />
        </SegmentedControl>
      </HStack>
      {draft.instrumental && !yue ? null
        : <TextArea ref={lyrics} className="music-lyrics" label={t('@yovoice.music.lyrics')} isLabelHidden value={draft.lyrics ?? ''} maxLength={4000} rows={draft.instrumental ? 6 : yue ? 10 : 14} hasSpellCheck={false} placeholder={t(draft.instrumental ? '@yovoice.music.structurePlaceholder' : '@yovoice.music.lyricsPlaceholder')} onChange={value => change({ lyrics: value.slice(0, 4000) })} />}
    </VStack>}
    {expanded ? <AppDialog title={t('@yovoice.music.lyrics')} width={760} closeLabel={t('@yovoice.action.close')} onClose={() => setExpanded(false)}
      actions={sectionMenu(true)}>
      <TextArea ref={expandedLyrics} className="music-lyrics music-lyrics-expanded" label={t('@yovoice.music.lyrics')} isLabelHidden value={draft.lyrics ?? ''} maxLength={4000} rows={20} hasSpellCheck={false}
        placeholder={t(draft.instrumental ? '@yovoice.music.structurePlaceholder' : '@yovoice.music.lyricsPlaceholder')} onChange={value => change({ lyrics: value.slice(0, 4000) })} />
    </AppDialog> : null}
    {/* YuE2 的流程是“歌词 → 旋律谱 → 整首歌”，谱放在歌词之后。 */}
    {yue ? <MelodyScore draft={draft} state={state} change={change} onError={onError} active={active} /> : null}
  </VStack>;
}

// shrinkImage 把图片缩到长边 1024 像素以内并转成 JPEG，返回 base64；大图不必整张上传给 AI 服务。
async function shrinkImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  if (!blob) throw new Error('image');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
