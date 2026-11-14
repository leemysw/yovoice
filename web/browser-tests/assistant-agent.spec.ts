import { test, expect, type Page } from '@playwright/test';
import { seedState } from './seed';
import { emptyState } from '../src/shared/workbench';
import { createMusicDraft } from '../src/features/music/music-draft';

// Ocho 融入应用：选中内容随消息带上、写操作走确认卡片、偏好记忆在设置里可查看与删除、生成结束时主动提示。
// 验收截图：设置 YOVOICE_SHOTS 目录时才保存，默认不落盘。
const shot = (name: string) => process.env.YOVOICE_SHOTS ? `${process.env.YOVOICE_SHOTS}/${name}` : undefined;

async function configureAI(page: Page) {
  if (await page.getByTestId('assistant-panel').isVisible().catch(() => false)) await page.keyboard.press('ControlOrMeta+j');
  await page.getByTestId('nav-settings').click();
  await page.getByRole('tab', { name: 'AI 服务' }).click();
  await page.getByRole('button', { name: 'Ollama', exact: true }).click();
  await page.getByRole('textbox', { name: '当前模型' }).fill('qwen3');
  await page.getByRole('button', { name: '添加服务', exact: true }).click();
  await expect(page.locator('.ai-nav').getByLabel('使用中')).toHaveCount(1);
}

// 新建一个语音作品并填好正文，返回正文输入框。
async function newVoiceWork(page: Page, title: string, text: string) {
  await page.getByTestId('nav-new').click();
  await page.getByRole('menuitem', { name: '语音生成', exact: true }).click();
  await page.getByLabel('作品名称').fill(title);
  const script = page.getByRole('textbox', { name: '正文', exact: true });
  await script.fill(text);
  return script;
}

async function send(page: Page, text: string) {
  const panel = page.getByTestId('assistant-panel');
  if (!await panel.isVisible().catch(() => false)) await page.getByTestId('assistant-toggle').click();
  await panel.getByRole('textbox').fill(text);
  await panel.getByRole('textbox').press('Enter');
  return panel;
}

test('选中的文字随下一条消息带给 Ocho，输入框上方有提示，可以不带', async ({ page }) => {
  await page.goto('/');
  await configureAI(page);
  const script = await newVoiceWork(page, '夜色旁白', '夜色很深，风停了。远处传来钟声。');
  // 在正文里选中一句，再打开助手：选区虽然离开了编辑区，仍作为引用显示在输入框上方。
  await script.evaluate((element: HTMLTextAreaElement) => { element.focus(); element.setSelectionRange(0, 9); });
  await page.getByTestId('assistant-toggle').click();
  const panel = page.getByTestId('assistant-panel');
  const chip = panel.getByTestId('assistant-selection');
  await expect(chip).toContainText('夜色很深，风停了。');
  await panel.screenshot({ path: shot('ocho-selection.png') });
  await panel.getByRole('textbox').fill('这句语气再轻一点');
  await panel.getByRole('textbox').press('Enter');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __assistantContext?: { selection?: string; workTitle?: string } }).__assistantContext))
    .toMatchObject({ selection: '夜色很深，风停了。', workTitle: '夜色旁白' });
  // 选区只随这一条消息带上。
  await expect(chip).toHaveCount(0);
  // 再选一次，点 × 不带。
  await panel.getByTestId('assistant-minimize').click();
  await script.evaluate((element: HTMLTextAreaElement) => { element.focus(); element.setSelectionRange(9, 15); });
  await page.getByTestId('assistant-toggle').click();
  await expect(chip).toContainText('远处传来钟声');
  await chip.getByRole('button').click();
  await expect(chip).toHaveCount(0);
});

