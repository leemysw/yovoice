import { test, expect, type Page } from '@playwright/test';

// 助手面板：右下角入口与快捷键、发送与流式回复、过程与回答分开、工具联动编辑器、停止、新对话、运行时缺失。
// 验收截图：设置 YOVOICE_SHOTS 目录时才保存，默认不落盘。
const shot = (name: string) => process.env.YOVOICE_SHOTS ? `${process.env.YOVOICE_SHOTS}/${name}` : undefined;

async function configureAI(page: Page) {
  // 浮动面板会盖住设置页的按钮，配置时先收起。
  if (await page.getByTestId('assistant-panel').isVisible().catch(() => false)) await page.keyboard.press('ControlOrMeta+j');
  await page.getByTestId('nav-settings').click();
  await page.getByRole('tab', { name: 'AI 服务' }).click();
  await page.getByRole('button', { name: 'Ollama', exact: true }).click();
  await page.getByRole('textbox', { name: '当前模型' }).fill('qwen3');
  await page.getByRole('button', { name: '添加服务', exact: true }).click();
  await expect(page.locator('.ai-nav').getByLabel('使用中')).toHaveCount(1);
}

test('助手面板：右下角入口与 ⌘J 开关、空状态建议，状态跨刷新记住', async ({ page }) => {
  await page.goto('/');
  await configureAI(page);
  // 默认收起，不遮挡工作区；⌘J 打开。
  const panel = page.getByTestId('assistant-panel');
  await expect(panel).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+j');
  await expect(panel).toBeVisible();
  await expect(panel.getByText('你的创作搭档，随时可以开工')).toBeVisible();
  // 语音页的建议：空状态展示，点了即发送。
  await expect(panel.getByRole('button', { name: '帮我挑个音色', exact: true })).toBeVisible();
  await panel.screenshot({ path: shot('assistant-empty.png') });
  await page.keyboard.press('ControlOrMeta+j');
  await expect(panel).toHaveCount(0);
  // 右下角入口打开浮窗、入口随即让位；向下箭头收回入口。
  const launch = page.getByTestId('assistant-toggle');
  await launch.click();
  await expect(panel).toBeVisible();
  await expect(launch).toHaveCount(0);
  await panel.getByTestId('assistant-minimize').click();
  await expect(panel).toHaveCount(0);
  await expect(launch).toBeVisible();
  // 开关状态记住：打开后刷新仍打开，收起后刷新仍收起。
  await page.keyboard.press('ControlOrMeta+j');
  await expect(panel).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('assistant-panel')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+j');
  await page.reload();
  await page.getByTestId('assistant-toggle').waitFor({ state: 'visible' });
  await expect(page.getByTestId('assistant-panel')).toHaveCount(0);
});

