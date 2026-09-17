/** Seed copy for createDraft; keep in sync with @yovoice.draft.* catalog keys. */
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
} as const;
