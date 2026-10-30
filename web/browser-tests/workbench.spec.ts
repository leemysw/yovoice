import { openProjectHistory } from './project-actions';
import { seedState } from './seed';
import { emptyState } from '../src/shared/workbench';
import { test, expect } from '@playwright/test';


test('四种表达方式、草稿持久化与模型协议', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByLabel('作品名称')).toHaveValue('清晨旁白');
  await page.getByRole('radio', { name: '跟随音色', exact: true }).click();
  await expect(page.getByRole('radio', { name: '跟随音色', exact: true })).toBeChecked();
  await expect(page.getByText('沿用参考音色中的自然表达。')).toHaveCount(0);
  await page.getByRole('radio', { name: '参考演绎', exact: true }).click();
  await expect(page.getByRole('button', { name: '添加演绎参考' })).toBeVisible();
  await page.getByRole('radio', { name: '情绪调节', exact: true }).click();
  await expect(page.getByRole('group', { name: '情绪预设', exact: true }).getByRole('button')).toHaveCount(3);
  const more = page.getByRole('button', { name: '更多情绪', exact: true });
  const tuning = page.getByRole('button', { name: '微调情绪', exact: true });
  await more.hover();
  await expect(more).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(more).toHaveCSS('background-image', 'none');
  const moreBox = await more.boundingBox();
  const tuningBox = await tuning.boundingBox();
  expect(moreBox!.x).toBe(tuningBox!.x);
  expect(moreBox!.height).toBe(tuningBox!.height);
  expect((await more.locator('svg').boundingBox())!.x).toBe((await tuning.locator('svg').boundingBox())!.x);
  await page.getByRole('button', { name: '更多情绪', exact: true }).click();
  await page.getByText('微调情绪', { exact: true }).click();
  await expect(page.getByRole('slider', { name: '高兴', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '惊喜', exact: true }).click();
  await expect(page.getByRole('button', { name: '惊喜', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('slider', { name: '高兴', exact: true })).toHaveAttribute('aria-valuenow', '0.4');
  await page.getByRole('slider', { name: '高兴', exact: true }).press('ArrowRight');
  await expect(page.getByRole('button', { name: '惊喜', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: '悲伤', exact: true }).click();
  await expect(page.getByRole('slider', { name: '悲伤', exact: true })).toHaveAttribute('aria-valuenow', '0.5');
  await page.getByRole('button', { name: '收起情绪', exact: true }).click();
  await expect(page.getByRole('button', { name: '悲伤', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '更多情绪', exact: true }).click();
  await expect(page.getByRole('button', { name: '悲伤', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '重置', exact: true }).click();
  await expect(page.getByRole('slider', { name: '惊讶', exact: true })).toHaveAttribute('aria-valuenow', '0');
  await page.getByRole('radio', { name: '文字指导', exact: true }).click();
  await page.getByLabel('作品名称').fill('测试旁白');
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByLabel('作品名称')).toHaveValue('测试旁白');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  // 语音模型与音乐模型分页显示，各自带下载设置。
  await page.getByRole('tab', { name: '音乐模型', exact: true }).click();
  // 同一模型的多种量化合并为一行，用精度切换；含可选的歌词对齐模型。
  await expect(page.getByRole('button', { name: '下载模型', exact: true })).toHaveCount(8);
  const yue = page.locator('[data-model-id^="yue2-"]');
  await expect(yue).toHaveCount(1);
  await expect(yue).toHaveAttribute('data-model-id', 'yue2-3b-q8');
  await yue.getByRole('radio', { name: 'BF16' }).click();
  await expect(yue).toHaveAttribute('data-model-id', 'yue2-3b-bf16');
  await expect(yue.locator('.model-size')).toHaveText('7.53 GB');
  await expect(page.getByLabel('下载来源', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '语音模型', exact: true }).click();
  await expect(page.getByRole('button', { name: '下载模型', exact: true })).toHaveCount(18);
  await expect(page.locator('[data-model-id^="ace-step-"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'IndexTTS 协议' }).click();
  await expect(page.getByRole('heading', { name: '模型使用协议' })).toBeVisible();
  await page.getByRole('button', { name: '关闭协议' }).click();
  expect(errors).toEqual([]);
});

test('真实 WAV 导入、播放、裁剪和空状态', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '添加参考音频', exact: true }).click();
  const wav = Buffer.alloc(44 + 16000 * 2 * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  for (let i = 0; i < 32000; i++) wav.writeInt16LE(Math.round(Math.sin(i * 440 * Math.PI * 2 / 16000) * 8000), 44 + i * 2);
  await page.locator('input[type=file][accept^="audio/"]').setInputFiles({ name: '测试音色.wav', mimeType: 'audio/wav', buffer: wav });
  await page.getByRole('button', { name: '使用所选参考音频', exact: true }).click();
  await expect(page.getByRole('button', { name: '测试音色', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '试听当前音色' }).click();
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  const progress = page.getByRole('slider', { name: '播放进度' });
  await expect(progress).toBeVisible();
  const lane = page.locator('.timeline-lane');
  const originalWidth = await page.locator('.waveform').evaluate(el => el.getBoundingClientRect().width);
  await page.getByRole('button', { name: '放大音轨', exact: true }).click();
  await expect(page.getByRole('button', { name: '适应完整音轨' })).toHaveText('200%');
  await expect.poll(() => page.locator('.waveform').evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThan(originalWidth * 1.9);
  await lane.evaluate(el => { el.scrollLeft = el.scrollWidth; });
  expect(await lane.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  await progress.fill('1.5');
  await expect.poll(() => page.locator('footer audio').evaluate((el: HTMLAudioElement) => el.currentTime)).toBeCloseTo(1.5, 1);
  await page.getByRole('button', { name: '适应完整音轨' }).click();
  await expect(page.getByRole('button', { name: '缩小音轨' })).toBeDisabled();
  await expect.poll(() => lane.evaluate(el => el.scrollLeft)).toBe(0);
  await progress.fill('1');
  await expect.poll(() => page.locator('footer audio').evaluate((el: HTMLAudioElement) => el.currentTime)).toBeCloseTo(1, 1);
  await page.getByRole('button', { name: '回到开头' }).click();
  await expect(progress).toHaveValue('0');
  await page.getByRole('button', { name: '静音', exact: true }).click();
  await expect.poll(() => page.locator('footer audio').evaluate((el: HTMLAudioElement) => el.volume)).toBe(0);
  await page.getByRole('button', { name: '取消静音' }).click();
  await page.getByRole('button', { name: '测试音色', exact: true }).click();
  const picker = page.getByRole('dialog');
  await picker.getByRole('button', { name: '试听测试音色', exact: true }).click({ trial: true });
  const list = picker.locator('.voice-list');
  // 弹窗打开时有缩放动画，等动画结束再记录尺寸，否则 macOS CI 上会量到动画中途的大小。
  await picker.evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished)));
  const listBox = await list.boundingBox();
  const dialogBox = await picker.boundingBox();
  const firstRow = picker.locator('.voice-row').filter({ has: page.getByRole('button', { name: '测试音色', exact: true }) });
  const audition = firstRow.getByRole('button', { name: '试听测试音色', exact: true });
  await audition.click();
  await expect(firstRow.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await expect(picker.locator('.library-preview')).toHaveCount(0);
  expect(await list.boundingBox()).toEqual(listBox);
  expect(await picker.boundingBox()).toEqual(dialogBox);
  const audio = firstRow.locator('audio');
  await firstRow.getByRole('button', { name: '暂停', exact: true }).click();
  await expect(audition).toBeVisible();
  await audio.evaluate((element: HTMLAudioElement) => { element.currentTime = 0.7; });
  await audition.click();
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => !element.paused && element.currentTime >= 0.7)).toBeTruthy();
  await audio.evaluate((element: HTMLAudioElement) => { element.currentTime = element.duration; });
  await expect(audition).toBeVisible();
  await page.getByRole('button', { name: '裁剪', exact: true }).click();
  await page.getByRole('button', { name: '另存为新音色' }).click();
  const secondRow = picker.locator('.voice-row').filter({ has: page.getByRole('button', { name: '测试音色 · 裁剪', exact: true }) });
  await audition.click();
  await expect(firstRow.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await secondRow.getByRole('button', { name: '试听测试音色 · 裁剪', exact: true }).click();
  await expect(secondRow.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await expect(audition).toBeVisible();
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.paused)).toBeTruthy();
  const playingAudio = await secondRow.locator('audio').elementHandle();
  await page.getByRole('button', { name: '使用所选参考音频', exact: true }).click();
  await expect(page.getByRole('button', { name: '测试音色 · 裁剪', exact: true })).toBeVisible();
  expect(await playingAudio!.evaluate((element: HTMLAudioElement) => element.paused)).toBe(true);
  await page.getByRole('button', { name: '声音库', exact: true }).click();
  await page.getByRole('tab', { name: '参考音频', exact: true }).click();
  await expect(page.locator('footer.player')).toBeHidden();
  await page.getByRole('button', { name: '添加参考音频', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: '添加参考音频' })).toBeVisible();
  await expect(page.getByRole('dialog').locator('.voice-list')).toHaveCount(0);
  await page.locator('input[type=file][accept^="audio/"]').setInputFiles({ name: '新增音色.wav', mimeType: 'audio/wav', buffer: wav });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '新增音色', exact: true })).toBeVisible();
  await page.locator('.recent-projects .project-link').first().click();
  await expect(page.getByRole('button', { name: '测试音色 · 裁剪', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '声音库', exact: true }).click();
  await page.getByRole('tab', { name: '参考音频', exact: true }).click();

  const entry = page.locator('.library-entry').filter({ has: page.getByRole('heading', { name: '测试音色', exact: true }) });
  await entry.click({ position: { x: 150, y: 20 } });
  const controls = page.locator('.library-entry').filter({ has: page.getByRole('heading', { name: '测试音色', exact: true }) }).locator('.avatar-player');
  const preview = controls.locator('audio');
  await expect.poll(() => preview.evaluate((audio: HTMLAudioElement) => !audio.paused && audio.currentTime > 0)).toBeTruthy();
  await expect(controls).toHaveAttribute('data-playing', 'true');
  await expect(controls.locator('img')).toHaveCSS('width', '48px');
  await expect(controls.locator('img')).toHaveCSS('animation-name', 'none');
  await entry.click({ position: { x: 150, y: 20 } });
  await expect.poll(() => preview.evaluate((audio: HTMLAudioElement) => audio.paused)).toBeTruthy();
  await expect(controls).toHaveAttribute('data-playing', 'false');
  await expect.poll(() => preview.evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBe(0);
  const cardBox = (await entry.boundingBox())!;
  const avatarBox = (await controls.boundingBox())!;
  expect(Math.abs(avatarBox.y + avatarBox.height / 2 - cardBox.y - cardBox.height / 2)).toBeLessThan(1);
  await preview.evaluate((audio: HTMLAudioElement) => { audio.currentTime = 1; });
  const play = controls.getByRole('button', { name: '试听测试音色', exact: true });
  await play.focus();
  await expect(play).toBeFocused();
  await play.press('Enter');
  await expect.poll(() => preview.evaluate((audio: HTMLAudioElement) => !audio.paused && audio.currentTime < 1)).toBeTruthy();
  await preview.evaluate((audio: HTMLAudioElement) => { audio.currentTime = audio.duration; });
  await expect(controls).toHaveAttribute('data-playing', 'false');
  await play.click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '语音模型', exact: true }).click();
  await expect.poll(() => page.locator('audio').evaluateAll(elements => elements.every(el => (el as HTMLAudioElement).paused))).toBeTruthy();
  await page.getByTestId('nav-story').click();
  await expect(page.locator('footer.player')).toBeHidden();
  await page.locator('.recent-projects .project-link').first().click();
  await expect(page.locator('footer.player')).toBeVisible();
  await expect.poll(() => page.locator('footer audio').evaluate((audio: HTMLAudioElement) => audio.paused)).toBeTruthy();
});