test('助手对话：发送后流式回复，工具卡片联动编辑器与页面，可停止、可新对话', async ({ page }) => {
  await page.goto('/');
  await configureAI(page);
  await page.keyboard.press('ControlOrMeta+j');
  const panel = page.getByTestId('assistant-panel');
  const input = panel.getByRole('textbox');
  await input.fill('帮我写四小节钢琴旋律');
  await input.press('Enter');
  // 运行中：发送变为停止；状态行跟随当前步骤，工具只显示友好文案。
  await expect(panel.getByRole('button', { name: /停止|Stop/ })).toBeVisible();
  await expect(panel.locator('.assistant-status[role="status"]')).toBeVisible();
  // 过程默认收起，运行中也只露出状态行；步骤在 DOM 里，点开才显示。
  await expect(panel.locator('.assistant-steps').getByText('新建了《示例小步舞曲》')).toHaveCount(1);
  await panel.screenshot({ path: shot('assistant-running.png') });
  // 满载时截图较慢，回答可能已开始流出、过程已收起，这里只断言步骤存在。
  await expect(panel.locator('.assistant-steps').getByText(/修改了《示例小步舞曲》的乐谱/)).toHaveCount(1);
  await expect(panel.getByText(/create_work|update_work/)).toHaveCount(0);
  // 回答逐字流出：中途只有一部分，结束后完整，过程收起成一行。
  const answer = panel.locator('.assistant-answer').last();
  await expect(answer).toContainText('写好了');
  await expect(answer).toContainText('可以直接渲染试听');
  await expect(panel.getByRole('button', { name: /停止|Stop/ })).toHaveCount(0);
  await expect(panel.locator('.assistant-process').last()).toContainText('执行了 2 步');
  await expect(panel.locator('.assistant-steps').last()).toBeHidden();
  await panel.screenshot({ path: shot('assistant-chat.png') });
  // 点开过程能看到思考与每一步。
  await panel.locator('.assistant-process').last().getByRole('button').first().click();
  await expect(panel.locator('.assistant-steps').getByText('先新建编曲作品')).toBeVisible();
  // 界面被助手接管：跳到新作品，编辑器里出现乐谱。
  await expect(page.getByLabel('作品名称')).toHaveValue('示例小步舞曲');
  await expect(page.locator('.score-summary')).toContainText('小节');
  // 本轮结束后回到输入态；追问一条，随即停止。
  await expect(panel.getByRole('textbox')).toBeVisible();
  await panel.getByRole('textbox').fill('再快一点');
  await panel.getByRole('textbox').press('Enter');
  await panel.getByRole('button', { name: /停止|Stop/ }).click();
  await expect(panel.getByText('已停止')).toBeVisible();
  await expect(panel.getByRole('textbox')).toBeVisible();
  // 停止后立即再问：上一轮残留的输出不得混进这一轮。
  await panel.getByRole('textbox').fill('看看作品');
  await panel.getByRole('textbox').press('Enter');
  const latest = panel.locator('.assistant-turn').last();
  await expect(latest).toContainText('好的，我先看了作品列表。想让我做什么？');
  await expect(panel.getByRole('textbox')).toBeVisible();
  await expect(latest).not.toContainText('写好了');
  // 助手回复可复制。
  await panel.getByRole('button', { name: '复制', exact: true }).first().click();
  await expect(panel.getByRole('button', { name: '已复制', exact: true }).first()).toBeVisible();
  // 输入框左下角是模型选择，显示当前服务的模型。
  await expect(panel.locator('.assistant-model')).toBeVisible();
  // 新会话：面板清空，标题回默认。
  await panel.getByRole('button', { name: '新对话', exact: true }).click();
  await expect(panel.getByText('你的创作搭档，随时可以开工')).toBeVisible();
  await panel.getByRole('textbox').fill('你好');
  await panel.getByRole('textbox').press('Enter');
  await expect(panel.getByText('你好', { exact: true }).first()).toBeVisible();
  await expect(panel.getByText('好的，我先看了作品列表。').first()).toBeVisible();
  // 历史抽屉：两个会话按更新时间列出，可切换回旧会话、可删除。
  await panel.getByTestId('assistant-history-toggle').click();
  const history = page.getByTestId('assistant-history');
  await expect(history.locator('.assistant-history-item')).toHaveCount(2);
  await expect(history).toContainText('帮我写四小节钢琴旋律');
  await panel.screenshot({ path: shot('assistant-history.png') });
  await history.getByRole('button', { name: /^帮我写四小节钢琴旋律/ }).click();
  await expect(panel.getByText('帮我写四小节钢琴旋律').first()).toBeVisible();
  await panel.getByTestId('assistant-history-toggle').click();
  await history.getByRole('button', { name: /删除会话：你好/ }).click();
  await history.getByRole('button', { name: '删除', exact: true }).click();
  await expect(history.locator('.assistant-history-item')).toHaveCount(1);
  await history.getByRole('button', { name: '返回对话', exact: true }).click();
  await expect(history).toHaveCount(0);
  // 拉高后仍浮在工作区上：只变高、宽度不变，工作区不收窄。
  const small = await panel.boundingBox();
  const shellWidth = (await page.locator('.workbench > .astryx-app-shell').boundingBox())!.width;
  await panel.getByRole('button', { name: '拉高', exact: true }).click();
  await expect(panel).toHaveClass(/expanded/);
  await expect.poll(async () => (await panel.boundingBox())!.height).toBeGreaterThan(small!.height + 100);
  expect((await panel.boundingBox())!.width).toBeCloseTo(small!.width, 0);
  expect((await page.locator('.workbench > .astryx-app-shell').boundingBox())!.width).toBe(shellWidth);
  expect(await panel.evaluate(element => getComputedStyle(element).position)).toBe('fixed');
  await panel.screenshot({ path: shot('assistant-expanded.png') });
  await page.screenshot({ path: shot('assistant-expanded-page.png') });
  // 深色系统偏好下的外观（应用为浅色主题，仅验证不破版）。
  await page.emulateMedia({ colorScheme: 'dark' });
  await panel.screenshot({ path: shot('assistant-dark.png') });
});

