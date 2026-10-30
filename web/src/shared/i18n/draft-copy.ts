/** createDraft 的种子文案：在 React 之外调用，没有翻译器，所以按语言直接内置，不走 i18n 目录。 */
export const draftCopy = {
  en: {
    untitled: 'Untitled',
    exampleTitle: 'Morning narration',
    exampleText: 'Morning light slips through the curtains,\nand the room slowly brightens.\n\nPour yourself a warm cup of tea,\nand let your thoughts slow down for a moment.\n\nToday, we begin with a good voice.',
    emotionText: 'Gentle and calm, as if talking to someone familiar.',
    language: 'en',
  },
  'zh-CN': {
    untitled: '未命名作品',
    exampleTitle: '清晨旁白',
    exampleText: '清晨的阳光穿过窗帘，\n房间渐渐明亮起来。\n\n给自己倒一杯热茶，\n让思绪在片刻的安静里慢下来。\n\n今天，我们从一个好声音开始。',
    emotionText: '温柔、平静，像是在和熟悉的人说话。',
    language: 'zh',
  },
  'zh-TW': {
    untitled: '未命名作品',
    exampleTitle: '清晨旁白',
    exampleText: '清晨的陽光穿過窗簾，\n房間漸漸明亮起來。\n\n給自己倒一杯熱茶，\n讓思緒在片刻的安靜裡慢下來。\n\n今天，我們從一個好聲音開始。',
    emotionText: '溫柔、平靜，像是在和熟悉的人說話。',
    language: 'zh',
  },
} as const;
