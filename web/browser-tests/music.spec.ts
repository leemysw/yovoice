import { test, expect, type Locator, type Page } from '@playwright/test';
import { seedState } from './seed';
import { emptyState } from '../src/shared/workbench';
import { createMusicDraft } from '../src/features/music/music-draft';
import { songLyrics, syntheticSong, wavBytes } from './synthetic-song';

test('新建音乐作品：示例、风格标签、段落标记、纯音乐与参数持久化', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByTestId('nav-new').click();
  await page.getByRole('menuitem', { name: '音乐生成', exact: true }).click();
  const style = page.getByLabel('风格', { exact: true });
  await expect(style).toHaveValue('');
  await page.getByRole('button', { name: '填入示例', exact: true }).click();
  await expect(style).toHaveValue(/city pop/);
  await expect(page.getByRole('button', { name: '填入示例', exact: true })).toHaveCount(0);
  // 风格预设与微调元素位于右侧检查器（纯文字无 emoji，与情绪预设一致）。
  await expect(page.getByRole('button', { name: 'City Pop', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'City Pop', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: testInfo.outputPath('music-style-presets-top.png') });

  // 点击微调元素展开分类标签。
  await page.getByRole('button', { name: '微调元素', exact: true }).click();
  const tags = page.getByRole('group', { name: '风格标签' });
  await expect(tags.getByRole('button', { name: 'city pop', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await tags.getByRole('button', { name: 'piano', exact: true }).click();
  await expect(style).toHaveValue(/, piano$/);
  await tags.getByRole('button', { name: 'city pop', exact: true }).click();
  await expect(style).not.toHaveValue(/city pop/);
  await page.screenshot({ path: testInfo.outputPath('music-style-presets.png') });

  const lyrics = page.getByLabel('歌词', { exact: true });
  await lyrics.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(el.value.length, el.value.length));
  await page.getByRole('button', { name: '插入段落' }).click();
  await page.getByRole('menuitem', { name: '[Bridge]', exact: true }).click();
  await expect(lyrics).toHaveValue(/一直等\n\n\[Bridge\]\n$/);

  // 音乐作品使用独立检查器：只列音乐模型，时长与语言写入作品。
  const model = page.getByRole('combobox', { name: '模型' });
  await expect(model).toContainText('ACE-Step 1.5 Turbo');
  await page.getByRole('radio', { name: '02:00' }).click();
  await page.getByRole('combobox', { name: '演唱语言' }).click();
  await page.getByRole('option', { name: '粤语' }).click();
  await page.getByRole('radio', { name: '纯音乐' }).click();
  await expect(lyrics).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('music.png') });

  await expect(page.locator('.saved')).toContainText('已保存');
  await page.reload();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1')!).drafts.find((d: { kind?: string }) => d.kind === 'music'));
  expect(saved).toMatchObject({ kind: 'music', modelId: 'ace-step-1.5-turbo-bf16', instrumental: true, synthesisLanguage: 'yue', modelOptions: { ace_step: { duration_seconds: 120 } } });
  expect(saved.lyrics).toContain('[Bridge]');
  await expect(page.getByRole('radio', { name: '纯音乐' })).toBeChecked();

  // 未安装模型时生成直接打开“音乐模型”设置；配音作品的模型列表不包含音乐模型。
  await page.getByRole('button', { name: '生成歌曲', exact: true }).click();
  await expect(page.getByRole('tab', { name: '音乐模型', selected: true })).toBeVisible();
  await page.getByTestId('nav-music').click();
  await expect(page.locator('.project-library-row:visible .record-cover')).toHaveCount(1);
  await page.getByTestId('nav-new').click();
  await page.getByRole('menuitem', { name: '语音生成', exact: true }).click();
  await page.getByRole('combobox', { name: '模型' }).click();
  await expect(page.getByRole('option', { name: /ACE-Step/ })).toHaveCount(0);
});


test('选中 YuE2：长度由歌词决定，纯音乐先写谱再交给乐器，可选生成方式与高级参数', async ({ page }, testInfo) => {
  const draft = { ...createMusicDraft('zh-CN'), id: 'd'.repeat(32), modelId: 'ace-step-1.5-turbo-q8', instrumental: true };
  const state = emptyState();
  state.drafts = [draft];
  state.models = [
    { id: 'ace-step-1.5-turbo-q8', path: 'ace-step-1.5-turbo-q8_0.gguf', managed: true },
    { id: 'yue2-3b-q8', path: 'Yue2-3B-GGUF', managed: true },
  ];
  await page.addInitScript(value => { if (!localStorage.getItem('voice-workbench-v1')) localStorage.setItem('voice-workbench-v1', value); }, JSON.stringify(state));
  await page.goto('/');
  await expect(page.getByRole('radio', { name: '纯音乐' })).toBeChecked();
  await page.getByRole('combobox', { name: '模型' }).click();
  await page.getByRole('option', { name: /^YuE2 3B/ }).click();
  // YuE2 也能生成纯音乐：保留纯音乐，歌词变为可选的段落结构，生成方式固定按谱；ACE-Step 专属参数隐藏。
  await expect(page.getByRole('radio', { name: '纯音乐' })).toBeChecked();
  await expect(page.getByLabel('歌词', { exact: true })).toHaveAttribute('placeholder', /段落标记/);
  await expect(page.getByRole('radio', { name: '02:00' })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: '演唱语言' })).toHaveCount(0);
  await expect(page.getByRole('radio', { name: '自由发挥' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '先写旋律谱' })).toBeEnabled();
  await page.getByLabel('歌词', { exact: true }).fill('');
  await expect(page.getByRole('button', { name: '生成歌曲', exact: true })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('music-yue2-instrumental.png') });
  // 填写歌词时可以选不经过谱自由发挥；高级设置里是 YuE2 自己的参数。
  await page.getByRole('radio', { name: '填写歌词' }).click();
  await expect(page.getByRole('button', { name: '生成歌曲', exact: true })).toBeDisabled();
  await expect(page.getByRole('radio', { name: '按旋律谱' })).toBeChecked();
  await page.getByRole('radio', { name: '自由发挥' }).click();
  await page.locator('details.advanced > summary').click();
  await expect(page.getByLabel('演唱温度')).toHaveValue('1');
  await expect(page.getByLabel('写谱温度')).toHaveValue('0.7');
  await expect(page.getByLabel('时长')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1') ?? '{}').drafts?.[0]?.modelOptions?.yue2?.cot)).toBe('off');
  await page.screenshot({ path: testInfo.outputPath('music-yue2.png') });
});