test('编辑器不再有单独的 AI 写作栏，AI 统一走助手', async ({ page }) => {
  await page.goto('/');
  await configureAI(page);
  await page.getByTestId('nav-new').click();
  await page.getByRole('menuitem', { name: '编曲生成', exact: true }).click();
  await expect(page.locator('.score-editor')).toBeVisible();
  await expect(page.locator('.ai-composer')).toHaveCount(0);
  await page.getByTestId('nav-new').click();
  await page.getByRole('menuitem', { name: '音乐生成', exact: true }).click();
  await expect(page.locator('.music-editor')).toBeVisible();
  await expect(page.locator('.ai-composer')).toHaveCount(0);
});

test('未配置 AI 服务：面板引导去设置，配置后即可用', async ({ page }) => {
  await page.goto('/');
  // 等界面就绪再按快捷键，满载并行时首屏较慢。
  await page.getByTestId('assistant-toggle').waitFor({ state: 'visible' });
  await page.keyboard.press('ControlOrMeta+j');
  const panel = page.getByTestId('assistant-panel');
  await expect(panel).toContainText('还没有可用的 AI 服务');
  await panel.getByRole('button', { name: '设置 AI', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'AI 服务', selected: true })).toBeVisible();
  await configureAI(page);
  await page.keyboard.press('ControlOrMeta+j');
  await expect(page.getByTestId('assistant-panel').getByRole('textbox')).toBeVisible();
});

test('助手：当前服务是 ChatGPT 订阅时提前说明，并可在面板里切回接口类服务', async ({ page }) => {
  await page.goto('/');
  await configureAI(page);
  await page.getByRole('button', { name: 'ChatGPT (Codex)', exact: true }).click();
  await page.getByRole('textbox', { name: '当前模型' }).fill('gpt-5.6-sol');
  await page.getByRole('button', { name: '添加服务', exact: true }).click();
  await page.keyboard.press('ControlOrMeta+j');
  const panel = page.getByTestId('assistant-panel');
  await expect(panel.getByRole('textbox')).toBeVisible();
  // 面板的模型选择也是写作切换服务的入口，ChatGPT 订阅仍可选；选中后直接说明助手用不了，不等发送后报错。
  await panel.getByTestId('assistant-model').click();
  await page.getByRole('option', { name: 'gpt-5.6-sol' }).click();
  const notice = panel.getByTestId('assistant-codex');
  await expect(notice).toContainText('当前 AI 服务（ChatGPT 订阅）不能用于助手');
  await expect(panel.getByRole('textbox')).toHaveCount(0);
  await panel.screenshot({ path: shot('assistant-codex.png') });
  // 说明旁保留模型选择，可直接切回接口类服务继续对话。
  await notice.getByTestId('assistant-model').click();
  await page.getByRole('option', { name: 'qwen3' }).click();
  await expect(notice).toHaveCount(0);
  await expect(panel.getByRole('textbox')).toBeVisible();
});

test('助手：发送失败时内容回到输入框、面板内提示，重发成功后清空；单条消息最多 2000 字', async ({ page }) => {
  await page.goto('/');
  await configureAI(page);
  await page.keyboard.press('ControlOrMeta+j');
  const panel = page.getByTestId('assistant-panel');
  const input = panel.getByRole('textbox');
  // 让下一次 assistant.send 失败（如会话忙）：内容回到输入框里，错误显示在面板内而不是全局通知。
  await page.evaluate(() => window.__previewFail!('assistant.send', '@yovoice.error.busy'));
  await input.fill('看看作品列表');
  await input.press('Enter');
  const notice = panel.getByTestId('assistant-error');
  await expect(notice).toContainText('请等待当前操作结束');
  await expect(input).toHaveText('看看作品列表');
  await expect(page.locator('.notifications .notice')).toHaveCount(0);
  // 不改动直接重发：成功后输入框清空，提示收起。
  await input.press('Enter');
  await expect(input).toHaveText('');
  await expect(notice).toHaveCount(0);
  await expect(panel.getByText('看看作品列表', { exact: true }).first()).toBeVisible();
  await expect(panel.getByRole('textbox')).toBeVisible();
  // 超过 2000 字的部分在输入时就截掉。
  await input.fill('字'.repeat(2010));
  await expect.poll(async () => (await input.textContent())?.length).toBe(2000);
});