test('选中文字显示发音浮层，键盘与鼠标交互应用后只修改选区', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByRole('textbox', { name: '正文', exact: true });
  const action = page.getByRole('button', { name: '调整发音', exact: true });
  await expect(action).toHaveCount(0);
  await expect(page.getByRole('button', { name: '段间停顿', exact: true })).toHaveCount(0);
  await editor.fill('银行需要核对资料。');
  await editor.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(0, 0));
  await editor.press('Shift+ArrowRight'); await editor.press('Shift+ArrowRight');
  await expect(action).toBeVisible();
  // 验证键盘 Tab 聚焦与 Enter 触发
  await editor.press('Tab');
  await expect(action).toBeFocused();
  await action.press('Enter');
  await expect(page.getByRole('dialog')).toContainText('银行');
  await page.getByPlaceholder('例如 HANG2').fill('YIN2 HANG2');
  await page.getByRole('button', { name: '应用发音' }).click();
  await expect(editor).toHaveValue('<银行|YIN2 HANG2>需要核对资料。');
  await expect(action).toHaveCount(0);
  // 关闭对话框后重新聚焦，验证鼠标点击选区与浮层交互
  await editor.focus();
  await expect(async () => {
    await editor.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(0, 0)); await editor.press('Shift+ArrowRight');
    await expect(action).toBeVisible({ timeout: 1000 });
  }).toPass();
  await action.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await editor.press('ArrowRight'); await expect(action).toHaveCount(0);
  await editor.press('Shift+ArrowLeft'); await expect(action).toBeVisible();
  await editor.press('Escape'); await expect(action).toHaveCount(0);
  await page.locator('.advanced summary').click();
  await expect(page.getByRole('spinbutton', { name: '段间停顿（毫秒）' })).toBeVisible();
});