test('选中 Stable Audio：只写英文描述，没有歌词与演唱语言；可在已有版本上改编或局部重绘', async ({ page }, testInfo) => {
  const draft = { ...createMusicDraft('zh-CN'), id: 'a'.repeat(32), modelId: 'ace-step-1.5-turbo-q8' };
  const state = emptyState();
  state.drafts = [draft];
  state.models = [
    { id: 'ace-step-1.5-turbo-q8', path: 'ace-step-1.5-turbo-q8_0.gguf', managed: true },
    { id: 'stable-audio-3-small-music-q8', path: 'stable-audio-3-small-music-q8_0.gguf', managed: true },
    { id: 'stable-audio-3-small-sfx-q8', path: 'stable-audio-3-small-sfx-q8_0.gguf', managed: true },
  ];
  state.history = [{ id: 'take1', title: draft.title, fileName: 'take1.wav', createdAt: '2026-10-20T10:00:00Z', duration: 30, settings: draft }];
  await page.addInitScript(value => { if (!localStorage.getItem('voice-workbench-v1')) localStorage.setItem('voice-workbench-v1', value); }, JSON.stringify(state));
  await page.goto('/');
  await page.getByRole('combobox', { name: '模型' }).click();
  await page.getByRole('option', { name: /^Stable Audio 3 Small Music/ }).click();
  // 没有歌词区与演唱语言，提示只理解英文；Small 最长 2 分钟，没有 03:00。
  await expect(page.getByLabel('歌词', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: '演唱语言' })).toHaveCount(0);
  await expect(page.getByText('Stable Audio 只理解英文描述')).toBeVisible();
  await expect(page.getByRole('radio', { name: '00:30' })).toBeChecked();
  await expect(page.getByRole('radio', { name: '03:00' })).toHaveCount(0);
  await expect(page.getByRole('radio', { name: '文字生成' })).toBeChecked();
  await expect(page.getByRole('button', { name: '生成音频', exact: true })).toBeEnabled();
  // 改编：默认以最新版本为起点，改动幅度 0.7。
  await page.getByRole('radio', { name: '改编' }).click();
  await expect(page.getByRole('combobox', { name: '起点版本' })).toContainText('版本 1 · 00:30');
  await expect(page.getByLabel('改动幅度')).toHaveValue('0.7');
  // 局部重绘：默认重绘开头 5 秒。
  await page.getByRole('radio', { name: '局部重绘' }).click();
  await expect(page.getByLabel('重绘开始（秒）')).toHaveValue('0');
  await expect(page.getByLabel('重绘结束（秒）')).toHaveValue('5');
  await page.getByLabel('重绘结束（秒）').fill('0');
  await expect(page.getByRole('button', { name: '生成音频', exact: true })).toBeDisabled();
  await page.getByLabel('重绘结束（秒）').fill('8');
  await expect(page.getByRole('button', { name: '生成音频', exact: true })).toBeEnabled();
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1') ?? '{}').drafts?.[0]);
  await expect.poll(async () => { const d = await saved(); return [d?.instrumental, d?.sourceGenerationId, d?.modelOptions?.stable_audio?.edit, d?.modelOptions?.stable_audio?.inpaint_end]; }).toEqual([true, 'take1', 'inpaint_audio', 8]);
  await page.locator('details.advanced > summary').click();
  await expect(page.getByLabel('引导强度')).toHaveValue('1');
  await expect(page.getByLabel('推理步数')).toHaveValue('8');
  await page.screenshot({ path: testInfo.outputPath('music-stable-audio.png') });
  // 音效模型归入独立音效作品，不再出现在新的歌曲模型列表里。
  await page.getByRole('combobox', { name: '模型' }).click();
  await expect(page.getByRole('option', { name: /^Stable Audio 3 Small SFX/ })).toHaveCount(0);
});

