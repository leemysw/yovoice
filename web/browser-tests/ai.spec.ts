import { test, expect } from '@playwright/test';

test('AI 服务：未配置时引导到设置，添加、切换、编辑和删除服务', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByTestId('nav-new').click();
  await page.getByRole('menuitem', { name: '编曲', exact: true }).click();
  await page.getByRole('button', { name: 'AI 写谱', exact: true }).click();
  const notConfigured = page.getByRole('dialog');
  await expect(notConfigured).toContainText('请先在“设置 › AI”中添加服务并选择模型');
  await notConfigured.getByRole('button', { name: '设置 AI', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'AI', selected: true })).toBeVisible();
  const panel = page.getByRole('tabpanel', { name: 'AI' });
  await expect(panel.getByText('还没有 AI 服务')).toBeVisible();

  // 固定地址的服务只显示地址；密钥只显示掩码，不回填。
  await panel.getByRole('combobox', { name: '添加服务' }).click();
  await page.getByRole('option', { name: 'DeepSeek', exact: true }).click();
  const editor = page.getByRole('dialog');
  await expect(editor.getByText('https://api.deepseek.com', { exact: true })).toBeVisible();
  await expect(editor.getByRole('textbox', { name: '接口地址' })).toHaveCount(0);
  await expect(editor.getByRole('button', { name: '获取密钥', exact: true })).toBeVisible();
  await editor.getByLabel('API 密钥').fill('sk-preview-key');
  await editor.getByRole('textbox', { name: '模型', exact: true }).fill('deepseek-chat');
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(editor).toHaveCount(0);

  // 本地服务可改地址；第一个服务自动成为当前服务。
  await panel.getByRole('combobox', { name: '添加服务' }).click();
  await page.getByRole('option', { name: 'Ollama', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('textbox', { name: '接口地址' })).toHaveValue('http://127.0.0.1:11434/v1');
  await page.getByRole('dialog').getByRole('textbox', { name: '模型', exact: true }).fill('qwen3');
  await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click();
  const rows = panel.getByRole('listitem');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('使用中');
  await rows.last().getByRole('button', { name: '使用', exact: true }).click();
  await expect(rows.last()).toContainText('使用中');
  await page.screenshot({ path: testInfo.outputPath('ai-settings.png') });

  await panel.getByRole('button', { name: '编辑 DeepSeek', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('API 密钥')).toHaveValue('');
  await expect(page.getByRole('dialog').getByLabel('API 密钥')).toHaveAttribute('placeholder', '••••••••');
  await page.getByRole('dialog').getByRole('button', { name: '取消' }).first().click();

  const saved = await page.evaluate(() => localStorage.getItem('voice-workbench-v1')!);
  expect(saved).not.toContain('sk-preview-key');

  await panel.getByRole('button', { name: '删除 Ollama', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '删除', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('使用中');
});

test('AI 写歌词：已配置服务时打开需求对话框，预览中调用模型提示仅桌面可用', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('nav-settings').click();
  await page.getByRole('tab', { name: 'AI' }).click();
  await page.getByRole('combobox', { name: '添加服务' }).click();
  await page.getByRole('option', { name: 'Ollama', exact: true }).click();
  await page.getByRole('dialog').getByRole('textbox', { name: '模型', exact: true }).fill('qwen3');
  await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click();

  await page.getByTestId('nav-new').click();
  await page.getByRole('menuitem', { name: '音乐生成', exact: true }).click();
  await page.getByRole('button', { name: 'AI 写歌词', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('使用 Ollama · qwen3');
  await expect(dialog.getByRole('button', { name: '开始写', exact: true })).toBeDisabled();
  await dialog.getByRole('textbox', { name: '你想要什么' }).fill('夏夜海边兜风');
  await dialog.getByRole('button', { name: '开始写', exact: true }).click();
  await expect(dialog.getByRole('alert').or(dialog.locator('.dialog-error'))).toBeVisible();
});
