import { emptyState } from '../src/shared/workbench';
import { test, expect } from '@playwright/test';

test('四种表达方式、草稿持久化与模型协议', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByLabel('作品名称')).toHaveValue('清晨旁白');
  await page.getByRole('radio', { name: '跟随音色', exact: true }).click();
  await expect(page.getByText('沿用参考音色中的自然表达。')).toBeVisible();
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
  await expect(page.getByRole('button', { name: '下载模型', exact: true })).toHaveCount(4);
  await page.getByRole('button', { name: '查看协议' }).click();
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
  await page.locator('input[type=file]').setInputFiles({ name: '测试音色.wav', mimeType: 'audio/wav', buffer: wav });
  await expect(page.getByRole('button', { name: '测试音色', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '试听当前音色' }).click();
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  const progress = page.getByRole('slider', { name: '播放进度' });
  await expect(progress).toBeVisible();
  await progress.fill('1');
  await expect.poll(() => page.locator('footer audio').evaluate((el: HTMLAudioElement) => el.currentTime)).toBeCloseTo(1, 1);
  await page.getByRole('button', { name: '回到开头' }).click();
  await expect(progress).toHaveValue('0');
  await page.getByRole('button', { name: '静音', exact: true }).click();
  await expect.poll(() => page.locator('footer audio').evaluate((el: HTMLAudioElement) => el.volume)).toBe(0);
  await page.getByRole('button', { name: '取消静音' }).click();
  await page.getByRole('button', { name: '测试音色', exact: true }).click();
  await page.getByRole('button', { name: '试听测试音色', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('audio.voice-preview')).toBeVisible();
  await page.getByRole('button', { name: '裁剪', exact: true }).click();
  await page.getByRole('button', { name: '另存为新音色' }).click();
  await expect(page.getByRole('button', { name: '测试音色 · 裁剪', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '声音库', exact: true }).click();
  await expect(page.locator('footer.player')).toHaveCount(0);
  await page.getByRole('button', { name: '试听测试音色', exact: true }).click();
  const preview = page.locator('audio.library-preview');
  await expect.poll(() => preview.evaluate((audio: HTMLAudioElement) => !audio.paused && audio.currentTime > 0)).toBeTruthy();
  await page.getByRole('button', { name: '收起试听测试音色', exact: true }).click();
  await expect(preview).toHaveCount(0);
  await page.getByRole('button', { name: '试听测试音色', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.locator('audio')).toHaveCount(0);
  await page.getByRole('button', { name: '历史记录', exact: true }).click();
  await expect(page.locator('footer.player')).toHaveCount(0);
  await page.getByRole('button', { name: '创作', exact: true }).click();
  await expect(page.locator('footer.player')).toBeVisible();
  await expect.poll(() => page.locator('footer audio').evaluate((audio: HTMLAudioElement) => audio.paused)).toBeTruthy();
});

test('窄屏切换声音设置后可以返回正文', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await page.getByRole('button', { name: '声音设置', exact: true }).click();
  await expect(page.getByRole('radio', { name: '文字指导', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回正文' }).click();
  await expect(page.getByLabel('正文', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test('单选与设置标签支持方向键，弹窗错误就地显示', async ({ page }) => {
  await page.goto('/');
  const natural = page.getByRole('radio', { name: '跟随音色', exact: true });
  await natural.click(); await natural.press('ArrowRight');
  await expect(page.getByRole('radio', { name: '参考演绎', exact: true })).toBeChecked();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '模型', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: '推理引擎', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tabpanel', { name: '推理引擎' })).toBeVisible();
  await page.getByRole('button', { name: '创作', exact: true }).click();
  await page.getByRole('button', { name: '添加参考音频', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('textbox', { name: '录音名称' })).toHaveCount(0);
  await page.locator('input[type=file]').setInputFiles({ name: '损坏.wav', mimeType: 'audio/wav', buffer: Buffer.from('invalid') });
  await expect(dialog.getByRole('alert')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('选中文字显示发音浮层，应用后只修改选区', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByRole('textbox', { name: '正文', exact: true });
  const action = page.getByRole('button', { name: '调整发音', exact: true });
  await expect(action).toHaveCount(0);
  await expect(page.getByRole('button', { name: '段间停顿', exact: true })).toHaveCount(0);
  await editor.fill('银行需要核对资料。');
  await editor.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(0, 0));
  await editor.press('Shift+ArrowRight'); await editor.press('Shift+ArrowRight');
  await expect(action).toBeVisible();
  await editor.press('Tab'); await expect(action).toBeFocused();
  await action.press('Enter');
  await expect(page.getByRole('dialog')).toContainText('银行');
  await page.getByPlaceholder('例如 HANG2').fill('YIN2 HANG2');
  await page.getByRole('button', { name: '应用发音' }).click();
  await expect(editor).toHaveValue('<银行|YIN2 HANG2>需要核对资料。');
  await expect(action).toHaveCount(0);
  await editor.focus(); await editor.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(0, 0)); await editor.press('Shift+ArrowRight');
  await expect(action).toBeVisible();
  await editor.press('ArrowRight'); await expect(action).toHaveCount(0);
  await editor.press('Shift+ArrowLeft'); await expect(action).toBeVisible();
  await editor.press('Escape'); await expect(action).toHaveCount(0);
  await page.locator('.advanced summary').click();
  await expect(page.getByRole('spinbutton', { name: '段间停顿（毫秒）' })).toBeVisible();
});

test('下载进度归属具体精度，菜单不覆盖触发按钮', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const source = page.getByRole('combobox', { name: '下载来源', exact: true });
  await source.click();
  const menu = page.getByRole('listbox');
  await expect(menu).toBeVisible();
  await expect.poll(async () => {
    const button = await source.boundingBox(); const popup = await menu.boundingBox();
    return !!button && !!popup && popup.y >= button.y + button.height;
  }).toBeTruthy();
  await page.keyboard.press('Escape');
  await page.evaluate(state => {
    state.activity = { error: null, kind: 'download', modelId: 'index-2-q8', label: '正在校验模型', status: 'running', received: 3633888608, total: 3633888608 };
    localStorage.setItem('voice-workbench-v1', JSON.stringify(state));
  }, emptyState());
  await page.reload();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const row = page.locator('.model-row').filter({ has: page.getByRole('progressbar', { name: 'IndexTTS 2.0 Q8 下载进度' }) });
  await expect(row).toContainText('正在校验');
  await expect(row.getByRole('button', { name: '暂停' })).toBeVisible();
  await expect(page.locator('.activity')).toHaveCount(0);
  await expect(page.getByRole('progressbar')).toHaveCount(1);
});

test('生成状态仅在右侧显示，已用时间持续更新', async ({ page }) => {
  const state = emptyState();
  state.activity = { kind: 'generate', label: '正在加载模型或合成语音', status: 'running', received: 0, total: 0, error: null, startedAt: new Date(Date.now() - 10000).toISOString() };
  await page.addInitScript(state => localStorage.setItem('voice-workbench-v1', JSON.stringify(state)), state);
  await page.goto('/');
  await expect(page.locator('.generation-action')).toContainText('正在加载模型或合成语音');
  await expect(page.getByRole('button', { name: '取消生成', exact: true })).toHaveCount(1);
  await expect(page.locator('.activity')).toHaveCount(0);
  const elapsed = page.getByLabel('已用时间', { exact: true });
  const initial = await elapsed.textContent();
  await expect.poll(() => elapsed.textContent()).not.toBe(initial);
});


test('作品列表可滚动，删除当前作品后不会被自动保存恢复', async ({ page }) => {
  const state = emptyState();
  state.drafts = Array.from({ length: 18 }, (_, index) => ({ ...state.drafts[0], id: index.toString(16).padStart(32, '0'), title: `作品 ${index + 1}` }));
  await page.addInitScript(state => { if (!localStorage.getItem('voice-workbench-v1')) localStorage.setItem('voice-workbench-v1', JSON.stringify(state)); }, state);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  const list = page.locator('.project-list');
  await expect(page.locator('.project-row')).toHaveCount(18);
  await expect.poll(() => list.evaluate(el => el.scrollHeight > el.clientHeight)).toBeTruthy();
  await page.getByRole('button', { name: '作品 18', exact: true }).scrollIntoViewIfNeeded();
  await expect.poll(() => list.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  await page.getByRole('button', { name: '作品 18', exact: true }).click();
  await page.getByLabel('正文', { exact: true }).fill('刚刚修改的内容');
  await page.locator('.project-row.current').hover();
  await page.getByRole('button', { name: '删除作品：作品 18', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '删除作品', exact: true }).click();
  await expect(page.locator('.project-row')).toHaveCount(17);
  await expect(page.getByLabel('作品名称')).toHaveValue('作品 1');
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: '作品 18', exact: true })).toHaveCount(0);
  await expect(page.locator('.project-row')).toHaveCount(17);
});

test('底部切换当前作品历史，同步正文和生成参数', async ({ page }) => {
  const state = emptyState();
  const draft = state.drafts[0];
  state.history = [
    { id: 'new', title: draft.title, fileName: 'history.wav', createdAt: '2026-09-15T10:00:00Z', duration: 1, settings: { ...draft, mode: 'text', speed: 1.2, text: '新版正文' } },
    { id: 'old', title: draft.title, fileName: 'history.wav', createdAt: '2026-09-15T09:00:00Z', duration: 1, settings: { ...draft, modelId: 'index-2-q8', mode: 'speaker', speed: 0.8, text: '旧版正文' } },
    { id: 'other', title: '其他作品', fileName: 'history.wav', createdAt: '2026-09-15T08:00:00Z', duration: 1, settings: { ...draft, id: 'other' } },
  ];
  await page.goto('/');
  await page.evaluate(async state => {
    localStorage.setItem('voice-workbench-v1', JSON.stringify(state));
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
  }, state);
  await page.reload();
  const selector = page.getByRole('combobox', { name: '当前作品历史' });
  await expect(selector).toContainText('版本 2');
  await selector.click();
  await expect(page.getByRole('option')).toHaveCount(2);
  const menu = await page.getByRole('listbox').boundingBox(); const trigger = await selector.boundingBox();
  expect(menu!.y + menu!.height).toBeLessThanOrEqual(trigger!.y);
  await page.getByRole('option', { name: /版本 1/ }).click();
  await expect(page.getByLabel('正文', { exact: true })).toHaveValue('旧版正文');
  await expect(page.getByRole('radio', { name: '跟随音色', exact: true })).toBeChecked();
  await expect(page.getByRole('slider', { name: '语速', exact: true })).toHaveAttribute('aria-valuenow', '0.8');
  await expect(page.getByRole('combobox', { name: '模型', exact: true })).toContainText('IndexTTS 2.0');
  await expect.poll(() => page.locator('footer audio').evaluate((audio: HTMLAudioElement) => audio.duration)).toBe(1);
  await selector.click(); await page.getByRole('option', { name: /版本 2/ }).click();
  await expect(page.getByLabel('正文', { exact: true })).toHaveValue('新版正文');
  await expect(page.getByRole('radio', { name: '文字指导', exact: true })).toBeChecked();
  await page.getByRole('button', { name: '历史记录', exact: true }).click();
  await page.getByRole('button', { name: `删除历史${draft.title}`, exact: true }).first().click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.locator('.history-item')).toHaveCount(3);
  await page.getByRole('button', { name: `试听${draft.title}`, exact: true }).first().click();
  await page.getByRole('button', { name: `删除历史${draft.title}`, exact: true }).first().click();
  await page.getByRole('button', { name: '删除历史', exact: true }).click();
  await expect(page.locator('.history-item')).toHaveCount(2);
  await expect(page.locator('.history-item audio')).toHaveCount(0);
  await page.getByRole('button', { name: '创作', exact: true }).click();
  await expect(selector).toContainText('版本 1');
  await page.reload();
  await expect(selector).toContainText('版本 1');
  await page.getByRole('button', { name: '新建作品', exact: true }).click();
  await expect(selector).toHaveCount(0);
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeDisabled();
});

test('侧栏拖拽调宽、收起和恢复会记住状态', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 }); await page.goto('/');
  const sidebar = page.getByRole('navigation', { name: '主导航' });
  const handle = page.getByRole('separator', { name: '调整侧栏宽度' });
  const initial = (await sidebar.boundingBox())!.width;
  const bounds = (await handle.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width / 2 + 60, bounds.y + bounds.height / 2, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeGreaterThan(initial + 40);
  const resized = (await sidebar.boundingBox())!.width;
  await page.getByRole('button', { name: '收起侧栏' }).click();
  await expect(sidebar).toHaveCount(0);
  await page.reload(); await expect(sidebar).toHaveCount(0);
  await page.getByRole('button', { name: '展开侧栏' }).click();
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeCloseTo(resized, 0);
  await handle.focus(); await handle.press('ArrowLeft');
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeLessThan(resized);
  await page.evaluate(() => window.dispatchEvent(new Event('workbench-toggle-sidebar')));
  await expect(sidebar).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event('workbench-toggle-sidebar')));
  await expect(sidebar).toBeVisible();
});


test('声音库管理复用重命名和删除，清理当前音色引用', async ({ page }) => {
  const state = emptyState();
  state.voices = [{ id: 'voice', name: '测试音色', fileName: 'voice.wav', duration: 3 }];
  state.drafts[0].voiceId = 'voice';
  await page.goto('/');
  await page.evaluate(state => localStorage.setItem('voice-workbench-v1', JSON.stringify(state)), state);
  await page.reload();
  await page.getByRole('button', { name: '声音库', exact: true }).click();
  await page.getByRole('button', { name: '重命名声音测试音色', exact: true }).click();
  await page.getByRole('textbox', { name: '名称', exact: true }).fill('新音色');
  await page.getByRole('button', { name: '保存名称', exact: true }).click();
  await expect(page.getByRole('button', { name: '打开位置新音色', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '删除声音新音色', exact: true }).click();
  await page.getByRole('button', { name: '删除声音', exact: true }).click();
  await expect(page.getByRole('button', { name: '添加第一个声音', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '创作', exact: true }).click();
  await expect(page.getByRole('button', { name: '添加参考音频', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1')!).drafts[0].voiceId)).toBeNull();
});


test('声音库和历史仅列表滚动，标题位置保持固定', async ({ page }) => {
  const state = emptyState();
  state.voices = Array.from({ length: 30 }, (_, i) => ({ id: `voice-${i}`, name: `声音 ${i}`, fileName: `${i}.wav`, duration: 3 }));
  state.history = Array.from({ length: 30 }, (_, i) => ({ id: `history-${i}`, title: `历史 ${i}`, fileName: `${i}.wav`, createdAt: '2026-09-15T10:00:00Z', duration: 3, settings: state.drafts[0] }));
  await page.goto('/');
  await page.evaluate(state => localStorage.setItem('voice-workbench-v1', JSON.stringify(state)), state);
  await page.reload();
  for (const [name, selector, last] of [['声音库', '.voice-library-list', '声音 29'], ['历史记录', '.history-list', '历史 29']]) {
    await page.getByRole('button', { name, exact: true }).click();
    const heading = page.getByRole('heading', { name, exact: true });
    const before = await heading.boundingBox();
    const list = page.locator(selector);
    await list.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await expect.poll(() => list.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    await expect(page.getByRole('heading', { name: last, exact: true })).toBeInViewport();
    expect((await heading.boundingBox())!.y).toBe(before!.y);
  }
});


test('录音权限拒绝时给出可操作提示', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Permission denied', 'NotAllowedError'); };
  });
  await page.goto('/');
  await page.getByRole('button', { name: '添加参考音频', exact: true }).click();
  await page.getByRole('button', { name: '录制声音', exact: true }).click();
  await page.getByRole('button', { name: '开始录音', exact: true }).click();
  await expect(page.getByText('无法访问麦克风，请在浏览器的网站权限和系统设置中允许使用麦克风后重试。', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '开始录音', exact: true })).toBeEnabled();
});