test('新建音效：英文描述、专用模型、短时长与生成入口', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('nav-new').click();
  await page.getByRole('menuitem', { name: '音效生成', exact: true }).click();
  const description = page.getByLabel('音效描述', { exact: true });
  await expect(description).toBeVisible();
  await expect(page.getByLabel('歌词', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('radio', { name: '5秒' })).toBeChecked();
  await expect(page.getByRole('combobox', { name: '模型' })).toContainText('Stable Audio 3 Small SFX');
  await page.getByRole('combobox', { name: '模型' }).click();
  await expect(page.getByRole('option', { name: /^Stable Audio 3 Small SFX/ })).toHaveCount(1);
  await expect(page.getByRole('option', { name: /^Stable Audio 3 Medium/ })).toHaveCount(1);
  await expect(page.getByRole('option', { name: /^Stable Audio 3 Small Music/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await description.fill('A short metallic impact followed by a gentle echo');
  await page.getByRole('radio', { name: '10秒' }).click();
  await expect(page.getByRole('button', { name: '生成音频', exact: true })).toBeEnabled();
  await expect(page.locator('.saved')).toContainText('已保存');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1')!).drafts.find((d: { kind?: string }) => d.kind === 'sfx'));
  expect(saved).toMatchObject({ kind: 'sfx', modelId: 'stable-audio-3-small-sfx-q8', instrumental: true, modelOptions: { stable_audio: { duration_seconds: 10 } } });
  await page.getByTestId('nav-music').click();
  await page.getByRole('tab', { name: '音效生成', exact: true }).click();
  await expect(page.locator('.project-library-row:visible .wave-ring')).toHaveCount(1);
});

const melodyABC = `X:1
T:
M:4/4
L:1/32
Q:1/4=120
V: Vocal clef=treble name="Vocal Melody" snm="Vocal"
V: Ins clef=treble name="Ins Melody" snm="Inst."
K:C
% verse
V: Vocal
"C"E8G8c16|"G"B8G8D16|
V: Ins
Z2|
`;

test('YuE2 旋律谱：导入 ABC，看轨道与谱面，调速度、只留旋律后按谱生成', async ({ page }, testInfo) => {
  const draft = { ...createMusicDraft('zh-CN'), id: 'f'.repeat(32), modelId: 'yue2-3b-q8', instrumental: false };
  const state = emptyState();
  state.drafts = [draft];
  state.models = [{ id: 'yue2-3b-q8', path: 'Yue2-3B-GGUF', managed: true }];
  await seedState(page, state);
  await page.goto('/');
  // 空状态给出三种来源：按歌词出谱、从歌曲提取、导入谱文件。
  await expect(page.getByRole('heading', { name: '旋律谱' })).toBeVisible();
  await expect(page.getByRole('button', { name: '先写旋律谱' })).toBeEnabled();
  await expect(page.getByRole('button', { name: '生成歌曲', exact: true })).toBeVisible();
  await page.getByLabel('ABC 谱文件').setInputFiles({ name: 'song.abc', mimeType: 'text/plain', buffer: Buffer.from(melodyABC) });
  await expect(page.getByText(/C · 4\/4 · 2 小节 · 00:04 · 带和弦/)).toBeVisible();
  // 默认用五线谱显示，可以切到轨道或 ABC 谱面。
  await expect(page.getByRole('img', { name: '五线谱' }).locator('svg')).toBeVisible();
  // 试听要用编曲音色库渲染；没装音色库时提示去下载。
  await page.getByRole('button', { name: '试听', exact: true }).click();
  await expect(page.getByText('试听旋律谱需要一个音色库')).toBeVisible();
  await page.getByRole('radio', { name: '轨道' }).click();
  await expect(page.getByRole('group', { name: '旋律谱轨道，共 2 小节' })).toBeVisible();
  await expect(page.getByRole('button', { name: '按旋律谱生成', exact: true })).toBeVisible();
  await page.getByRole('group', { name: '旋律谱轨道，共 2 小节' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('melody-tracks.png') });

  const tempo = page.getByRole('spinbutton', { name: '速度' });
  await tempo.fill('90'); await tempo.press('Enter');
  await expect(page.getByText(/2 小节 · 00:05/)).toBeVisible();
  await expect(tempo).toHaveValue('90');
  await page.getByRole('button', { name: '谱面操作' }).click();
  await page.getByRole('menuitem', { name: '只保留旋律' }).click();
  await expect(page.getByText(/仅旋律/)).toBeVisible();
  // 谱面改动可以逐步撤回：先撤回只保留旋律，再撤回改速度，然后重新做一遍。
  await page.getByRole('button', { name: '撤回：只保留旋律' }).click();
  await expect(page.getByText(/带和弦/)).toBeVisible();
  await page.getByRole('button', { name: '撤回：速度' }).click();
  await expect(tempo).toHaveValue('120');
  await expect(page.getByRole('button', { name: /^撤回/ })).toHaveAccessibleName('撤回：导入 .abc');
  await tempo.fill('90'); await tempo.press('Enter');
  await expect(tempo).toHaveValue('90');
  await page.getByRole('button', { name: '谱面操作' }).click();
  await page.getByRole('menuitem', { name: '只保留旋律' }).click();
  await expect(page.getByText(/仅旋律/)).toBeVisible();
  // 导出为 .abc 文件。
  await page.getByRole('button', { name: '谱面操作' }).click();
  const exported = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: '导出 .abc' }).click();
  expect((await exported).suggestedFilename()).toMatch(/\.abc$/);
  await page.getByRole('radio', { name: 'ABC 谱面' }).click();
  const source = page.getByLabel('ABC 谱面', { exact: true });
  await expect(source).toHaveValue(/Q:1\/4=90/);
  await expect(source).not.toHaveValue(/"C"/);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1') ?? '{}').drafts[0].abc as string);
  expect(saved).toContain('Q:1/4=90');
  await source.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('melody-source.png') });

  // 浏览器预览不做推理：提取旋律给出明确提示。
  await page.getByRole('button', { name: '谱面操作' }).click();
  await page.getByRole('menuitem', { name: '清空谱' }).click();
  // 清空也能撤回。
  await page.getByRole('button', { name: '撤回：清空谱' }).click();
  await expect(page.getByText(/仅旋律/)).toBeVisible();
  await page.getByRole('button', { name: '谱面操作' }).click();
  await page.getByRole('menuitem', { name: '清空谱' }).click();
  await page.getByLabel('要提取旋律的歌曲').setInputFiles({ name: 'song.wav', mimeType: 'audio/wav', buffer: Buffer.from(wavBytes(new Float32Array(800), new Float32Array(800), 8000)) });
  await expect(page.getByRole('alert').filter({ hasText: '桌面' })).toBeVisible();
});

