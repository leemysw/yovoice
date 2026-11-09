import { test, expect } from '@playwright/test';
import { seedState } from './seed';
import { emptyState } from '../src/shared/workbench';
import { createScoreDraft, exampleScore, scoreDuration } from '../src/features/score/score-draft';
import { midiToScore, scoreToMidi } from '../src/features/score/score-midi';

test('新建编曲作品：示例乐谱、音块总览、声部调整与持久化', async ({ page }, testInfo) => {
  // 覆盖编曲全流程（含两次刷新和窗口缩放），步骤多，放宽单测时限。
  test.setTimeout(60_000);
  await page.goto('/');
  await page.getByTestId('nav-new').click();
  await page.getByRole('menuitem', { name: '编曲生成', exact: true }).click();
  await expect(page.getByText('按小节和拍写下每个声部的音符')).toBeVisible();
  await expect(page.getByRole('button', { name: '渲染配乐', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '填入示例', exact: true }).click();

  await expect(page.locator('.score-summary')).toHaveText('D 小调 · 100 BPM · 4/4 · 22 小节 · 00:54');
  await expect(page.getByRole('group', { name: /7 个声部/ })).toBeVisible();
  const sections = page.getByRole('list', { name: '段落' });
  await expect(sections.getByRole('listitem')).toHaveCount(3);
  await expect(sections.getByRole('listitem').last()).toContainText('88 BPM');

  // 轨道视图：鼓组不显示音色，角色决定默认电平，关闭发声后写入 mute。
  const rows = page.locator('.score-track');
  await expect(rows).toHaveCount(7);
  await expect(rows.last().getByRole('img', { name: '鼓组' })).toBeVisible();
  // 音色只显示图标，点开后可搜索切换。
  await page.getByRole('button', { name: '琶音 的音色' }).click();
  await page.getByRole('option', { name: 'Celesta' }).click();
  await expect(page.getByRole('button', { name: '琶音 的音色' }).locator('svg title')).toHaveText('Celesta');
  await expect(page.getByLabel('铺底 的目标电平')).toHaveValue('-29');
  await page.getByLabel('铺底 的目标电平').fill('-26');
  const mute = page.getByRole('button', { name: '琶音 发声' });
  await expect(mute).toHaveAttribute('aria-pressed', 'true');
  await mute.click();
  await expect(mute).toHaveAttribute('aria-pressed', 'false');
  // 音色选择器弹窗宽度充足（>=220px），乐器名称完整可读不被挤压。
  await rows.first().locator('.score-instrument').click();
  const popup = page.locator('.astryx-selector-popup:visible');
  await expect(popup).toBeVisible();
  const popupWidth = await popup.evaluate(el => el.clientWidth);
  expect(popupWidth).toBeGreaterThanOrEqual(220);
  await expect(page.getByRole('option', { name: 'Bright Acoustic Piano' })).toBeVisible();
  // 在下拉弹窗内滚动滚轮时，不误触发外部轨道的横向滚动。
  const beforeWheelScrollLeft = await page.locator('.score-scroll').evaluate(el => el.scrollLeft);
  await popup.evaluate(el => { el.dispatchEvent(new WheelEvent('wheel', { deltaY: 80, bubbles: true, cancelable: true })); });
  const afterWheelScrollLeft = await page.locator('.score-scroll').evaluate(el => el.scrollLeft);
  expect(afterWheelScrollLeft).toBe(beforeWheelScrollLeft);
  await page.keyboard.press('Escape');
  await expect(popup).toBeHidden();
  // 角色收在色点菜单里：切换后行颜色随之变化。
  await page.getByRole('button', { name: '琶音 的角色' }).click();
  await page.getByRole('menuitem', { name: '钢琴' }).click();
  await expect(rows.nth(5)).toHaveAttribute('data-role', 'piano');
  await page.getByRole('button', { name: '琶音 的角色' }).click();
  await page.getByRole('menuitem', { name: '琶音' }).click();
  // 宽屏下右侧面板可收起，收起后主操作移到标题栏，并跨刷新保留。
  await page.getByRole('button', { name: '收起右侧面板' }).click();
  await expect(page.locator('.score-inspector')).toBeHidden();
  await expect(page.getByRole('button', { name: '渲染配乐', exact: true })).toBeVisible();
  await expect(page.locator('.saved')).toContainText('已保存');
  await page.reload();
  await expect(page.locator('.score-inspector')).toBeHidden();
  await page.getByRole('button', { name: '展开右侧面板' }).click();
  await expect(page.locator('.score-inspector')).toBeVisible();
  await expect(page.getByRole('button', { name: '渲染配乐', exact: true })).toHaveCount(1);
  await page.getByRole('spinbutton', { name: '速度（BPM）' }).fill('120');
  await expect(page.locator('.score-summary')).toContainText('120 BPM');
  await page.screenshot({ path: testInfo.outputPath('score.png') });
  // 轨道区在底部全宽面板里，与播放器同宽、贯穿检查器下方；轨头单行固定在左侧，22 小节乐谱默认即可横向滚动。
  const box = (selector: string) => page.locator(selector).first().evaluate(el => { const r = el.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top) }; });
  const [arrangement, player, inspector] = [await box('.score-arrangement'), await box('.player'), await box('.inspector')];
  expect(Math.abs(arrangement.right - player.right)).toBeLessThanOrEqual(1);
  expect(Math.abs(arrangement.left - player.left)).toBeLessThanOrEqual(1);
  expect(arrangement.right).toBeGreaterThan(inspector.left + 100);
  expect(arrangement.top).toBeLessThan(player.top);
  const scroll = page.locator('.score-scroll');
  const headWidth = await rows.first().locator('.score-track-head').evaluate(el => el.clientWidth);
  const headHeight = await rows.first().locator('.score-track-head').evaluate(el => el.clientHeight);
  expect(headWidth).toBeLessThanOrEqual(200);
  // 轨头各列对齐：每行的音色、电平与发声按钮左边缘一致。
  const columns = await rows.evaluateAll(list => list.map(row => [...row.querySelectorAll('.score-track-head > .astryx-field, .score-drum-kit, .number-field, .score-mute')].map(el => Math.round(el.getBoundingClientRect().left)).join()));
  expect(new Set(columns).size).toBe(1);
  expect(headHeight).toBeLessThanOrEqual(42);
  await expect.poll(() => scroll.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  await scroll.evaluate(el => { el.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true })); });
  await expect.poll(() => scroll.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  await page.getByRole('group', { name: '缩放' }).first().getByRole('button', { name: '放大' }).click();
  await expect.poll(() => scroll.evaluate(el => el.scrollWidth > el.clientWidth * 1.5)).toBe(true);
  await scroll.evaluate(el => { el.scrollLeft = 200; });
  await expect.poll(() => rows.first().locator('.score-track-head').evaluate(el => Math.round(el.getBoundingClientRect().left - el.closest('.score-scroll')!.getBoundingClientRect().left))).toBe(0);
  // 轨头声部名称采用小字号（12px），与下方声音音轨一致。
  const nameFontSize = await rows.first().locator('.score-track-name').evaluate(el => window.getComputedStyle(el).fontSize);
  expect(nameFontSize).toBe('12px');
  // 向右滑动时间轴超出播放进度时，位于左侧轨头背后的播放指针隐藏，不穿透轨头。
  await scroll.evaluate(el => { el.scrollLeft = 600; });
  await expect(page.locator('.score-playhead')).toBeHidden();
  // 轨道区有最大高度（视口的 45%），声部多时上下滚动，时间轴固定在顶部。
  await page.setViewportSize({ width: 1280, height: 600 });
  await expect.poll(() => page.locator('.score-arrangement').evaluate(el => el.getBoundingClientRect().height)).toBeLessThanOrEqual(600 * .45 + 1);
  await expect.poll(() => scroll.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  await scroll.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect.poll(() => scroll.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  await expect.poll(() => page.locator('.score-ruler-row').evaluate(el => Math.round(el.getBoundingClientRect().top - el.closest('.score-scroll')!.getBoundingClientRect().top))).toBe(0);

  await expect(page.locator('.saved')).toContainText('已保存');
  await page.reload();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1')!).drafts.find((d: { kind?: string }) => d.kind === 'score'));
  expect(saved).toMatchObject({ kind: 'score', modelId: 'musescore-general-sf2', score: { tempo: 120 } });
  expect(saved.score.tracks.find((t: { id: string }) => t.id === 'pad').level).toBe(-26);
  expect(saved.score.tracks.find((t: { id: string }) => t.id === 'arp').mute).toBe(true);

  // 未安装音色库时渲染直接打开独立的“编曲音色库”页；配音作品的模型列表不包含音色库。
  await page.getByRole('button', { name: '渲染配乐', exact: true }).click();
  await expect(page.getByRole('tab', { name: '编曲音色库', exact: true, selected: true })).toBeVisible();
  await expect(page.locator('[data-model-id="musescore-general-sf2"]')).toContainText('128 种乐器和鼓组');
  await expect(page.locator('[data-model-id$="-sf2"]')).toHaveCount(3);
  // 编曲生成并入音乐生成：侧栏只保留「音乐生成」，编曲标签页也高亮它。
  await expect(page.getByTestId('nav-score')).toHaveCount(0);
  await page.getByTestId('nav-music').click();
  await page.getByRole('tab', { name: '编曲生成', exact: true }).click();
  await expect(page.locator('.project-library-row:visible')).toHaveCount(1);
  await expect(page.getByRole('tab', { name: '编曲生成', exact: true, selected: true })).toBeVisible();
  await expect(page.getByTestId('nav-music')).toHaveAttribute('aria-current', 'page');
  await page.getByTestId('nav-new').click();
  await page.getByRole('menuitem', { name: '语音生成', exact: true }).click();
  await page.getByRole('combobox', { name: '模型' }).click();
  await expect(page.getByRole('option', { name: /MuseScore/ })).toHaveCount(0);
});

test('编曲导入 MIDI 后替换乐谱，导出 MIDI 可还原音符', async ({ page }) => {
  const state = emptyState();
  state.drafts = [{ ...createScoreDraft('zh-CN', false), id: 'b'.repeat(32) }];
  await page.addInitScript(value => { if (!localStorage.getItem('voice-workbench-v1')) localStorage.setItem('voice-workbench-v1', value); }, JSON.stringify(state));
  await page.goto('/');
  const source = exampleScore('en');
  await page.locator('input[type=file][accept=".mid,.midi,.json"]').setInputFiles({ name: 'demo.mid', mimeType: 'audio/midi', buffer: Buffer.from(scoreToMidi(source)) });
  await expect(page.locator('.score-track')).toHaveCount(7);
  await expect(page.locator('.score-track').first()).toContainText('Pad');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出', exact: true }).click();
  await page.getByRole('menuitem', { name: 'MIDI 文件（.mid）' }).click();
  const file = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of file) chunks.push(chunk as Buffer);
  const back = midiToScore(new Uint8Array(Buffer.concat(chunks)), n => `Track ${n}`);
  expect(back.tracks.map(t => t.notes.length)).toEqual(source.tracks.map(t => t.notes.length));
  expect(back.tracks[6].drums).toBe(true);

  // 损坏的文件给出可读的错误，不替换当前乐谱。
  await page.locator('input[type=file][accept=".mid,.midi,.json"]').setInputFiles({ name: 'broken.mid', mimeType: 'audio/midi', buffer: Buffer.from('MThd broken') });
  await expect(page.getByText('无法读取这个 MIDI 文件')).toBeVisible();
  await expect(page.locator('.score-track')).toHaveCount(7);
});

test('乐谱时长按段落变速累加', () => {
  const score = exampleScore('zh-CN');
  // 1–18 小节 100 BPM（43.2 秒），19–22 小节 88 BPM（约 10.9 秒）。
  expect(scoreDuration(score)).toBeCloseTo(18 * 4 * 0.6 + 4 * 4 * 60 / 88, 6);
});

test('缺少乐谱的旧编曲作品可以正常打开，不再白屏', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByTestId('nav-new').click();
  await page.getByRole('menuitem', { name: '编曲生成', exact: true }).click();
  await expect(page.locator('.saved')).toContainText('已保存');
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1')!));
  for (const draft of state.drafts) if (draft.kind === 'score') { delete draft.score; draft.title = '旧编曲'; }
  await seedState(page, state);
  await page.reload();
  await expect(page.getByLabel('作品名称')).toHaveValue('旧编曲');
  await page.getByTestId('nav-music').click();
  await page.getByRole('tab', { name: '编曲生成', exact: true }).click();
  await expect(page.locator('.project-library-row').filter({ hasText: '旧编曲' })).toBeVisible();
  expect(errors).toEqual([]);
});