test('语音生成只有历史生成：工具栏进入历史页，试听不改正文，删除在历史页', async ({ page }) => {
  const state = emptyState();
  const draft = state.drafts[0];
  state.history = [
    { id: 'new', title: draft.title, fileName: 'history.wav', createdAt: '2026-09-15T10:00:00Z', duration: 1, settings: { ...draft, mode: 'text', speed: 1.2, text: '新版正文' } },
    { id: 'old', title: draft.title, fileName: 'history.wav', createdAt: '2026-09-15T09:00:00Z', duration: 1, settings: { ...draft, modelId: 'index-2-q8', mode: 'speaker', speed: 0.8, text: '旧版正文' } },
    { id: 'other', title: '其他作品', fileName: 'history.wav', createdAt: '2026-09-15T08:00:00Z', duration: 1, settings: { ...draft, id: 'other' } },
  ];
  await page.goto('/');
  await page.evaluate(async () => {
    const bytes = new Uint8Array(32044); const view = new DataView(bytes.buffer);
    const text = (offset: number, value: string) => bytes.set(new TextEncoder().encode(value), offset);
    text(0, 'RIFF'); view.setUint32(4, 32036, true); text(8, 'WAVEfmt '); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, 32000, true);
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('voice-workbench-audio', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('audio');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { const db = request.result; const tx = db.transaction('audio', 'readwrite'); tx.objectStore('audio').put(new Blob([bytes], { type: 'audio/wav' }), 'history.wav'); tx.oncomplete = () => { db.close(); resolve(); }; };
    });
  });
  await seedState(page, state); await page.reload();
  // 语音生成定位为临时生成：播放器左侧不再有版本下拉，也没有“新增音轨”。
  await expect(page.getByRole('combobox', { name: '当前作品历史' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '新增音轨', exact: true })).toHaveCount(0);
  await expect(page.locator('.player .waveform')).toBeVisible();
  await expect.poll(() => page.locator('footer audio').evaluate((audio: HTMLAudioElement) => audio.duration)).toBe(1);
  // 工具栏放打开位置、历史生成和“音频操作”菜单（导出在菜单里）；删除只在历史页；“保存为角色”在右侧角色选择里。
  const transport = page.locator('.player .transport');
  await expect(transport.getByRole('button', { name: '打开位置', exact: true })).toBeVisible();
  await expect(transport.getByRole('button', { name: '导出音频', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '保存为角色', exact: true })).toHaveCount(0);
  await transport.getByRole('button', { name: '音频操作', exact: true }).click();
  await expect(page.getByRole('menuitem')).toHaveText(['导出音频', '保存为参考音频', '保存为角色']);
  await page.keyboard.press('Escape');

  // 历史生成汇总所有语音作品的结果，不分版本；改过名的显示名称，其余显示正文。
  await openProjectHistory(page);
  await expect(page.getByRole('heading', { name: '历史生成', exact: true })).toBeVisible();
  const rows = page.locator('.history-item');
  await expect(rows.locator('h3')).toHaveText(['新版正文', '旧版正文', '其他作品']);
  await expect(rows.locator('.history-meta').filter({ hasText: '版本' })).toHaveCount(0);
  // 历史用磁带票根展示，试听时只有这一盒加载音频。
  await expect(rows.locator('.tape-cover')).toHaveCount(3);
  await rows.nth(1).getByRole('button', { name: '试听旧版正文', exact: true }).click();
  await expect(rows.locator('audio[src]')).toHaveCount(1);
  await expect(rows.nth(1).locator('audio[src]')).toHaveCount(1);
  await rows.first().getByRole('button', { name: `删除音频${draft.title}`, exact: true }).click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(rows).toHaveCount(3);
  // 生成结果连同当时的参数一起存为角色：角色编辑器带着名称、模型和语速打开，保存后进入声音库。
  await rows.nth(1).getByRole('button', { name: '音频操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '保存为角色', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '角色名称' })).toHaveValue(draft.title);
  await expect(page.getByRole('combobox', { name: '模型', exact: true })).toContainText('IndexTTS 2');
  await page.getByRole('button', { name: '保存角色', exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1') ?? '{}').characters?.map((c: { name: string; settings: { speed: number } }) => `${c.name}:${c.settings.speed}`))).toEqual([`${draft.title}:0.8`]);
  await page.getByTestId('nav-text').click();
  await openProjectHistory(page);
  await rows.first().getByRole('button', { name: `删除音频${draft.title}`, exact: true }).click();
  await page.getByRole('button', { name: '删除音频', exact: true }).click();
  await expect(rows).toHaveCount(2);
  await expect(page.locator('.history-item audio[src]')).toHaveCount(0);

  // 返回作品：试听和删除都不改正文与参数。
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(page.getByLabel('正文', { exact: true })).toHaveValue(draft.text);
  await expect(page.getByRole('radio', { name: '文字指导', exact: true })).toBeChecked();
  await expect(page.getByRole('combobox', { name: '模型', exact: true })).toContainText('IndexTTS 2.5');
  await page.reload();
  await expect(transport.getByRole('button', { name: '打开位置', exact: true })).toBeVisible();
  // 新建的语音作品没有自己的音频，但仍能从工具栏查看历史生成。
  await page.getByTestId('nav-new').click();
  await page.getByRole('menuitem', { name: '语音生成', exact: true }).click();
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeDisabled();
  await expect(transport.getByRole('button', { name: '打开位置', exact: true })).toHaveCount(0);
  await expect(transport.getByRole('button', { name: '历史生成', exact: true })).toBeVisible();
});




test('OmniVoice 和 Qwen3-TTS 使用各自的声音控件', async ({ page }) => {
  await page.goto('/');
  const model = page.getByRole('combobox', { name: '模型', exact: true });
  await model.click();
  await page.getByRole('option', { name: /^OmniVoice/ }).click();
  await expect(page.getByRole('radio', { name: '声音设计', exact: true })).toBeChecked();
  await expect(page.getByRole('button', { name: '添加参考音频', exact: true })).toHaveCount(0);
  await page.getByRole('combobox', { name: '性别', exact: true }).click();
  const genderTrigger = await page.getByRole('combobox', { name: '性别', exact: true }).boundingBox();
  const genderMenu = await page.getByRole('listbox').boundingBox();
  expect(genderMenu!.y).toBeGreaterThanOrEqual(genderTrigger!.y + genderTrigger!.height);
  await page.getByRole('option', { name: '女', exact: true }).click();
  await page.locator('summary').filter({ hasText: '非语言声音' }).click();
  const tags = page.getByRole('combobox', { name: '非语言声音', exact: true });
  await tags.click();
  const tagTrigger = await tags.boundingBox();
  const tagMenu = await page.getByRole('listbox').boundingBox();
  expect(tagMenu!.y >= tagTrigger!.y + tagTrigger!.height || tagMenu!.y + tagMenu!.height <= tagTrigger!.y).toBe(true);
  await page.getByRole('option', { name: '[laughter]', exact: true }).click();
  await expect(page.getByLabel('正文', { exact: true })).toHaveValue(/\[laughter\]$/);
  await page.getByRole('radio', { name: '音色克隆', exact: true }).click();
  await expect(page.getByRole('button', { name: '添加参考音频', exact: true })).toBeVisible();
  await page.getByLabel('参考音频原文').fill('你好。');
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('radio', { name: '音色克隆', exact: true })).toBeChecked();
  await expect(page.getByLabel('参考音频原文')).toHaveValue('你好。');
  await model.click();
  await page.getByRole('option', { name: /^Qwen3-TTS 1.7B Base/ }).click();
  await expect(page.getByRole('button', { name: '添加参考音频', exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: '声音设计', exact: true })).toHaveCount(0);
  await expect(page.getByRole('radio', { name: '情绪调节', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('参考音频原文（可选）')).toHaveValue('你好。');
});

test('Breeze TTS 2 在设计与克隆间切换描述用途，并以短分段为默认', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: '模型', exact: true }).click();
  await page.getByRole('option', { name: /^Breeze TTS 2/ }).click();
  await expect(page.getByRole('radio', { name: '声音设计', exact: true })).toBeChecked();
  await expect(page.getByRole('button', { name: '添加参考音频', exact: true })).toHaveCount(0);
  await page.getByLabel('声音描述', { exact: true }).fill('温暖的女声，语速平稳');
  await page.getByRole('radio', { name: '音色克隆', exact: true }).click();
  await expect(page.getByRole('button', { name: '添加参考音频', exact: true })).toBeVisible();
  await expect(page.getByLabel('参考音频原文', { exact: true })).toBeVisible();
  await expect(page.getByLabel('风格指导（可选）', { exact: true })).toHaveValue('温暖的女声，语速平稳');
  await page.locator('summary').filter({ hasText: '高级设置' }).click();
  await expect(page.getByLabel('长文分段字数（0 为模型默认）')).toHaveValue('160');
  await expect(page.getByLabel('细节解码温度')).toHaveValue('0.9');
});



