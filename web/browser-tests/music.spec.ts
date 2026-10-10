import { test, expect } from '@playwright/test';
import { emptyState } from '../src/shared/workbench';
import { createMusicDraft } from '../src/features/music/music-draft';

test('新建音乐作品：示例、风格标签、段落标记、纯音乐与参数持久化', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByTestId('nav-new').click();
  await page.getByRole('menuitem', { name: '音乐生成', exact: true }).click();
  const style = page.getByLabel('风格', { exact: true });
  await expect(style).toHaveValue('');
  await page.getByRole('button', { name: '填入示例', exact: true }).click();
  await expect(style).toHaveValue(/city pop/);
  await expect(page.getByRole('button', { name: '填入示例', exact: true })).toHaveCount(0);

  // 标签与风格描述双向同步。
  const tags = page.getByRole('group', { name: '风格标签' });
  await expect(tags.getByRole('button', { name: 'city pop', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(tags.getByRole('button', { name: 'piano', exact: true })).toHaveCount(0);
  await tags.getByRole('button', { name: '全部标签', exact: true }).click();
  await tags.getByRole('button', { name: 'piano', exact: true }).click();
  await expect(style).toHaveValue(/, piano$/);
  await tags.getByRole('button', { name: 'city pop', exact: true }).click();
  await expect(style).not.toHaveValue(/city pop/);

  const lyrics = page.getByLabel('歌词', { exact: true });
  await lyrics.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(el.value.length, el.value.length));
  await page.getByRole('button', { name: '[bridge]', exact: true }).click();
  await expect(lyrics).toHaveValue(/一直等\n\n\[bridge\]\n$/);

  // 音乐作品使用独立检查器：只列音乐模型，时长与语言写入作品。
  const model = page.getByRole('combobox', { name: '模型' });
  await expect(model).toContainText('ACE-Step 1.5 Turbo');
  await page.getByRole('radio', { name: '02:00' }).click();
  await page.getByRole('combobox', { name: '演唱语言' }).click();
  await page.getByRole('option', { name: '粤语' }).click();
  await page.getByLabel('纯音乐').check();
  await expect(lyrics).toHaveCount(0);
  await expect(page.getByText('纯音乐不演唱歌词')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('music.png') });

  await expect(page.locator('.saved')).toContainText('已保存');
  await page.reload();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1')!).drafts.find((d: { kind?: string }) => d.kind === 'music'));
  expect(saved).toMatchObject({ kind: 'music', modelId: 'ace-step-1.5-turbo-bf16', instrumental: true, synthesisLanguage: 'yue', modelOptions: { ace_step: { duration_seconds: 120 } } });
  expect(saved.lyrics).toContain('[bridge]');
  await expect(page.getByLabel('纯音乐')).toBeChecked();

  // 未安装模型时生成会打开模型设置；配音作品的模型列表不包含音乐模型。
  await page.getByRole('button', { name: '生成歌曲', exact: true }).click();
  await expect(page.getByRole('tab', { name: '模型', selected: true })).toBeVisible();
  await page.getByTestId('nav-music').click();
  await expect(page.locator('.project-library-row:visible .song-cover')).toHaveCount(1);
  await page.getByTestId('nav-new').click();
  await page.getByRole('menuitem', { name: '语音生成', exact: true }).click();
  await page.getByRole('combobox', { name: '模型' }).click();
  await expect(page.getByRole('option', { name: /ACE-Step/ })).toHaveCount(0);
});

test('音乐版本以封面并排展示，点选版本即试听', async ({ page }, testInfo) => {
  const draft = { ...createMusicDraft('zh-CN'), id: 'a'.repeat(32) };
  const state = emptyState();
  state.drafts = [draft];
  state.history = [3, 2, 1].map(n => ({ id: `${n}`.repeat(32), title: draft.title, fileName: `take-${n}.wav`, createdAt: new Date(2026, 9, 10, 12, n).toISOString(), duration: 60 + n * 7, settings: { ...draft, instrumental: n === 2 } }));
  await page.addInitScript(value => { if (!localStorage.getItem('voice-workbench-v1')) localStorage.setItem('voice-workbench-v1', value); }, JSON.stringify(state));
  await page.goto('/');
  // 预览后端从 IndexedDB 读取音频，写入一段静音 WAV 供播放器加载。
  await page.evaluate(async () => {
    const wav = new Blob([new Uint8Array([82, 73, 70, 70, 36, 8, 0, 0, 87, 65, 86, 69, 102, 109, 116, 32, 16, 0, 0, 0, 1, 0, 1, 0, 64, 31, 0, 0, 128, 62, 0, 0, 2, 0, 16, 0, 100, 97, 116, 97, 0, 8, 0, 0]), new Uint8Array(2048)], { type: 'audio/wav' });
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('voice-workbench-audio', 1); r.onupgradeneeded = () => r.result.createObjectStore('audio'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    await new Promise<void>(resolve => { const tx = db.transaction('audio', 'readwrite'); for (const n of [1, 2, 3]) tx.objectStore('audio').put(wav, `take-${n}.wav`); tx.oncomplete = () => resolve(); });
    db.close();
  });
  await page.reload();
  const takes = page.locator('.music-take');
  await expect(takes).toHaveCount(3);
  await expect(takes.first()).toHaveAccessibleName('版本 3');
  await expect(takes.first()).toHaveAttribute('aria-current', 'true');
  await expect(takes.nth(1)).toContainText('纯音乐');
  await takes.nth(2).click();
  await expect(takes.nth(2)).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('.notice')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('music-takes.png') });
});