test('删除作品走确认卡片：确认后才删除，处理后只留结果', async ({ page }) => {
  await page.goto('/');
  await configureAI(page);
  await newVoiceWork(page, '重复的草稿', '第一版');
  await newVoiceWork(page, '保留的作品', '第二版');
  const panel = await send(page, '把《重复的草稿》删掉');
  const card = panel.getByTestId('assistant-proposal');
  await expect(card).toContainText('删除作品《重复的草稿》');
  await expect(card).toContainText('这是一份重复的草稿。');
  await expect(panel.locator('.assistant-answer').last()).toContainText('确认后就删除');
  await expect(panel.getByRole('button', { name: /停止|Stop/ })).toHaveCount(0);
  await panel.screenshot({ path: shot('ocho-proposal.png') });
  await card.getByRole('button', { name: '确认删除' }).click();
  await expect(card).toContainText('已执行');
  await expect(card.getByRole('button', { name: '确认删除' })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1') ?? '{}').drafts?.map((d: { title: string }) => d.title)))
    .not.toContain('重复的草稿');
  await panel.screenshot({ path: shot('ocho-proposal-done.png') });
});

test('偏好记忆：对话里记下，设置 › Ocho 里可查看、删除，主动提示可关闭', async ({ page }) => {
  await page.goto('/');
  await configureAI(page);
  const panel = await send(page, '记住：旁白默认用温柔女声');
  await expect(panel.locator('.assistant-answer').last()).toContainText('记下了');
  await page.keyboard.press('ControlOrMeta+j');
  await page.getByTestId('nav-settings').click();
  await page.getByRole('tab', { name: 'Ocho', exact: true }).click();
  const memory = page.locator('.assistant-memo');
  await expect(memory).toContainText('旁白默认用温柔女声');
  await page.locator('#assistant-panel').screenshot({ path: shot('ocho-settings.png') });
  await memory.getByRole('button', { name: '删除偏好：旁白默认用温柔女声' }).click();
  await expect(memory).toHaveCount(0);
  await expect(page.getByText('还没有记住的偏好')).toBeVisible();
  const nudges = page.getByRole('switch', { name: '主动提示' });
  await expect(nudges).toBeChecked();
  await nudges.click();
  await expect(nudges).not.toBeChecked();
});

test('生成结束时 Ocho 主动提示：失败可一键诊断，关闭主动提示后不再出现', async ({ page }) => {
  await page.goto('/');
  await configureAI(page);
  await newVoiceWork(page, '开场白', '欢迎收听。');
  const activity = (status: string) => page.evaluate(status => {
    const state = JSON.parse(localStorage.getItem('voice-workbench-v1') ?? '{}');
    const projectId = state.drafts?.[0]?.id;
    (window as unknown as { __previewActivity: (slot: string, value: unknown) => void }).__previewActivity('activity', {
      kind: 'generate', code: '@yovoice.activity.generate', params: {}, status, received: 0, total: 0, projectId, startedAt: '2026-10-18T00:00:00Z',
      errorCode: status === 'failed' ? '@yovoice.error.generateFailed' : null, errorParams: {}, modelId: null,
    });
  }, status);
  await activity('running');
  await activity('failed');
  const nudge = page.getByTestId('assistant-nudge');
  await expect(nudge).toContainText('这次生成没成功');
  await nudge.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
  await page.screenshot({ path: shot('ocho-nudge.png') });
  await nudge.getByRole('button', { name: '看看原因' }).click();
  const panel = page.getByTestId('assistant-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByText('刚才的生成失败了', { exact: false }).first()).toBeVisible();
  await expect(nudge).toHaveCount(0);
  // 关闭主动提示后，同样的变化不再冒泡。
  await page.keyboard.press('ControlOrMeta+j');
  await page.getByTestId('nav-settings').click();
  await page.getByRole('tab', { name: 'Ocho', exact: true }).click();
  await page.getByRole('switch', { name: '主动提示' }).click();
  await expect(page.getByRole('switch', { name: '主动提示' })).not.toBeChecked();
  await activity('running');
  await activity('failed');
  await page.waitForTimeout(500);
  await expect(nudge).toHaveCount(0);
});

test('歌曲生成好时 Ocho 邀请分享到社区，点按钮直接打开分享弹窗', async ({ page }) => {
  const state = emptyState();
  const draft = { ...createMusicDraft('zh-CN'), id: 'f'.repeat(32), title: '夏夜' };
  state.drafts = [draft];
  state.history = [{ id: 'song', title: draft.title, fileName: 'song.wav', createdAt: '2026-09-15T12:00:00Z', duration: 4, settings: draft }];
  await page.goto('/');
  await seedState(page, state); await page.reload();
  await configureAI(page);
  const activity = (status: string) => page.evaluate(([status, projectId]) => {
    (window as unknown as { __previewActivity: (slot: string, value: unknown) => void }).__previewActivity('activity', {
      kind: 'generate', code: '@yovoice.activity.generate', params: {}, status, received: 0, total: 0, projectId, startedAt: '2026-10-18T00:00:00Z',
      errorCode: null, errorParams: {}, modelId: null,
    });
  }, [status, draft.id]);
  await activity('running');
  await activity('completed');
  const nudge = page.getByTestId('assistant-nudge');
  await expect(nudge).toContainText('分享到 yovoice 社区');
  await nudge.getByRole('button', { name: '分享到社区' }).click();
  await expect(page.getByRole('dialog', { name: '分享到社区' })).toBeVisible();
  // 分享不经过对话，面板保持关闭。
  await expect(page.getByTestId('assistant-panel')).toHaveCount(0);
});