test('Ming 3.0 TTS 在设计与克隆间切换并提供七种语言', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: '模型', exact: true }).click();
  await page.getByRole('option', { name: /^Ming 3\.0 TTS/ }).click();
  await expect(page.getByRole('radio', { name: '声音设计', exact: true })).toBeChecked();
  await expect(page.getByRole('button', { name: '添加参考音频', exact: true })).toHaveCount(0);
  await page.getByLabel('声音描述', { exact: true }).fill('温暖平静的女声');
  const language = page.getByRole('combobox', { name: '语言', exact: true });
  await language.click();
  await expect(page.getByRole('option')).toHaveText(['自动', '中文', '英语', '日语', '韩语', '德语', '法语', '西班牙语']);
  await page.getByRole('option', { name: '日语', exact: true }).click();
  await page.getByRole('radio', { name: '音色克隆', exact: true }).click();
  await expect(page.getByRole('button', { name: '添加参考音频', exact: true })).toBeVisible();
  await expect(page.getByLabel('参考音频原文（可选）', { exact: true })).toBeVisible();
  await expect(page.getByLabel('声音描述', { exact: true })).toHaveCount(0);
  await page.locator('summary').filter({ hasText: '高级设置' }).click();
  await expect(page.getByLabel('长文分段字数（0 为模型默认）')).toHaveValue('0');
  await expect(page.getByLabel('温度', { exact: true })).toHaveValue('0');
  await expect(page.getByLabel('裁剪静音', { exact: true })).toBeChecked();
});


