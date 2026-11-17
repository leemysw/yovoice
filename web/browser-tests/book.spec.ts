import { test, expect } from '@playwright/test';
import { bookDrafts, castRoles, chapterParts, proposeCast, scriptChapters, splitChapters } from '../src/features/create/manuscript';
import { deflateRawSync } from 'node:zlib';
import { seedState } from './seed';
import { createDraft, emptyState, synthesisSettings, type Character } from '../src/shared/workbench';

const novel = `小王子

第一章 相遇
那天早上，我在沙漠里修飞机。
一个小人儿站在我面前，他说：“请给我画一只羊。”
“你说什么？”我问道。
小王子认真地说：“我要一只羊。”
“好吧。”

第二章 狐狸
狐狸对小王子说：“你好。”
“你是谁？”小王子问。
“我是一只狐狸。”狐狸说，“我不能和你玩。”
“为什么？”
“因为我还没有被驯服。”`;

test('按章节标题切分书稿，标题前的正文作为开篇', () => {
  const chapters = splitChapters(novel, '书');
  expect(chapters.map(c => c.title)).toEqual(['书', '第一章 相遇', '第二章 狐狸']);
  expect(chapters[0].text.trim()).toBe('小王子');
  const md = splitChapters('# 第一卷\n\n## 序章\n正文**加粗**\n\n## Chapter 2\n更多', '书', true);
  expect(md.map(c => c.title)).toEqual(['第一卷 序章', 'Chapter 2']);
  expect(md[0].text.trim()).toBe('正文加粗');
});

test('规则分角色：拆开旁白与对白，识别说话人，第一人称交给旁白', () => {
  const [, first, second] = scriptChapters(splitChapters(novel, '书'), '?');
  expect(first.lines).toEqual([
    { text: '那天早上，我在沙漠里修飞机。', quote: false, speaker: '' },
    { text: '一个小人儿站在我面前，他说：', quote: false, speaker: '' },
    { text: '请给我画一只羊。', quote: true, speaker: '?' },
    { text: '你说什么？', quote: true, speaker: '' },
    { text: '我问道。', quote: false, speaker: '' },
    { text: '小王子认真地说：', quote: false, speaker: '' },
    { text: '我要一只羊。', quote: true, speaker: '小王子' },
    // 前两段是“我”与小王子一问一答，这一句轮回到“我”。
    { text: '好吧。', quote: true, speaker: '' },
  ]);
  expect(second.lines.filter(l => l.quote).map(l => l.speaker)).toEqual(['狐狸', '小王子', '狐狸', '狐狸', '小王子', '狐狸']);
  const roles = castRoles([first, second]);
  expect(roles.map(r => [r.name, r.lines])).toEqual([['狐狸', 4], ['小王子', 3], ['?', 1]]);
});

test('剧本格式按行首“名字：”分角色，旁白行和说明行不算角色', () => {
  const play = '第一幕\n旁白：夜里，雨下个不停。\n张三：你回来了？\n李四：“嗯，路上堵车。”\n张三：快进来吧。\n注意：以下为回忆。\nAlice: Hello there.';
  const [chapter] = scriptChapters(splitChapters(play, '剧本'), '?');
  expect(chapter.lines).toEqual([
    { text: '夜里，雨下个不停。', quote: false, speaker: '' },
    { text: '你回来了？', quote: true, speaker: '张三' },
    { text: '嗯，路上堵车。', quote: true, speaker: '李四' },
    { text: '快进来吧。', quote: true, speaker: '张三' },
    { text: '注意：以下为回忆。', quote: false, speaker: '' },
    { text: 'Hello there.', quote: true, speaker: 'Alice' },
  ]);
  // 小说里零星的“某某说：”不触发剧本格式。
  const [, , fox] = scriptChapters(splitChapters(novel, '书'), '?');
  expect(fox.lines.filter(l => l.quote).map(l => l.speaker)).toEqual(['狐狸', '小王子', '狐狸', '狐狸', '小王子', '狐狸']);
});

