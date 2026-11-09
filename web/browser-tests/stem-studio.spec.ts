import { test, expect, type Page } from '@playwright/test';
import { seedState } from './seed';
import { emptyState } from '../src/shared/workbench';
import { createMusicDraft } from '../src/features/music/music-draft';
import { wavBytes } from './synthetic-song';

// 在预览后端的音频库里放入几段正弦波，作为原曲与分轨。
async function seedAudio(page: Page, files: Record<string, number>) {
  const rate = 8000, seconds = 4;
  const encoded = Object.fromEntries(Object.entries(files).map(([name, hz]) => {
    const wave = new Float32Array(rate * seconds).map((_, i) => Math.sin(i * hz * 2 * Math.PI / rate) * .4);
    return [name, Buffer.from(wavBytes(wave, wave, rate)).toString('base64')];
  }));
  await page.evaluate(async (data: Record<string, string>) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('voice-workbench-audio', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('audio');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result; const tx = db.transaction('audio', 'readwrite');
        for (const [name, text] of Object.entries(data)) tx.objectStore('audio').put(new Blob([Uint8Array.from(atob(text), c => c.charCodeAt(0))], { type: 'audio/wav' }), name);
        tx.oncomplete = () => { db.close(); resolve(); };
      };
    });
  }, encoded);
}

test('分轨工作台：原曲与各分轨并排，统一播放，静音、独奏与定位', async ({ page }) => {
  const draft = { ...createMusicDraft('zh-CN'), id: 'e'.repeat(32) };
  const state = emptyState();
  state.drafts = [draft];
  const take = (id: string, extra: object = {}) => ({ id, title: draft.title, fileName: `${id}.wav`, createdAt: '2026-09-15T12:00:00Z', duration: 4, settings: draft, ...extra });
  state.history = [take('song'), take('vocals', { stemOf: 'song', stem: 'vocals' }), take('drums', { stemOf: 'song', stem: 'drums' }), take('bass', { stemOf: 'song', stem: 'bass' })];
  await page.goto('/');
  await seedAudio(page, { 'song.wav': 330, 'vocals.wav': 440, 'drums.wav': 110, 'bass.wav': 55 });
  await seedState(page, state); await page.reload();

  // 已分离的版本：菜单里是“打开分轨”，不再显示“分离音轨”。
  await page.locator('.player .transport').getByRole('button', { name: '音频操作', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: '分离音轨' })).toHaveCount(0);
  await page.getByRole('menuitem', { name: '打开分轨' }).click();
  const studio = page.getByRole('dialog', { name: `分轨 · ${draft.title}` });
  await expect(studio).toBeVisible();
  // 工作台盖住整个工作区，标题栏的右侧面板开关随之隐藏，关闭后恢复。
  const inspectorToggle = page.locator('.browser-titlebar').getByRole('button', { name: /右侧面板$/ });
  await expect(inspectorToggle).toHaveCount(0);
  // 人声在最上，原曲是第一条参照轨。
  await expect(studio.locator('.stem-track-name')).toHaveText(['原曲', '人声', '鼓', '贝斯']);
  await expect(studio.locator('.stem-lane svg')).toHaveCount(4);
  // 原曲默认静音作参照，波形变灰。
  await expect(studio.locator('.stem-track').first()).toHaveAttribute('data-silent', 'true');

  await studio.getByRole('button', { name: '播放', exact: true }).click();
  await expect(studio.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await expect.poll(() => studio.locator('.stem-rack').evaluate(el => Number(getComputedStyle(el).getPropertyValue('--stem-progress')))).toBeGreaterThan(0);

  // 独奏人声：其余轨道变灰。
  await studio.getByRole('button', { name: '独奏 人声' }).click();
  await expect(studio.locator('.stem-track[data-silent]')).toHaveCount(3);
  if (process.env.STEM_SHOT) await page.screenshot({ path: process.env.STEM_SHOT });
  await studio.getByRole('button', { name: '独奏 人声' }).click();
  await studio.getByRole('button', { name: '静音 鼓' }).click();
  await expect(studio.getByRole('button', { name: '静音 鼓' })).toHaveAttribute('aria-pressed', 'true');

  // 点击波形定位到对应时间。
  await studio.getByRole('button', { name: '暂停', exact: true }).click();
  const lane = studio.locator('.stem-lane').nth(1);
  const box = (await lane.boundingBox())!;
  await page.mouse.click(box.x + box.width * .75, box.y + box.height / 2);
  await expect(studio.locator('.stem-time')).toContainText('00:03');

  await studio.getByRole('button', { name: '关闭' }).click();
  await expect(studio).toHaveCount(0);
  await expect(inspectorToggle).toBeVisible();
});

test('分轨工作台里删除分轨：确认后关闭，版本菜单回到可以分离', async ({ page }) => {
  const draft = { ...createMusicDraft('zh-CN'), id: 'd'.repeat(32) };
  const state = emptyState();
  state.drafts = [draft];
  const take = (id: string, extra: object = {}) => ({ id, title: draft.title, fileName: `${id}.wav`, createdAt: '2026-09-15T12:00:00Z', duration: 4, settings: draft, ...extra });
  state.history = [take('song'), take('vocals', { stemOf: 'song', stem: 'vocals' }), take('drums', { stemOf: 'song', stem: 'drums' })];
  await page.goto('/');
  await seedAudio(page, { 'song.wav': 330, 'vocals.wav': 440, 'drums.wav': 110 });
  await seedState(page, state); await page.reload();

  const menu = page.locator('.player .transport').getByRole('button', { name: '音频操作', exact: true });
  await menu.click();
  await expect(page.getByRole('menuitem', { name: '重新分离' })).toBeVisible();
  await page.getByRole('menuitem', { name: '打开分轨' }).click();
  const studio = page.getByRole('dialog', { name: `分轨 · ${draft.title}` });
  await studio.getByRole('button', { name: '删除分轨' }).click();
  const confirm = page.getByRole('dialog', { name: '删除这次分离的音轨？' });
  await confirm.getByRole('button', { name: '删除分轨' }).click();
  await expect(studio).toHaveCount(0);
  await menu.click();
  await expect(page.getByRole('menuitem', { name: '分离音轨' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '打开分轨' })).toHaveCount(0);
});