test('作品音频读不到时播放器直接显示不可用，不主动弹出提示', async ({ page }) => {
  const state = emptyState();
  const draft = state.drafts[0];
  state.history = [{ id: 'broken', title: draft.title, fileName: 'broken.wav', createdAt: '2026-09-15T10:00:00Z', duration: 1, settings: { ...draft } }];
  await page.goto('/');
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('voice-workbench-audio', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('audio');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { const db = request.result; const tx = db.transaction('audio', 'readwrite'); tx.objectStore('audio').put(new Blob([new Uint8Array(64)], { type: 'audio/wav' }), 'broken.wav'); tx.oncomplete = () => { db.close(); resolve(); }; };
    });
  });
  await seedState(page, state); await page.reload();
  await expect(page.locator('.player .transport').getByRole('button', { name: '历史生成', exact: true })).toBeVisible();
  await expect(page.locator('.player .waveform-unavailable')).toHaveText('音频文件不存在或无法读取');
  await expect(page.locator('.player').getByRole('button', { name: '播放', exact: true })).toBeDisabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('窄屏下展开检查器：保持宽屏时的固定宽度，不覆盖全屏且不隐藏正文，无返回正文按钮', async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 720 });
  await page.goto('/');
  await expect(page.getByLabel('作品名称')).toHaveValue('清晨旁白');
  const inspector = page.locator('.inspector');
  const document = page.locator('.document');
  const toggleBtn = page.locator('.browser-titlebar').getByRole('button', { name: /右侧面板/ });
  await expect(toggleBtn).toBeVisible();

  // 点击展开检查器
  await toggleBtn.click();
  await expect(page.locator('.studio')).toHaveClass(/show-inspector/);
  await expect(inspector).toBeVisible();
  // 正文仍然可见，没有被全屏覆盖
  await expect(document).toBeVisible();
  // 检查器中没有“返回正文”按钮
  await expect(inspector.getByRole('button', { name: '返回正文' })).toHaveCount(0);

  // 检查 inspector 宽度等于宽屏时的宽度（约 352px），而不是 100% 全屏
  const box = await inspector.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeLessThan(400);
  expect(box!.width).toBeGreaterThan(300);
});