test('英文对白按 said 识别说话人', () => {
  const [chapter] = scriptChapters([{ title: 'c', text: '"Hello," said Alice. "How are you?"\nBob replied, "Fine."\n"Good."\n"Thanks."' }], '?');
  expect(chapter.lines.filter(l => l.quote).map(l => l.speaker)).toEqual(['Alice', 'Alice', 'Bob', 'Alice', 'Bob']);
});

test('自动选角与按章生成故事作品', () => {
  const settings = synthesisSettings(createDraft());
  const characters: Character[] = ['温柔旁白', '狐狸', '少年', '老教授'].map((name, i) => ({ id: String(i).repeat(32), name, settings: { ...settings, speed: i + 1 }, demoText: '' }));
  const cast = proposeCast(['', '小王子', '狐狸'], characters, { 小王子: '3'.repeat(32) });
  expect(cast).toEqual({ '': '0'.repeat(32), 小王子: '3'.repeat(32), 狐狸: '1'.repeat(32) });
  const chapters = scriptChapters(splitChapters(novel, '小王子').slice(1), '?');
  const drafts = bookDrafts('小王子', chapters, cast, characters, '旁白', () => createDraft());
  expect(drafts.map(d => d.title)).toEqual(['小王子 · 第一章 相遇', '小王子 · 第二章 狐狸']);
  const fox = drafts[1].subtitles!;
  expect(fox.speakers.map(s => [s.sourceName, s.characterId])).toEqual([['旁白', '0'.repeat(32)], ['狐狸', '1'.repeat(32)], ['小王子', '3'.repeat(32)]]);
  expect(fox.speakers[1].settings?.speed).toBe(2);
  expect(drafts[1].text).toBe(fox.cues.map(c => c.text).join('\n'));
  const long = { title: 'x', lines: Array.from({ length: 3000 }, (_, i) => ({ text: `第${i}句话。`, quote: false, speaker: '' })) };
  const parts = chapterParts(long);
  expect(parts.length).toBe(3);
  for (const part of parts) expect(part.length <= 1800 && part.map(l => l.text).join('\n').length <= 12000).toBe(true);
  expect(parts.flat().length).toBe(3000);
});

// 最小 EPUB：ZIP 包含容器描述、OPF 和两个正文文档，正文用 deflate 压缩。
function epub(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = Buffer.from(content), data = name === 'mimetype' ? raw : deflateRawSync(raw), method = name === 'mimetype' ? 0 : 8;
    const file = Buffer.from(name);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(method, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(file.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(method, 10); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(file.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, file, data); centrals.push(central, file);
    offset += 30 + file.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const xhtml = (title: string, body: string) => `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head><body>${body}</body></html>`;

test('导入小说：选章节、自动分角色与选角，按章生成故事作品', async ({ page }) => {
  const state = emptyState();
  const settings = synthesisSettings(state.drafts[0]);
  state.characters = [
    { id: 'a'.repeat(32), name: '温柔旁白', settings: { ...settings, speed: 0.9 }, demoText: '' },
    { id: 'b'.repeat(32), name: '狐狸', settings: { ...settings, speed: 1.1 }, demoText: '' },
  ];
  await page.goto('/');
  await seedState(page, state);
  await page.reload();
  await page.getByTestId('nav-story').click();
  await page.getByLabel('小说文件').first().setInputFiles({ name: '小王子.txt', mimeType: 'text/plain', buffer: Buffer.from(novel) });
  const dialog = page.getByRole('dialog', { name: '导入小说' });
  await expect(dialog.getByLabel('书名')).toHaveValue('小王子');
  // 只有书名一行的开篇默认不选。
  await expect(dialog.getByRole('checkbox', { name: '小王子', exact: true })).not.toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: '第一章 相遇' })).toBeChecked();
  await dialog.getByRole('button', { name: '下一步：分角色' }).click();
  const cast = page.getByRole('dialog', { name: '分角色与选角' });
  await expect(cast.getByText('2 章 · 2 个角色 · 17 句')).toBeVisible();
  await expect(cast.getByTestId('book-role')).toHaveCount(4);
  await expect(cast.getByRole('combobox', { name: '旁白 的声音' })).toContainText('温柔旁白');
  await expect(cast.getByRole('combobox', { name: '狐狸 的声音' })).toContainText('狐狸');
  await expect(cast.getByRole('combobox', { name: '小王子 的声音' })).toContainText('默认声音');
  await expect(cast.getByRole('button', { name: '设置 AI' })).toBeVisible();
  await cast.getByRole('button', { name: '创建 2 个作品' }).click();
  await expect(page.getByLabel('作品名称')).toHaveValue('小王子 · 第一章 相遇');
  await expect(page.getByLabel('第 7 句台词', { exact: true })).toHaveValue('我要一只羊。');
  await page.getByRole('button', { name: '说话人设置', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '说话人 1 (旁白)', exact: true })).toContainText('温柔旁白');
  await expect(page.getByRole('textbox', { name: '角色名称' })).toHaveCount(3);
  await page.keyboard.press('Escape');
  await page.getByTestId('nav-story').click();
  // 第一章排在最前，便于按顺序打开。
  await expect(page.locator('#astryx-app-shell-main').getByRole('button', { name: /^小王子 · 第/ })).toHaveText(['小王子 · 第一章 相遇', '小王子 · 第二章 狐狸']);
});

