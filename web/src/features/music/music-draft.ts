import { createDraft, type Draft, type UiLocale } from '../../shared/workbench';
import { seedLocale, type SeedLocale } from '../../shared/i18n/locale';

export const musicModelId = 'ace-step-1.5-turbo-bf16';

// 风格标签按“流派、情绪、乐器、人声”分组，值直接写入风格描述，ACE-Step 对中英文描述都能理解。
export const styleTags = {
  genre: ['pop', 'city pop', 'lo-fi', 'folk', 'rock', 'electronic', 'R&B', 'jazz', 'hip hop', 'chinese traditional'],
  mood: ['upbeat', 'chill', 'dreamy', 'melancholic', 'epic', 'romantic'],
  instrument: ['warm synths', 'acoustic guitar', 'piano', 'strings', '808 bass', 'guzheng'],
  vocal: ['female vocals', 'male vocals', 'choir', 'rap'],
} as const;

// YuE2 没有语言与速度设置，也读得懂成句的编配描述：这些标签只在 YuE2 下出现，值同样直接写进风格描述。
// language 与 tempo 只能选一个；演唱语言放在风格最前面，与官方写法一致。
export const yueStyleTags = {
  language: ['Mandarin', 'Cantonese', 'English', 'Japanese', 'Korean'],
  tempo: ['72 BPM', '96 BPM', '120 BPM', '150 BPM'],
  opening: ['vocals enter immediately', 'long instrumental intro', 'opens on the chorus hook'],
  development: ['intimate verses and a bright singable chorus', 'stripped-down bridge', 'instrumental solo before the last chorus', 'builds to a big final chorus'],
  ending: ['fades out on the intro theme', 'ends on an a cappella line'],
} as const;
const exclusiveGroups = [yueStyleTags.language, yueStyleTags.tempo] as readonly (readonly string[])[];

// 点选标签：已选则去掉；语言与速度同组互斥，新选的语言放到最前面。
export const toggleStyleTag = (currentTags: readonly string[], tag: string) => {
  if (currentTags.includes(tag)) return currentTags.filter(item => item !== tag);
  const group = exclusiveGroups.find(items => items.includes(tag));
  const rest = group ? currentTags.filter(item => !group.includes(item)) : [...currentTags];
  return group === yueStyleTags.language ? [tag, ...rest] : [...rest, tag];
};

export interface StylePreset {
  id: string;
  tags: string[];
}

// 风格预设：一键注入成熟好听的风格搭配，纯文字无 emoji。
export const stylePresets: readonly StylePreset[] = [
  { id: 'city-pop', tags: ['city pop', 'warm synths', 'chill', 'female vocals'] },
  { id: 'lofi', tags: ['lo-fi', 'chill', 'warm synths', 'acoustic guitar'] },
  { id: 'folk', tags: ['folk', 'acoustic guitar', 'chill'] },
  { id: 'electronic', tags: ['pop', 'electronic', 'upbeat', '808 bass'] },
  { id: 'chinese', tags: ['chinese traditional', 'guzheng', 'strings', 'dreamy'] },
  { id: 'romantic', tags: ['pop', 'romantic', 'piano', 'strings'] },
  { id: 'hiphop', tags: ['hip hop', '808 bass', 'rap', 'upbeat'] },
  { id: 'rock', tags: ['rock', 'epic', 'male vocals'] },
] as const;

export const splitTags = (style: string) => style.split(/[,，]/).map(tag => tag.trim()).filter(Boolean);

export const isPresetActive = (preset: StylePreset, currentTags: readonly string[]) =>
  preset.tags.length > 0 && preset.tags.every(t => currentTags.includes(t));

export const applyPresetTags = (preset: StylePreset, currentTags: readonly string[]) => {
  if (isPresetActive(preset, currentTags)) {
    return currentTags.filter(t => !preset.tags.includes(t));
  }
  const allPresetTags = new Set(stylePresets.flatMap(p => p.tags));
  const customTags = currentTags.filter(t => !allPresetTags.has(t));
  return [...preset.tags, ...customTags];
};

// 标签的界面语言释义，降低理解门槛；目录键由标签派生。
export const tagHintKey = (tag: string) => `@yovoice.music.tagHint.${tag.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}` as const;

// 段落标记：演唱段落在前，器乐段落在后；首字母大写与 YuE2 官方写法一致，ACE-Step 不区分大小写。
export const lyricSections = ['Intro', 'Verse', 'Pre-Chorus', 'Chorus', 'Post-Chorus', 'Hook', 'Bridge', 'Final Chorus', 'Outro'] as const;
export const instrumentalSections = ['Interlude', 'Break', 'Guitar Solo', 'Piano Solo', 'Instrumental'] as const;

// 常用演唱语言放在前面，完整列表与 Go 的 schema.MusicLanguages 一致。
export const musicLanguages = ['zh', 'en', 'yue', 'ja', 'ko', 'es', 'fr', 'de', 'pt', 'ru', 'it'] as const;

export const durationPresets = [0, 30, 60, 120, 180] as const;

const copy: Record<SeedLocale, { title: string; style: string; lyrics: string; language: string }> = {
  'zh-CN': {
    title: '夏夜便利店',
    style: 'city pop, warm synths, chill, female vocals',
    lyrics: '[verse]\n晚风把招牌吹得一闪一闪\n冰柜里的汽水排成一行\n你说再等十分钟就打烊\n我们把整个夏天都买光\n\n[chorus]\n二十四小时的光 不睡的城\n收银台的叮咚像心跳的声\n如果今晚可以不说再见\n就在这里 一直等',
    language: 'zh',
  },
  'zh-TW': {
    title: '夏夜便利商店',
    style: 'city pop, warm synths, chill, female vocals',
    lyrics: '[verse]\n晚風把招牌吹得一閃一閃\n冰櫃裡的汽水排成一行\n你說再等十分鐘就打烊\n我們把整個夏天都買光\n\n[chorus]\n二十四小時的光 不睡的城\n收銀台的叮咚像心跳的聲\n如果今晚可以不說再見\n就在這裡 一直等',
    language: 'zh',
  },
  en: {
    title: 'Corner Store Summer',
    style: 'city pop, warm synths, chill, female vocals',
    lyrics: '[verse]\nNeon flickers in the evening breeze\nSoda cans lined up in the freezer\nTen more minutes till they close the doors\nWe could buy the whole summer and more\n\n[chorus]\nTwenty-four hour light, a city awake\nEvery register chime like a heartbeat we make\nIf tonight we never say goodbye\nWe will wait here, you and I',
    language: 'en',
  },
};

export function createMusicDraft(locale: UiLocale, example = true): Draft {
  const text = copy[seedLocale(locale)];
  return {
    ...createDraft(false, locale, musicModelId), kind: 'music',
    title: example ? text.title : createDraft(false, locale).title,
    text: example ? text.style : '', lyrics: example ? text.lyrics : '', instrumental: false, synthesisLanguage: text.language,
    modelOptions: { ace_step: { duration_seconds: 60 } },
  };
}