test('生成结果体检有问题时，播放栏显示提醒和问题位置', async ({ page }) => {
  const state = emptyState();
  const draft = state.drafts[0];
  state.history = [{
    id: 'checked', title: draft.title, fileName: 'checked.wav', createdAt: '2026-09-15T10:00:00Z', duration: 1, settings: { ...draft },
    check: { loudness: -20, peak: 0, issues: [{ code: 'clipping', at: 0.5, count: 3 }, { code: 'cutoff', at: 0.9 }, { code: 'dc', at: 0 }] },
  }];
  await page.goto('/');
  await page.evaluate(async () => {
    const bytes = new Uint8Array(32044); const view = new DataView(bytes.buffer);
    const text = (offset: number, value: string) => bytes.set(new TextEncoder().encode(value), offset);
    text(0, 'RIFF'); view.setUint32(4, 32036, true); text(8, 'WAVEfmt '); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, 32000, true);
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('voice-workbench-audio', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('audio');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { const db = request.result; const tx = db.transaction('audio', 'readwrite'); tx.objectStore('audio').put(new Blob([bytes], { type: 'audio/wav' }), 'checked.wav'); tx.oncomplete = () => { db.close(); resolve(); }; };
    });
  });
  await seedState(page, state); await page.reload();
  // 直流偏移只给助手看；削波和截断写进提醒，附带时间位置。
  const badge = page.locator('.player').getByTestId('audio-check');
  await expect(badge).toBeVisible();
  const label = await badge.getAttribute('aria-label');
  expect(label).toContain('爆音（削波）3 处');
  expect(label).toContain('结尾被截断');
  expect(label).not.toContain('偏离中线');
});