test('导入 EPUB：按阅读顺序取正文，跳过目录页', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('nav-story').click();
  const book = epub({
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>',
    'OEBPS/content.opf': '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>月亮船</dc:title></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c2" href="text/c2.xhtml" media-type="application/xhtml+xml"/><item id="c1" href="text/c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="nav"/><itemref idref="c1"/><itemref idref="c2"/></spine></package>',
    'OEBPS/nav.xhtml': xhtml('目录', '<nav><ol><li>第一章</li></ol></nav>'),
    'OEBPS/text/c1.xhtml': xhtml('月亮船', '<h1>第一章 出发</h1><p>小兔坐上了月亮船，船慢慢地飘向天空，星星一颗一颗亮了起来。</p><p>妈妈说：“早点回来。”</p>'),
    'OEBPS/text/c2.xhtml': xhtml('月亮船', '<h2>第二章 回家</h2><p>天亮了，小兔回到家里，妈妈已经做好了早饭，桌上摆着热乎乎的胡萝卜汤。</p>'),
  });
  await page.getByLabel('小说文件').first().setInputFiles({ name: 'moon.epub', mimeType: 'application/epub+zip', buffer: book });
  const dialog = page.getByRole('dialog', { name: '导入小说' });
  await expect(dialog.getByLabel('书名')).toHaveValue('月亮船');
  await expect(dialog.getByRole('checkbox')).toHaveCount(3);
  await expect(dialog.getByRole('checkbox', { name: '第一章 出发' })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: '第二章 回家' })).toBeChecked();
  await dialog.getByRole('button', { name: '下一步：分角色' }).click();
  await expect(page.getByRole('combobox', { name: '妈妈 的声音' })).toBeVisible();
});

test('新建作品菜单可以直接导入小说，进入故事页接着分章节', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('nav-new').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: '导入小说' }).click();
  await (await chooser).setFiles({ name: '小王子.txt', mimeType: 'text/plain', buffer: Buffer.from(novel) });
  const dialog = page.getByRole('dialog', { name: '导入小说' });
  await expect(dialog.getByLabel('书名')).toHaveValue('小王子');
  await expect(dialog.getByRole('checkbox', { name: '第一章 相遇' })).toBeChecked();
  await expect(page.locator('#projects-story-panel')).toBeVisible();
});