test('转 MIDI 的结果在分轨工作台逐轨试听；没装音色库时提示下载', async ({ page }) => {
  const draft = { ...createMusicDraft('zh-CN'), id: 'f'.repeat(32), kind: 'score' as const, modelId: 'musescore-general-sf2',
    score: { tempo: 120, timeSignature: [4, 4], tracks: [{ id: 'piano', name: '钢琴', role: 'piano', program: 0, notes: [{ bar: 1, beat: 1, pitch: 60, length: 1, velocity: 90 }] }] } };
  const state = emptyState();
  state.drafts = [draft as never];
  await seedState(page, state);
  await page.goto('/');
  await page.getByRole('button', { name: '分轨试听' }).click();
  const studio = page.getByRole('dialog', { name: `分轨 · ${draft.title}` });
  await expect(studio.getByText('试听 MIDI 各轨需要先下载一个编曲音色库。')).toBeVisible();
  await studio.getByRole('button', { name: '下载' }).click();
  await expect(studio).toHaveCount(0);
  await expect(page.getByRole('tabpanel', { name: '编曲音色库' })).toBeVisible();
});

// 回归：旧实现每轨一个 <audio> 各自播放再纠偏，实机上反复跳转、调速，除主时钟一轨外都断断续续，点独奏还卡。
// 现在是一个混音器、一个时钟：在混音器输出上接分析器，确认真的在连续出声，独奏切换后输出的就是那一轨。
test('分轨由同一个混音器输出：连续出声，独奏切换即时生效', async ({ page }) => {
  await page.addInitScript(() => {
    const connect = AudioNode.prototype.connect as (this: AudioNode, ...args: unknown[]) => AudioNode;
    AudioNode.prototype.connect = function (this: AudioNode, ...args: unknown[]) {
      if (this instanceof AudioWorkletNode && args[0] instanceof AudioDestinationNode) {
        const analyser = this.context.createAnalyser();
        // 不做频谱平滑、窗口约 0.25 秒，独奏切换后能及时看到变化。
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0;
        connect.call(this, analyser);
        Object.assign(window, { __mixer: analyser });
      }
      return connect.apply(this, args);
    } as typeof AudioNode.prototype.connect;
  });
  const draft = { ...createMusicDraft('zh-CN'), id: 'e'.repeat(32) };
  const state = emptyState();
  state.drafts = [draft];
  const take = (id: string, extra: object = {}) => ({ id, title: draft.title, fileName: `${id}.wav`, createdAt: '2026-09-15T12:00:00Z', duration: 4, settings: draft, ...extra });
  state.history = [take('song'), take('vocals', { stemOf: 'song', stem: 'vocals' }), take('drums', { stemOf: 'song', stem: 'drums' }), take('bass', { stemOf: 'song', stem: 'bass' })];
  await page.goto('/');
  await seedAudio(page, { 'song.wav': 330, 'vocals.wav': 440, 'drums.wav': 110, 'bass.wav': 55 });
  await seedState(page, state); await page.reload();
  await page.locator('.player .transport').getByRole('button', { name: '音频操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '打开分轨' }).click();
  const studio = page.getByRole('dialog', { name: `分轨 · ${draft.title}` });
  await expect(studio.locator('.stem-lane svg')).toHaveCount(4);
  // 不创建 <audio>：各轨都进同一个混音器。
  expect(await page.evaluate(() => document.querySelectorAll('audio').length)).toBe(await page.evaluate(() => document.querySelectorAll('footer audio').length));
  type Probe = { __mixer: AnalyserNode };
  // 输出里能量最大的频率（Hz）与整体电平。
  const listen = () => page.evaluate(() => {
    const analyser = (window as unknown as Probe).__mixer;
    const spectrum = new Float32Array(analyser.frequencyBinCount);
    analyser.getFloatFrequencyData(spectrum);
    let peak = 0;
    for (let i = 1; i < spectrum.length; i++) if (spectrum[i] > spectrum[peak]) peak = i;
    const wave = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(wave);
    return { hz: peak * analyser.context.sampleRate / analyser.fftSize, level: Math.sqrt(wave.reduce((sum, v) => sum + v * v, 0) / wave.length) };
  });
  await studio.getByRole('button', { name: '独奏 人声' }).click();
  await studio.getByRole('button', { name: '播放', exact: true }).click();
  await expect.poll(async () => Math.round((await listen()).hz)).toBeGreaterThan(430);
  expect((await listen()).hz).toBeLessThan(450);
  // 连续出声：播放中多次取样，电平都不掉到静音。
  await page.waitForTimeout(300);
  for (let i = 0; i < 8; i++) { expect((await listen()).level).toBeGreaterThan(.1); await page.waitForTimeout(100); }
  // 独奏改为贝斯：输出随即变成贝斯的频率。
  await studio.getByRole('button', { name: '独奏 人声' }).click();
  await studio.getByRole('button', { name: '独奏 贝斯' }).click();
  await expect.poll(async () => Math.round((await listen()).hz), { timeout: 2000 }).toBeLessThan(65);
});