test('已下载模型有新版本时显示轻提示，可关闭并重新下载更新', async ({ page }) => {
  const state = emptyState();
  state.models = [{ id: 'kokoro-82m-q8', path: 'kokoro-82m-q8_0.gguf', managed: true, sha256: '0'.repeat(64) }];
  await seedState(page, state);
  await page.goto('/');
  const notice = page.getByTestId('model-update-notice');
  await expect(notice).toContainText('1 个模型可更新');
  await notice.getByRole('button', { name: '关闭提示' }).click();
  await expect(notice).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('model-update-notice')).toHaveCount(0);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '语音模型', exact: true }).click();
  const model = page.locator('[data-model-id="kokoro-82m-q8"]');
  await expect(model.getByText('有新版本', { exact: true })).toBeVisible();
  await model.getByRole('button', { name: '更新', exact: true }).click();
  await expect(model.getByText('有新版本', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('model-update-notice')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1') ?? '{}').models?.[0]?.sha256)).not.toBe('0'.repeat(64));
});

test('侧栏宽度记录损坏时照常启动，并清掉损坏的记录', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { localStorage.setItem('astryx-resizable:workbench-sidebar', '{not json'); });
  await page.goto('/');
  await expect(page.getByLabel('作品名称')).toHaveValue('清晨旁白');
  // 损坏的记录被删掉；侧栏之后重新写入的必须是合法 JSON。
  await expect.poll(() => page.evaluate(() => {
    const saved = localStorage.getItem('astryx-resizable:workbench-sidebar');
    if (saved === null) return 'cleared';
    try { JSON.parse(saved); return 'valid'; } catch { return saved; }
  })).toMatch(/^(cleared|valid)$/);
  expect(errors).toEqual([]);
});