test('音乐历史版本：工具栏进入历史页，播放页、复用和删除都在这里', async ({ page }) => {
  const draft = { ...createMusicDraft('zh-CN'), id: 'e'.repeat(32) };
  const state = emptyState();
  state.drafts = [draft];
  const take = (id: string, hour: number, lyrics: string) => ({ id, title: draft.title, fileName: `${id}.wav`, createdAt: `2026-09-15T${String(hour).padStart(2, '0')}:00:00Z`, duration: 30, settings: { ...draft, text: `style ${id}`, lyrics } });
  state.history = [take('v3', 12, '[verse]\n第三版的歌词'), take('v2', 11, '[verse]\n第二版的第一句\n第二版的第二句'), take('v1', 10, '[verse]\n第一版的歌词')];
  await page.addInitScript(value => { if (!localStorage.getItem('voice-workbench-v1')) localStorage.setItem('voice-workbench-v1', value); }, JSON.stringify(state));
  await page.goto('/');
  // 编辑区不再有版本列表；播放器工具栏只放打开位置、播放页和历史版本入口，导出在“音频操作”菜单里。
  await expect(page.locator('.music-take-row')).toHaveCount(0);
  const transport = page.locator('.player .transport');
  await expect(transport.getByRole('button', { name: '打开位置', exact: true })).toBeVisible();
  await transport.getByRole('button', { name: '音频操作', exact: true }).click();
  await expect(page.getByRole('menuitem')).toHaveText(['导出音频']);
  await page.keyboard.press('Escape');
  await expect(transport.getByRole('button', { name: '播放页', exact: true })).toBeVisible();
  await transport.getByRole('button', { name: '历史版本', exact: true }).click();
  await expect(page.getByRole('heading', { name: `${draft.title} · 历史版本` })).toBeVisible();
  const rows = page.locator('.history-item');
  await expect(rows).toHaveCount(3);
  // 历史版本用唱片票根：唱片中心试听，标题是风格，摘录是第一句歌词，存根是时长。
  await expect(rows.locator('.record-cover')).toHaveCount(3);
  await expect(rows.locator('.history-meta b')).toHaveText(['版本 3', '版本 2', '版本 1']);
  await expect(rows.nth(1).locator('.project-excerpt')).toHaveText('「第二版的第一句」');
  await expect(rows.nth(1).locator('.ticket-stamp')).toContainText('0:30');

  // 播放页：滚动歌词按段落估算时间，器乐间隔显示为省略号，关闭后回到历史页。
  await rows.nth(1).getByRole('button', { name: '在播放页打开 style v2', exact: true }).click();
  const playing = page.getByRole('dialog', { name: `${draft.title} · 播放页` });
  await expect(playing).toBeVisible();
  await expect(playing.getByRole('list', { name: '歌词' }).getByRole('listitem')).toHaveText(['• • •', '第二版的第一句', '第二版的第二句']);
  await lyricTools(page, playing, '歌词时间按歌曲时长估算');
  // 对比试听：顶栏切换到同一作品的其他版本，歌词随版本变化；切回上一版可以点按钮或按 B。
  await playing.getByRole('button', { name: '版本 2', exact: true }).click();
  await expect(page.getByRole('menuitem')).toHaveCount(3);
  await page.getByRole('menuitem', { name: /版本 3/ }).click();
  await expect(playing.getByRole('list', { name: '歌词' }).getByRole('listitem')).toHaveText(['• • •', '第三版的歌词']);
  await expect(playing.getByRole('button', { name: '版本 3', exact: true })).toBeVisible();
  await playing.getByRole('button', { name: '切回版本 2', exact: true }).click();
  await expect(playing.getByRole('list', { name: '歌词' }).getByRole('listitem')).toHaveText(['• • •', '第二版的第一句', '第二版的第二句']);
  await page.keyboard.press('b');
  await expect(playing.getByRole('button', { name: '切回版本 2', exact: true })).toBeVisible();
  await expect(playing.getByRole('list', { name: '歌词' }).getByRole('listitem')).toHaveText(['• • •', '第三版的歌词']);
  await playing.getByRole('button', { name: '关闭播放页', exact: true }).click();
  await expect(playing).toHaveCount(0);
  await expect(rows).toHaveCount(3);

  // 复用这一版：风格和歌词写回当前作品，回到创作页。
  await rows.nth(1).getByRole('button', { name: '音频操作', exact: true }).click();
  await expect(page.getByRole('menuitem')).toHaveText(['导出音频', '复用这一版的风格和歌词']);
  await page.getByRole('menuitem', { name: '复用这一版的风格和歌词', exact: true }).click();
  await expect(page.getByLabel('风格', { exact: true })).toHaveValue('style v2');
  await expect(page.getByLabel('歌词', { exact: true })).toHaveValue(/第二版的第一句/);

  // 删除只在历史页：取消不删，确认后列表减少。
  await transport.getByRole('button', { name: '历史版本', exact: true }).click();
  await rows.nth(2).getByRole('button', { name: `删除音频${draft.title}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '删除这条音频？' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(rows).toHaveCount(3);
  await rows.nth(2).getByRole('button', { name: `删除音频${draft.title}`, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '删除音频', exact: true }).click();
  await expect(rows).toHaveCount(2);
  await expect(rows.locator('.history-meta b')).toHaveText(['版本 2', '版本 1']);
  for (let n = 2; n > 0; n--) {
    await rows.first().getByRole('button', { name: `删除音频${draft.title}`, exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '删除音频', exact: true }).click();
    await expect(rows).toHaveCount(n - 1);
  }
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1')!).history);
  expect(saved).toEqual([]);
  // 版本删完后工具栏仍保留历史版本入口。
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(transport.getByRole('button', { name: '历史版本', exact: true })).toBeVisible();
});

// 播放页的歌词时间状态、校准、对齐、逐字编辑和导出都收在顶栏的“歌词工具”菜单里；status 是菜单分组标题里的时间来源说明。
// 往预览的音频库写入一段指定秒数的 220 Hz 正弦波，给播放页用。
async function seedTone(page: Page, name: string, seconds: number) {
  await page.evaluate(async ([name, seconds]) => {
    const rate = 8000, bytes = new Uint8Array(44 + rate * seconds * 2); const view = new DataView(bytes.buffer);
    const text = (offset: number, value: string) => bytes.set(new TextEncoder().encode(value), offset);
    text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVEfmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, rate * seconds * 2, true);
    for (let i = 0; i < rate * seconds; i++) view.setInt16(44 + i * 2, Math.round(Math.sin(i * 220 * Math.PI * 2 / rate) * 4000), true);
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('voice-workbench-audio', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('audio');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { const db = request.result; const tx = db.transaction('audio', 'readwrite'); tx.objectStore('audio').put(new Blob([bytes], { type: 'audio/wav' }), name); tx.oncomplete = () => { db.close(); resolve(); }; };
    });
  }, [name, seconds] as const);
}

async function lyricTools(page: Page, playing: Locator, status?: string, item?: RegExp) {
  await playing.getByRole('button', { name: '歌词工具', exact: true }).click();
  const menu = page.getByRole('menu');
  if (status) await expect(menu).toContainText(status);
  if (item) await menu.getByRole('menuitem', { name: item }).click(); else await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
}

test('播放页逐行校准歌词：按键标记、撤销，校准结果随版本保存并可清除', async ({ page }) => {
  const draft = { ...createMusicDraft('zh-CN'), id: 'f'.repeat(32) };
  const state = emptyState();
  state.drafts = [draft];
  state.history = [{ id: 'song', title: draft.title, fileName: 'song.wav', createdAt: '2026-09-15T12:00:00Z', duration: 6, settings: { ...draft, lyrics: '[intro]\n\n[verse]\n第一句\n第二句\n\n[chorus]\n第三句' } }];
  await page.goto('/');
  await seedTone(page, 'song.wav', 6);
  await seedState(page, state); await page.reload();
  await page.locator('.player .transport').getByRole('button', { name: '播放页', exact: true }).click();
  const playing = page.getByRole('dialog', { name: `${draft.title} · 播放页` });
  // 打开时焦点不落在关闭按钮上，避免一进来就出现焦点框和提示。
  await expect(playing.getByRole('button', { name: '关闭播放页', exact: true })).not.toBeFocused();
  await lyricTools(page, playing, '歌词时间按歌曲时长估算', /^校准歌词/);
  const sync = playing.getByRole('group', { name: '校准歌词' });
  // 开头的器乐段落从 0 秒开始，自动标好；之后每按一次 ↓ 标记下一行，退格撤销。
  await expect(sync).toContainText('1 / 4 行');
  await expect(playing.locator('.now-playing-line[data-target]')).toHaveText('第一句');
  await page.keyboard.press('ArrowDown');
  await expect(sync).toContainText('2 / 4 行');
  await page.keyboard.press('Backspace');
  await expect(sync).toContainText('1 / 4 行');
  await page.keyboard.press('ArrowDown');
  await sync.getByRole('button', { name: '下一行', exact: true }).click();
  await page.keyboard.press('ArrowDown');
  await expect(sync).toHaveCount(0);
  await lyricTools(page, playing, '歌词时间已校准');
  await expect(playing.getByRole('list', { name: '歌词' }).getByRole('listitem')).toHaveText(['• • •', '第一句', '第二句', '第三句']);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1')!).history[0].lyricTimes as number[]);
  expect(saved).toHaveLength(4);
  expect(saved[0]).toBe(0);
  expect([...saved].sort((a, b) => a - b)).toEqual(saved);
  // 清除校准后不再使用保存的时间。
  await lyricTools(page, playing, undefined, /^清除校准/);
  await lyricTools(page, playing, '歌词时间按歌曲时长估算');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1')!).history[0].lyricTimes)).toBeUndefined();
  await playing.getByRole('button', { name: '关闭播放页', exact: true }).click();
  await expect(playing).toHaveCount(0);
});

test('播放页校准歌词：保存失败时标记都还在、错误显示在页内，撤销一行重标后保存成功才退出校准', async ({ page }) => {
  const draft = { ...createMusicDraft('zh-CN'), id: 'e'.repeat(32) };
  const state = emptyState();
  state.drafts = [draft];
  state.history = [{ id: 'song', title: draft.title, fileName: 'song.wav', createdAt: '2026-09-15T12:00:00Z', duration: 6, settings: { ...draft, lyrics: '[intro]\n\n[verse]\n第一句\n第二句\n\n[chorus]\n第三句' } }];
  await page.goto('/');
  await seedTone(page, 'song.wav', 6);
  await seedState(page, state); await page.reload();
  await page.locator('.player .transport').getByRole('button', { name: '播放页', exact: true }).click();
  const playing = page.getByRole('dialog', { name: `${draft.title} · 播放页` });
  await lyricTools(page, playing, undefined, /^校准歌词/);
  const sync = playing.getByRole('group', { name: '校准歌词' });
  await expect(sync).toContainText('1 / 4 行');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(sync).toContainText('3 / 4 行');
  // 标完最后一行时保存失败：校准条还在、四行标记都保留，错误显示在播放页里而不是被全屏弹窗挡住的全局通知。
  await page.evaluate(() => window.__previewFail!('generation.lyricTimes', '@yovoice.error.stateSaveFailed'));
  await page.keyboard.press('ArrowDown');
  const notice = playing.getByTestId('now-playing-notice');
  await expect(notice).toContainText('状态保存失败');
  await expect(sync).toContainText('4 / 4 行');
  await expect(page.locator('.notifications .notice')).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1')!).history[0].lyricTimes)).toBeUndefined();
  // 撤销一行再标记：这次保存成功，退出校准并收起提示。
  await page.keyboard.press('Backspace');
  await expect(sync).toContainText('3 / 4 行');
  await page.keyboard.press('ArrowDown');
  await expect(sync).toHaveCount(0);
  await expect(notice).toHaveCount(0);
  await lyricTools(page, playing, '歌词时间已校准');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1')!).history[0].lyricTimes as number[]);
  expect(saved).toHaveLength(4);
});

test('播放页智能对齐歌词：没装对齐模型时去设置下载，装好后逐字对齐并随版本保存，清除校准一并清除', async ({ page }) => {
  const song = syntheticSong(songLyrics, .3);
  const draft = { ...createMusicDraft('zh-CN'), id: 'd'.repeat(32) };
  const state = emptyState();
  state.drafts = [draft];
  state.history = [{ id: 'song', title: draft.title, fileName: 'song.wav', createdAt: '2026-09-15T12:00:00Z', duration: song.duration, settings: { ...draft, lyrics: songLyrics } }];
  await page.goto('/');
  await page.evaluate(async (data: string) => {
    const bytes = Uint8Array.from(atob(data), char => char.charCodeAt(0));
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('voice-workbench-audio', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('audio');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { const db = request.result; const tx = db.transaction('audio', 'readwrite'); tx.objectStore('audio').put(new Blob([bytes], { type: 'audio/wav' }), 'song.wav'); tx.oncomplete = () => { db.close(); resolve(); }; };
    });
  }, Buffer.from(wavBytes(song.left, song.right, song.rate)).toString('base64'));
  await seedState(page, state); await page.reload();
  const open = async () => {
    await page.locator('.player .transport').getByRole('button', { name: '播放页', exact: true }).click();
    return page.getByRole('dialog', { name: `${draft.title} · 播放页` });
  };
  let playing = await open();
  // 对齐模型是可选下载：没装时按钮带去设置里的音乐模型页。
  await lyricTools(page, playing, undefined, /^智能对齐/);
  await expect(playing).toHaveCount(0);
  await expect(page.getByRole('tabpanel', { name: '音乐模型' })).toContainText('Lyric Aligner');
  await seedState(page, { ...state, models: [{ id: 'lyric-align-q8', path: 'Lyric-Align-GGUF', managed: true }] }); await page.reload();
  playing = await open();
  await lyricTools(page, playing, undefined, /^智能对齐/);
  await lyricTools(page, playing, '歌词已按演唱逐字对齐，可再手动校准');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1')!).history[0].lyricWords as { word: string }[]);
  expect(saved.map(word => word.word).join('')).toBe(songLyrics.split('\n').filter(line => !/^\[.*\]$/.test(line.trim())).join('').replace(/\s/g, ''));
  // 清除后回到按人声自动定位。
  await lyricTools(page, playing, undefined, /^清除校准/);
  await lyricTools(page, playing, '歌词时间按人声自动定位，可再校准');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1')!).history[0].lyricWords)).toBeUndefined();
});

test('播放页调整歌词时间：整句前后微调（后面跟着移或只改这一句）、逐字微调、跟唱打点，保存后随版本记录', async ({ page }) => {
  const draft = { ...createMusicDraft('zh-CN'), id: 'c'.repeat(32) };
  const state = emptyState();
  state.drafts = [draft];
  state.history = [{ id: 'song', title: draft.title, fileName: 'song.wav', createdAt: '2026-10-18T12:00:00Z', duration: 6, lyricTimes: [0, 1, 3, 4.5], settings: { ...draft, lyrics: '[intro]\n\n[verse]\n第一句\n第二句\n\n[chorus]\n第三句' } }];
  await page.goto('/');
  await page.evaluate(async () => {
    const rate = 8000, seconds = 6, bytes = new Uint8Array(44 + rate * seconds * 2); const view = new DataView(bytes.buffer);
    const text = (offset: number, value: string) => bytes.set(new TextEncoder().encode(value), offset);
    text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVEfmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, rate * seconds * 2, true);
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('voice-workbench-audio', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('audio');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { const db = request.result; const tx = db.transaction('audio', 'readwrite'); tx.objectStore('audio').put(new Blob([bytes], { type: 'audio/wav' }), 'song.wav'); tx.oncomplete = () => { db.close(); resolve(); }; };
    });
  });
  await seedState(page, state); await page.reload();
  await page.locator('.player .transport').getByRole('button', { name: '播放页', exact: true }).click();
  const playing = page.getByRole('dialog', { name: `${draft.title} · 播放页` });
  await playing.locator('audio').evaluate((audio: HTMLAudioElement) => { audio.pause(); audio.currentTime = 0; });
  await lyricTools(page, playing, undefined, /^调整歌词时间/);
  const editor = playing.getByRole('group', { name: '歌词时间调整' });
  await expect(editor).toContainText('第 1/3 句');
  await expect(playing.locator('.now-playing-line[data-editing]')).toHaveText('第一句');
  await expect(editor).toContainText('0:01.00');
  // → 整句推后 0.1 秒，默认后面的句子跟着移；换成“只改这一句”后再推后 0.1 秒，后面的句子不动。
  await page.keyboard.press('ArrowRight');
  await expect(editor).toContainText('0:01.10');
  await editor.getByRole('radio', { name: '只改这一句' }).click();
  await editor.getByRole('button', { name: '推后 0.1 秒', exact: true }).click();
  await expect(editor).toContainText('0:01.20');
  // 选中“一”，→ 往后挪 0.05 秒、Shift+← 往前挪 0.01 秒，只改这个字。
  const word = editor.getByRole('button', { name: '一', exact: true });
  await word.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(word).toHaveAttribute('aria-pressed', 'true');
  // 暂停时点歌词里的一句只是选中它；换到下一句后可以跟唱打点。
  await playing.getByRole('list', { name: '歌词' }).getByText('第二句', { exact: true }).click();
  await expect(editor).toContainText('第 2/3 句');
  await editor.getByRole('button', { name: '跟唱打点', exact: true }).click();
  await expect(editor.getByRole('button', { name: '停止打点', exact: true })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(editor.getByRole('button', { name: '二', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await editor.getByRole('button', { name: '停止打点', exact: true }).click();
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await lyricTools(page, playing, '歌词已按演唱逐字对齐，可再手动校准');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1')!).history[0]);
  expect(saved.lyricTimes).toBeUndefined();
  expect(saved.lyricWords.map((entry: { word: string }) => entry.word).join('')).toBe('第一句第二句第三句');
  const starts = saved.lyricWords.map((entry: { start: number }) => entry.start);
  expect([...starts].sort((a: number, b: number) => a - b)).toEqual(starts);
  // 第一句从 1 秒推后到 1.2 秒，“一”多晚 0.04 秒；第三句只跟着第一次推后了 0.1 秒。
  expect(starts[0]).toBeCloseTo(1.2, 3);
  expect(Math.round((saved.lyricWords[1].start - saved.lyricWords[0].end) * 100)).toBe(4);
  expect(starts[6]).toBeCloseTo(4.6, 3);
});

test('播放页按音频里的人声自动定位歌词，点歌词跳到这一句实际开始唱的位置', async ({ page }) => {
  const song = syntheticSong(songLyrics, .3);
  const draft = { ...createMusicDraft('zh-CN'), id: 'e'.repeat(32) };
  const state = emptyState();
  state.drafts = [draft];
  state.history = [{ id: 'song', title: draft.title, fileName: 'song.wav', createdAt: '2026-09-15T12:00:00Z', duration: song.duration, settings: { ...draft, lyrics: songLyrics } }];
  await page.goto('/');
  await page.evaluate(async (data: string) => {
    const bytes = Uint8Array.from(atob(data), char => char.charCodeAt(0));
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('voice-workbench-audio', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('audio');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { const db = request.result; const tx = db.transaction('audio', 'readwrite'); tx.objectStore('audio').put(new Blob([bytes], { type: 'audio/wav' }), 'song.wav'); tx.oncomplete = () => { db.close(); resolve(); }; };
    });
  }, Buffer.from(wavBytes(song.left, song.right, song.rate)).toString('base64'));
  await seedState(page, state); await page.reload();
  await page.locator('.player .transport').getByRole('button', { name: '播放页', exact: true }).click();
  const playing = page.getByRole('dialog', { name: `${draft.title} · 播放页` });
  await lyricTools(page, playing, '歌词时间按人声自动定位，可再校准');
  // 点副歌第一句，播放位置跳到它实际开始唱的时间附近；点击后会继续播放，所以记录跳转那一刻的位置。
  const index = song.rows.findIndex(row => row.text === '就这样一起走到天亮');
  await playing.locator('audio').evaluate((audio: HTMLAudioElement) => audio.addEventListener('seeking', () => { audio.dataset.seekedTo = String(audio.currentTime); }));
  await playing.getByRole('list', { name: '歌词' }).getByText('就这样一起走到天亮', { exact: true }).click();
  await expect.poll(() => playing.locator('audio').evaluate((audio: HTMLAudioElement) => Number(audio.dataset.seekedTo ?? -1))).toBeGreaterThan(song.starts[index] - .6);
  expect(Number(await playing.locator('audio').getAttribute('data-seeked-to'))).toBeLessThan(song.starts[index] + .6);
});

test('播放页当前句逐字点亮，可切换到一句一屏的浮光样式，选择记在本机', async ({ page }) => {
  const song = syntheticSong(songLyrics, .3);
  const draft = { ...createMusicDraft('zh-CN'), id: 'e'.repeat(32) };
  const state = emptyState();
  state.drafts = [draft];
  state.history = [{ id: 'song', title: draft.title, fileName: 'song.wav', createdAt: '2026-09-15T12:00:00Z', duration: song.duration, settings: { ...draft, lyrics: songLyrics } }];
  await page.goto('/');
  await page.evaluate(async (data: string) => {
    const bytes = Uint8Array.from(atob(data), char => char.charCodeAt(0));
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('voice-workbench-audio', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('audio');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { const db = request.result; const tx = db.transaction('audio', 'readwrite'); tx.objectStore('audio').put(new Blob([bytes], { type: 'audio/wav' }), 'song.wav'); tx.oncomplete = () => { db.close(); resolve(); }; };
    });
  }, Buffer.from(wavBytes(song.left, song.right, song.rate)).toString('base64'));
  await seedState(page, state); await page.reload();
  await page.locator('.player .transport').getByRole('button', { name: '播放页', exact: true }).click();
  const playing = page.getByRole('dialog', { name: `${draft.title} · 播放页` });
  await lyricTools(page, playing, '歌词时间按人声自动定位，可再校准');
  // 停在副歌第一句唱到一半：前面的字已唱过，后面的字还没唱。
  const index = song.rows.findIndex(row => row.text === '就这样一起走到天亮');
  await playing.locator('audio').evaluate((audio: HTMLAudioElement, time: number) => { audio.pause(); audio.currentTime = time; }, song.words[index][5] - .1);
  const words = playing.locator('.now-playing-line[data-state="current"] .now-playing-word');
  await expect(words).toHaveText([...'就这样一起走到天亮']);
  await expect(words.first()).toHaveAttribute('data-sung', 'done');
  await expect(words.last()).toHaveAttribute('data-sung', 'waiting');
  // 换成浮光：只显示当前句和下一句预告，校准时仍回到滚动歌词。
  await playing.getByRole('button', { name: '滚动歌词', exact: true }).click();
  await page.getByRole('menuitem', { name: /浮光/ }).click();
  await expect(playing.getByRole('list', { name: '歌词' })).toHaveCount(0);
  const current = playing.locator('.now-playing-phrase[data-slot="current"]');
  await expect(current).toHaveText('就这样一起走到天亮');
  await expect(current.locator('.now-playing-glyph').first()).toHaveAttribute('data-sung', 'done');
  await expect(playing.locator('.now-playing-phrase[data-slot="next"]')).toHaveText('夏天不会太长');
  await lyricTools(page, playing, undefined, /^校准歌词/);
  await expect(playing.getByRole('list', { name: '歌词' })).toBeVisible();
  await playing.getByRole('button', { name: '取消校准', exact: true }).click();
  await expect(current).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('yovoice-lyric-style'))).toBe('stage');
});

test('新建作品默认用已下载的模型，并沿用上一次同类作品的选择', async ({ page }) => {
  const state = emptyState();
  const older = { ...createMusicDraft('zh-CN'), id: 'a'.repeat(32), modelId: 'ace-step-1.5-turbo-q8', updatedAt: '2026-10-01T00:00:00Z' };
  const recent = { ...createMusicDraft('zh-CN'), id: 'b'.repeat(32), modelId: 'yue2-3b-q4', updatedAt: '2026-10-02T00:00:00Z' };
  state.drafts = [older, recent];
  state.models = [{ id: 'ace-step-1.5-turbo-q8', path: 'ace', managed: true }, { id: 'yue2-3b-q4', path: 'yue', managed: true }];
  await seedState(page, state);
  await page.goto('/');
  await page.getByTestId('nav-new').click();
  await page.getByRole('menuitem', { name: '音乐生成', exact: true }).click();
  const model = page.getByRole('combobox', { name: '模型' });
  await expect(model).toContainText('YuE2 3B');
  // 选择器只列已下载的模型。
  await model.click();
  await expect(page.getByRole('option')).toHaveText([/^ACE-Step 1.5 Turbo\s*Q8 · 已安装/, /^YuE2 3B\s*Q4 · 已安装/, '管理模型…']);
});

test('同一模型下载了多个精度时选择器只列一项，在下方切换精度', async ({ page }) => {
  const state = emptyState();
  state.drafts = [{ ...createMusicDraft('zh-CN'), id: 'b'.repeat(32), modelId: 'yue2-3b-q4' }];
  state.models = [{ id: 'ace-step-1.5-turbo-q8', path: 'ace', managed: true }, { id: 'yue2-3b-q4', path: 'yue', managed: true }, { id: 'yue2-3b-q8', path: 'yue8', managed: true }];
  await seedState(page, state);
  await page.goto('/');
  const model = page.getByRole('combobox', { name: '模型' });
  await expect(model).toContainText('YuE2 3B · Q4');
  await model.click();
  await expect(page.getByRole('option')).toHaveText([/^ACE-Step 1.5 Turbo/, /^YuE2 3B\s*Q8 · Q4/, '管理模型…']);
  await page.keyboard.press('Escape');
  const precision = page.getByRole('radiogroup', { name: '精度' });
  await expect(precision.getByRole('radio')).toHaveText(['Q8', 'Q4']);
  await precision.getByRole('radio', { name: 'Q8' }).click();
  await expect(page.getByRole('radio', { name: 'Q8' })).toBeChecked();
});
