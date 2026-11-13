import { openProjectHistory, saveAsCharacter } from './project-actions';
import { seedState } from './seed';
import { test, expect } from '@playwright/test';
import { emptyState, synthesisSettings } from '../src/shared/workbench';

test('角色退出保存、无修改退出、另存为和应用保留正文', async ({ page }) => {
  await page.goto('/');
  await saveAsCharacter(page);
  const dialog = page.getByTestId('character-editor');
  await dialog.getByRole('button', { name: '返回', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1') ?? '{}').characters ?? [])).toHaveLength(0);
  await saveAsCharacter(page);
  await dialog.getByLabel('角色名称').fill('温柔旁白');
  await dialog.getByLabel('试听台词').fill('这是一句试听台词。');
  await dialog.getByRole('button', { name: '保存角色', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByTestId('nav-characters').click();
  await expect(page.getByRole('heading', { name: '温柔旁白' })).toBeVisible();
  const avatar = await page.locator('.library-avatar:visible').getAttribute('src');
  await page.getByRole('button', { name: '编辑角色', exact: true }).click();
  await dialog.getByLabel('角色名称').fill('温柔旁白更新');
  await dialog.getByRole('button', { name: '保存角色', exact: true }).click();
  await expect(page.getByRole('heading', { name: '温柔旁白更新' })).toBeVisible();
  await expect(page.locator('.library-avatar:visible')).toHaveAttribute('src', avatar!);
  const before = await page.evaluate(() => localStorage.getItem('voice-workbench-v1'));
  await page.getByRole('button', { name: '编辑角色', exact: true }).click();
  await dialog.getByRole('button', { name: '返回', exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem('voice-workbench-v1'))).toBe(before);
  await page.getByRole('button', { name: '编辑角色', exact: true }).click();
  await dialog.getByLabel('角色名称').fill('旁白副本');
  await dialog.getByRole('button', { name: '另存角色', exact: true }).click();
  await page.reload();
  await page.getByTestId('nav-characters').click();
  await expect(page.getByRole('heading', { name: '温柔旁白更新' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '旁白副本' })).toBeVisible();
  await page.locator('.recent-projects .project-link').first().click();
  await page.getByLabel('作品名称').fill('新的作品');
  await page.locator('.script-editor:visible').fill('正文不能被试听台词替换。');
  await page.getByTestId('nav-characters').click();
  await page.getByRole('button', { name: '使用角色', exact: true }).first().click();
  await page.getByRole('dialog').getByRole('combobox', { name: '应用到作品' }).click();
  await page.getByRole('option', { name: '新的作品', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '应用角色', exact: true }).click();
  await expect(page.getByText('已使用角色的声音参数，作品正文保持不变。')).toHaveCount(0);
  await expect(page.getByLabel('作品名称')).toHaveValue('新的作品');
  await expect(page.locator('.script-editor:visible')).toHaveValue('正文不能被试听台词替换。');
  await page.setViewportSize({ width: 600, height: 820 });
  await page.getByTestId('nav-characters').click();
  await page.getByRole('button', { name: '编辑角色', exact: true }).first().click();
  await expect(dialog.getByRole('button', { name: '返回', exact: true })).toBeInViewport();
  await expect(dialog.getByLabel('角色名称')).toBeInViewport();
});

test('角色编辑器按 Esc 关闭：没有修改直接关闭，有修改先确认；确认框里的 Esc 只关确认框', async ({ page }) => {
  const state = emptyState();
  state.characters = [{ id: 'a'.repeat(32), name: '旁白', settings: synthesisSettings(state.drafts[0]), demoText: '试听台词。' }];
  await seedState(page, state);
  await page.goto('/');
  await page.getByTestId('nav-characters').click();
  const editor = page.getByTestId('character-editor');
  await page.getByRole('button', { name: '编辑角色', exact: true }).click();
  await expect(editor).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);
  await page.getByRole('button', { name: '编辑角色', exact: true }).click();
  await editor.getByLabel('角色名称').fill('新旁白');
  await page.keyboard.press('Escape');
  const confirm = page.getByRole('dialog', { name: '保存角色修改？' });
  await expect(confirm).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(confirm).toHaveCount(0);
  await expect(editor).toBeVisible();
  await page.keyboard.press('Escape');
  await confirm.getByRole('button', { name: '放弃修改', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '旁白', exact: true })).toBeVisible();
});

test('从生成记录保存参考音频，删除生成记录后仍保留素材和原文', async ({ page }, testInfo) => {
  const state = emptyState();
  const id = 'a'.repeat(32);
  state.history = [{ id, title: '历史旁白', fileName: id + '.wav', createdAt: new Date().toISOString(), duration: 1, settings: { ...state.drafts[0], text: '历史片段实际的台词。' } }];
  await page.goto('/');
  await page.evaluate(async state => {
    const data = new ArrayBuffer(32044); const view = new DataView(data);
    const text = (at: number, value: string) => [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
    text(0, 'RIFF'); view.setUint32(4, 32036, true); text(8, 'WAVEfmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, 32000, true);
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('voice-workbench-audio', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('audio');
      req.onsuccess = () => { const db = req.result; const tx = db.transaction('audio', 'readwrite'); tx.objectStore('audio').put(new Blob([data], { type: 'audio/wav' }), state.history[0].fileName); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error); };
    });
  }, state);
  await seedState(page, state); await page.reload();
  await expect(page.getByRole('button', { name: '保存为参考音频', exact: true })).toHaveCount(0);
  await page.locator('.recent-projects .project-link').first().click();
  const download = page.waitForEvent('download');
  await page.locator('.player .transport').getByRole('button', { name: '音频操作', exact: true }).click();
  await page.getByRole('menuitem', { name: /^导出音频/ }).click();
  expect(await (await download).failure()).toBeNull();
  await openProjectHistory(page);
  await page.getByRole('button', { name: '音频操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '保存为参考音频', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('参考原文')).toHaveValue('历史片段实际的台词。');
  await dialog.getByLabel('音色名称').fill('独立音色');
  await dialog.getByRole('button', { name: '保存音色', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.locator('.recent-projects .project-link').first().click();
  await openProjectHistory(page);
  await page.getByRole('button', { name: /删除.*历史旁白/ }).click();
  await dialog.getByRole('button', { name: /删除/ }).click();
  await page.getByTestId('nav-characters').click();
  await page.getByRole('tab', { name: '参考音频', exact: true }).click();
  await page.getByRole('button', { name: '编辑音色信息', exact: true }).click();
  await expect(dialog.getByLabel('参考原文')).toHaveValue('历史片段实际的台词。');
  await dialog.getByLabel('参考原文').fill('校正后的原文。');
  await dialog.getByRole('button', { name: '保存音色', exact: true }).click();
  await page.reload();
  await page.getByTestId('nav-characters').click();
  await page.getByRole('tab', { name: '参考音频', exact: true }).click();
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





test('参考音频批量删除跳过仍在使用的条目', async ({ page }) => {
  const state = emptyState();
  const voice = (n: string, name: string) => ({ id: n.repeat(32), name, fileName: n.repeat(32) + '.wav', duration: 3, source: 'import' });
  state.voices = [voice('a', '试音一'), voice('b', '试音二'), voice('c', '在用音色')];
  state.drafts[0] = { ...state.drafts[0], title: '在用作品', voiceId: 'c'.repeat(32) };
  await seedState(page, state);
  await page.goto('/');
  await page.getByTestId('nav-characters').click();
  await page.getByRole('tab', { name: '参考音频', exact: true }).click();
  await page.getByRole('button', { name: '批量删除', exact: true }).click();
  await page.getByLabel('选择“试音一”').check();
  await expect(page.getByRole('button', { name: '删除所选（1）', exact: true })).toBeEnabled();
  await page.getByLabel('全选').check();
  await page.getByRole('button', { name: '删除所选（3）', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '删除所选（3）', exact: true }).click();
  await expect(dialog.getByText('「在用音色」仍被角色或作品使用，未删除', { exact: false })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '删除所选（1）', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('heading', { name: '试音一' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '试音二' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '在用音色' })).toBeVisible();
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expect(page.getByRole('button', { name: '编辑音色信息', exact: true })).toBeVisible();
});