test('浮层出错只影响浮层：声音选择的代码没加载到时其余界面照常，重试会重新加载页面', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('作品名称')).toHaveValue('清晨旁白');
  // 让按需加载的声音选择器取不到代码，相当于离线或更新后旧文件已不存在。
  await page.route('**/voice-picker.tsx*', route => route.abort());
  await page.getByRole('button', { name: '添加参考音频', exact: true }).click();
  const boundary = page.locator('.page-error');
  await expect(boundary).toBeVisible();
  await expect(boundary).toContainText('这个页面出错了');
  await expect(boundary).toHaveAttribute('data-chunk', 'true');
  // 侧栏、编辑区与检查器都还在，没有整页白屏。
  await expect(page.getByLabel('作品名称')).toHaveValue('清晨旁白');
  await expect(page.getByTestId('nav-settings')).toBeVisible();
  await expect(page.getByRole('button', { name: '生成语音', exact: true })).toBeVisible();
  // React.lazy 记住了失败结果，这时的“重试”是重新加载页面；恢复网络后页面回到正常状态。
  await page.unroute('**/voice-picker.tsx*');
  await page.evaluate(() => { (window as unknown as { __marker?: number }).__marker = 1; });
  await boundary.getByRole('button', { name: '重试', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBeUndefined();
  await expect(page.getByLabel('作品名称')).toHaveValue('清晨旁白');
  await expect(page.locator('.page-error')).toHaveCount(0);
  await page.getByRole('button', { name: '添加参考音频', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});
