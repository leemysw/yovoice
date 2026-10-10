import { createDraft, type Draft, type UiLocale } from '../../shared/workbench';

export const musicModelId = 'ace-step-1.5-turbo-bf16';

// 风格标签按“流派、情绪、乐器、人声”分组，值直接写入风格描述，ACE-Step 对中英文描述都能理解。
export const styleTags = {
  genre: ['pop', 'city pop', 'lo-fi', 'folk', 'rock', 'electronic', 'R&B', 'jazz', 'hip hop', 'chinese traditional'],
  mood: ['upbeat', 'chill', 'dreamy', 'melancholic', 'epic', 'romantic'],
  instrument: ['warm synths', 'acoustic guitar', 'piano', 'strings', '808 bass', 'guzheng'],
  vocal: ['female vocals', 'male vocals', 'choir', 'rap'],
} as const;

export const lyricSections = ['intro', 'verse', 'pre-chorus', 'chorus', 'bridge', 'outro'] as const;

// 常用演唱语言放在前面，完整列表与 Go 的 schema.MusicLanguages 一致。
export const musicLanguages = ['zh', 'en', 'yue', 'ja', 'ko', 'es', 'fr', 'de', 'pt', 'ru', 'it'] as const;

export const durationPresets = [0, 30, 60, 120, 180] as const;

const copy: Record<UiLocale, { title: string; style: string; lyrics: string; language: string }> = {
  'zh-CN': {
    title: '夏夜便利店',
    style: 'city pop, warm synths, chill, female vocals',
    lyrics: '[verse]\n晚风把招牌吹得一闪一闪\n冰柜里的汽水排成一行\n你说再等十分钟就打烊\n我们把整个夏天都买光\n\n[chorus]\n二十四小时的光 不睡的城\n收银台的叮咚像心跳的声\n如果今晚可以不说再见\n就在这里 一直等',
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
  const text = copy[locale];
  return {
    ...createDraft(false, locale, musicModelId), kind: 'music',
    title: example ? text.title : createDraft(false, locale).title,
    text: example ? text.style : '', lyrics: example ? text.lyrics : '', instrumental: false, synthesisLanguage: text.language,
    modelOptions: { ace_step: { duration_seconds: 60 } },
  };
}
