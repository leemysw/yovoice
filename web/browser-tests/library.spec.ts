import { test, expect } from '@playwright/test';
import { emptyState } from '../src/shared/workbench';

test('角色退出保存、无修改退出、另存为和应用保留正文', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '保存为角色', exact: true }).click();
  const dialog = page.getByTestId('character-editor');
  await dialog.getByRole('button', { name: '退出', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1') ?? '{}').characters ?? [])).toHaveLength(0);
  await page.getByRole('button', { name: '保存为角色', exact: true }).click();
  await dialog.getByLabel('角色名称').fill('温柔旁白');
  await dialog.getByLabel('试听台词').fill('这是一句试听台词。');
  await dialog.getByRole('button', { name: '退出', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByTestId('nav-characters').click();
  await expect(page.getByRole('heading', { name: '温柔旁白' })).toBeVisible();
  const avatar = await page.locator('.library-avatar').getAttribute('src');
  await page.getByRole('button', { name: '编辑角色', exact: true }).click();
  await dialog.getByLabel('角色名称').fill('温柔旁白更新');
  await dialog.getByRole('button', { name: '退出', exact: true }).click();
  await expect(page.getByRole('heading', { name: '温柔旁白更新' })).toBeVisible();
  await expect(page.locator('.library-avatar')).toHaveAttribute('src', avatar!);
  const before = await page.evaluate(() => localStorage.getItem('voice-workbench-v1'));
  await page.getByRole('button', { name: '编辑角色', exact: true }).click();
  await dialog.getByRole('button', { name: '退出', exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem('voice-workbench-v1'))).toBe(before);
  await page.getByRole('button', { name: '编辑角色', exact: true }).click();
  await dialog.getByLabel('角色名称').fill('旁白副本');
  await dialog.getByRole('button', { name: '另存为新角色', exact: true }).click();
  await page.reload();
  await page.getByTestId('nav-characters').click();
  await expect(page.getByRole('heading', { name: '温柔旁白更新' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '旁白副本' })).toBeVisible();
  await page.getByTestId('nav-create').click();
  await page.getByLabel('作品名称').fill('新的作品');
  await page.locator('.script-editor').fill('正文不能被试听台词替换。');
  await page.getByTestId('nav-characters').click();
  await page.getByRole('button', { name: '应用角色', exact: true }).first().click();
  await expect(page.getByText('已应用角色的声音参数，作品正文保持不变。')).toHaveCount(0);
  await expect(page.getByLabel('作品名称')).toHaveValue('新的作品');
  await expect(page.locator('.script-editor')).toHaveValue('正文不能被试听台词替换。');
  await page.setViewportSize({ width: 600, height: 820 });
  await page.getByTestId('nav-characters').click();
  await page.getByRole('button', { name: '编辑角色', exact: true }).first().click();
  await expect(dialog.getByRole('button', { name: '退出', exact: true })).toBeInViewport();
  await expect(dialog.getByLabel('角色名称')).toBeInViewport();
});

test('历史片段保存独立音色并维护原文', async ({ page }, testInfo) => {
  const state = emptyState();
  const id = 'a'.repeat(32);
  state.history = [{ id, title: '历史旁白', fileName: id + '.wav', createdAt: new Date().toISOString(), duration: 1, settings: { ...state.drafts[0], text: '历史片段实际的台词。' } }];
  await page.goto('/');
  await page.evaluate(async state => {
    localStorage.setItem('voice-workbench-v1', JSON.stringify(state));
    const data = new ArrayBuffer(32044); const view = new DataView(data);
    const text = (at: number, value: string) => [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
    text(0, 'RIFF'); view.setUint32(4, 32036, true); text(8, 'WAVEfmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, 32000, true);
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('voice-workbench-audio', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('audio');
      req.onsuccess = () => { const db = req.result; const tx = db.transaction('audio', 'readwrite'); tx.objectStore('audio').put(new Blob([data], { type: 'audio/wav' }), state.history[0].fileName); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error); };
    });
  }, state);
  await page.reload();
  await page.getByRole('button', { name: '保存为音色', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('参考原文')).toHaveValue('历史片段实际的台词。');
  await dialog.getByLabel('音色名称').fill('独立音色');
  await dialog.getByRole('button', { name: '保存音色', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByTestId('nav-history').click();
  await page.getByRole('button', { name: /删除.*历史旁白/ }).click();
  await dialog.getByRole('button', { name: /删除/ }).click();
  await page.getByTestId('nav-voices').click();
  await page.getByRole('button', { name: '编辑音色信息', exact: true }).click();
  await expect(dialog.getByLabel('参考原文')).toHaveValue('历史片段实际的台词。');
  await dialog.getByLabel('参考原文').fill('校正后的原文。');
  await dialog.getByRole('button', { name: '保存音色', exact: true }).click();
  await page.reload();
  await page.getByTestId('nav-voices').click();
  await expect(page.getByRole('heading', { name: '独立音色' })).toBeVisible();
  await page.getByRole('button', { name: '编辑音色信息', exact: true }).click();
  await expect(dialog.getByLabel('参考原文')).toHaveValue('校正后的原文。');
  await expect(dialog.locator('audio')).toHaveAttribute('src', /^blob:/);
  for (const width of [1440, 600]) {
    await page.setViewportSize({ width, height: 820 });
    const save = dialog.getByRole('button', { name: '保存音色', exact: true });
    const close = dialog.getByRole('button', { name: '取消', exact: true });
    await expect(save).toBeInViewport();
    await expect(close).toBeInViewport();
    const inputBox = (await dialog.getByLabel('参考原文').boundingBox())!;
    const saveBox = (await save.boundingBox())!;
    const titleBox = (await dialog.getByRole('heading').boundingBox())!;
    const closeBox = (await close.boundingBox())!;
    expect(saveBox.y - inputBox.y - inputBox.height).toBeGreaterThanOrEqual(16);
    expect(closeBox.x).toBeGreaterThan(titleBox.x + titleBox.width);
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`voice-editor-${width}.png`) });
  }
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test('试听快照区分新台词和固定种子，并忽略对象键顺序', async () => {
  const { synthesisSettings, previewStale } = await import('../src/shared/workbench');
  const settings = synthesisSettings(emptyState().drafts[0]);
  const character = { id: 'c'.repeat(32), name: '旁白', settings, demoText: '试听', preview: { id: 'p', fileName: 'p.wav', duration: 1, text: '试听', settings: { ...settings, voiceDescription: '', guidanceScale: 0 } } };
  expect(previewStale(character)).toBe(false);
  character.settings = Object.fromEntries(Object.entries(settings).reverse()) as typeof settings;
  expect(previewStale(character)).toBe(false);
  character.settings.seed = 0;
  expect(previewStale(character)).toBe(true);
  character.settings.seed = null;
  character.demoText = '更新后的试听';
  expect(previewStale(character)).toBe(true);
});

test('桌面试听失败后可继续保存且保留原试听', async ({ page }) => {
  const state = emptyState();
  const { synthesisSettings } = await import('../src/shared/workbench');
  const settings = synthesisSettings(state.drafts[0]);
  state.characters = [{ id: 'c'.repeat(32), name: '已有角色', settings, demoText: '原试听', preview: { id: 'd'.repeat(32), fileName: 'demo.wav', duration: 1, text: '原试听', settings } }];
  await page.addInitScript(state => {
    let receive: (event: { data: unknown }) => void;
    Object.assign(window, { chrome: { webview: {
      addEventListener: (_name: string, listener: typeof receive) => { receive = listener; },
      postMessage: (message: { id: string; method: string; data: unknown }) => {
        let result: unknown = true;
        if (message.method === 'state.get') result = { state, catalog: [], desktop: true };
        if (message.method === 'character.save') localStorage.setItem('saved-character', JSON.stringify(message.data));
        if (message.method === 'character.preview') {
          result = 'e'.repeat(32);
          state.activity = { kind: 'generate', requestId: result as string, code: '@yovoice.activity.failed', params: null, status: 'failed', received: 0, total: 0, errorCode: '@yovoice.error.generateFailed', errorParams: null };
          // 先返回接受请求，再广播终态，覆盖快速失败的事件顺序。
          setTimeout(() => receive({ data: { event: 'state', state } }), 20);
        }
        queueMicrotask(() => receive({ data: { id: message.id, result } }));
      },
    } } });
  }, state);
  await page.route('https://outputs.workbench.local/**', route => route.fulfill({ status: 200, contentType: 'audio/wav', body: Buffer.alloc(44) }));
  await page.goto('/');
  await page.getByTestId('nav-characters').click();
  await page.getByRole('button', { name: '编辑角色', exact: true }).click();
  const dialog = page.getByTestId('character-editor');
  await dialog.getByLabel('试听台词').fill('修改后的台词');
  await expect(dialog.getByText('试听待更新', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '重新生成试听', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '退出', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: '退出', exact: true }).click();
  const saved = JSON.parse((await page.evaluate(() => localStorage.getItem('saved-character')))!);
  expect(saved.demoText).toBe('修改后的台词');
  expect(saved.preview.id).toBe('d'.repeat(32));
});

test('角色搜索、空状态和表单校验反馈', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByTestId('nav-characters').click();
  await expect(page.getByRole('button', { name: '新建角色', exact: true })).toHaveCount(1);
  await expect(page.getByText('暂无角色', { exact: true })).toBeVisible();
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('characters-empty.png') });
  await page.getByRole('button', { name: '新建角色', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const dialog = page.getByTestId('character-editor');
  await dialog.getByLabel('角色名称').fill('');
  await expect(dialog.getByText('请填写名称后再保存。')).toBeVisible();
  await expect(dialog.getByRole('button', { name: '退出', exact: true })).toBeDisabled();
  await dialog.getByLabel('角色名称').fill('温柔旁白');
  await dialog.getByLabel('试听台词').fill('');
  await expect(dialog.getByRole('button', { name: '生成试听', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: '退出', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: '退出', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('角色已保存，可在角色库中查看和使用。')).toHaveCount(0);
  const heading = (await page.getByRole('heading', { name: '角色库', exact: true }).boundingBox())!;
  const newProject = (await page.getByTestId('nav-new').boundingBox())!;
  expect(Math.abs(heading.y + heading.height / 2 - newProject.y - newProject.height / 2)).toBeLessThan(1);
  await page.getByRole('textbox', { name: '搜索角色', exact: true }).fill('不存在');
  await expect(page.getByText('没有匹配的角色，试试其他关键词。')).toBeVisible();
  await expect(page.getByRole('heading', { name: '温柔旁白' })).toHaveCount(0);
  await page.getByRole('textbox', { name: '搜索角色', exact: true }).fill('旁白');
  await expect(page.getByRole('heading', { name: '温柔旁白' })).toBeVisible();
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('characters.png') });
  await page.setViewportSize({ width: 600, height: 820 });
  await page.getByRole('button', { name: '编辑角色', exact: true }).click();
  await expect(dialog.getByLabel('角色名称')).toBeInViewport();
  await expect(dialog.getByRole('button', { name: '退出', exact: true })).toBeInViewport();
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('character-editor.png') });
  await dialog.getByRole('button', { name: '声音设置', exact: true }).click();
  await expect(dialog.locator('.inspector')).toBeVisible();
  await expect(dialog.getByRole('button', { name: '退出', exact: true })).toBeInViewport();
  await dialog.getByRole('button', { name: '返回正文', exact: true }).click();
  await expect(dialog.getByLabel('角色名称')).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 920 });
  const documentBox = (await dialog.locator('.document').boundingBox())!;
  const inspectorBox = (await dialog.locator('.inspector').boundingBox())!;
  expect(inspectorBox.x).toBeGreaterThanOrEqual(documentBox.x + documentBox.width - 1);
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('character-studio.png') });
  await dialog.getByLabel('试听台词').fill('');
  await dialog.getByLabel('试听台词').press('Control+Enter');
  await expect(dialog).toBeVisible();
  await page.getByTestId('nav-history').click();
  await expect(dialog).not.toBeVisible();
  await page.getByTestId('nav-characters').click();
  await expect(dialog.getByLabel('试听台词')).toHaveValue('');
  await dialog.getByRole('button', { name: '退出', exact: true }).click();
  await page.getByTestId('nav-create').click();
  await expect(page.locator('.script-editor')).not.toHaveValue('');
});
