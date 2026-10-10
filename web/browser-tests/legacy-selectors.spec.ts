import { test, expect, type Page, type Locator } from '@playwright/test';

async function withoutAnchors(page: Page, platform = 'macos') {
  await page.addInitScript(platform => {
    Object.assign(window, { __workbenchPlatform: platform });
    const supports = CSS.supports.bind(CSS);
    CSS.supports = (property: string, value?: string) => property === 'anchor-name' || property === 'position-area'
      ? false : value === undefined ? supports(property) : supports(property, value);
  }, platform);
}

async function select(page: Page, label: string, option: string | RegExp) {
  const trigger = page.getByRole('combobox', { name: label, exact: true });
  await expect(trigger).not.toHaveJSProperty('tagName', 'SELECT');
  await trigger.click();
  await page.getByRole('option', { name: option, exact: typeof option === 'string' }).click();
}

async function expectAnchored(trigger: Locator, popup: Locator) {
  await expect(popup).toBeVisible();
  await expect.poll(async () => {
    const anchor = await trigger.evaluate(el => (el.closest('.astryx-selector') ?? el).getBoundingClientRect().toJSON());
    const menu = await popup.boundingBox();
    const viewport = await popup.page().evaluate(() => ({ width: innerWidth, height: innerHeight }));
    return !!anchor && !!menu && menu.x >= -1 && menu.y >= -1
      && menu.x + menu.width <= viewport.width + 1 && menu.y + menu.height <= viewport.height + 1
      && Math.min(Math.abs(menu.y - anchor.y - anchor.height), Math.abs(menu.y + menu.height - anchor.y)) < 10;
  }).toBe(true);
}

for (const platform of ['macos', 'windows']) {
  test(`${platform} 缺少 CSS 锚点时保留菜单样式、定位和选择持久化`, async ({ page }) => {
    await withoutAnchors(page, platform);
    await page.goto('/');
    const model = page.getByRole('combobox', { name: '模型', exact: true });
    await model.click();
    const popup = page.locator('.astryx-selector-popup:visible');
    await expectAnchored(model, popup);
    await expect(popup.locator('..')).toHaveCSS('position-anchor', 'auto');
    await expect.poll(async () => Math.abs((await popup.boundingBox())!.width - await model.evaluate(el => el.closest('.astryx-selector')!.getBoundingClientRect().width))).toBeLessThan(2);
    await page.keyboard.press('Escape');
    await expect(model).toBeFocused();
    await select(page, '模型', /VoxCPM2 · Q8/);
    await expect(model).toContainText('VoxCPM2');
    await select(page, '模型', /Qwen3-TTS.*CustomVoice.*Q8/);
    await select(page, '内置音色', /^Ryan/);
    await page.getByText('高级设置', { exact: true }).click();
    await select(page, '分段方式', '保留标签');
    await select(page, '模型', /IndexTTS 2.5 · Q8/);
    await select(page, '语言', '英语');
    await expect(page.getByText('已保存', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('combobox', { name: '语言', exact: true })).toContainText('英语');
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await select(page, '界面语言', 'English');
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  });
}

test('兼容定位覆盖卡片菜单、说话人菜单和弹窗内选择框', async ({ page }) => {
  await withoutAnchors(page);
  await page.goto('/');
  await page.getByTestId('nav-text').click();
  const more = page.locator('.project-library-row').first().getByRole('button', { name: '更多操作' });
  await more.click();
  await expectAnchored(more, page.getByRole('menu'));
  await page.keyboard.press('Escape');
  await expect(more).toBeFocused();
  await page.getByTestId('nav-new').click();
  await page.getByRole('menuitem', { name: '故事配音', exact: true }).click();
  await page.getByRole('button', { name: '新增台词', exact: true }).click();
  const speaker = page.getByRole('button', { name: '第 1 句说话人', exact: true });
  await speaker.click();
  await expectAnchored(speaker, page.getByRole('menu'));
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '说话人设置', exact: true }).click();
  const dialogSelect = page.getByRole('dialog').getByRole('combobox').first();
  await dialogSelect.click();
  await expectAnchored(dialogSelect, page.locator('.astryx-selector-popup:visible'));
  await page.keyboard.press('Escape');
  await expect(dialogSelect).toBeFocused();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('兼容菜单随容器滚动和窗口缩放重定位，靠底部时向上展开', async ({ page }) => {
  await withoutAnchors(page);
  await page.goto('/');
  const model = page.getByRole('combobox', { name: '模型', exact: true });
  await model.click();
  const popup = page.locator('.astryx-selector-popup:visible');
  await expectAnchored(model, popup);
  await model.evaluate(element => {
    let parent = element.parentElement;
    while (parent && parent.scrollHeight <= parent.clientHeight) parent = parent.parentElement;
    if (!parent) throw new Error('未找到可滚动的设置面板');
    parent.scrollTop += 40;
  });
  await expectAnchored(model, popup);
  await page.setViewportSize({ width: 1100, height: 700 });
  await expectAnchored(model, popup);
  await page.keyboard.press('Escape');
  // 将现有触发器移到视口底部，验证同一个共享弹层的避让计算。
  await model.evaluate(element => Object.assign((element.closest('.astryx-selector') as HTMLElement).style, { position: 'fixed', bottom: '8px', right: '8px', width: '240px' }));
  await model.press('Enter');
  await expectAnchored(model, popup);
  expect((await popup.boundingBox())!.y).toBeLessThan((await model.boundingBox())!.y);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(popup).toBeHidden();
  await expect(model).toBeFocused();
});

for (const platform of ['macos', 'windows']) {
  test(`${platform} 支持定位时模型选择框在下方展开，作品不再提供归档筛选`, async ({ page }) => {
    await page.addInitScript(platform => Object.assign(window, { __workbenchPlatform: platform }), platform);
    await page.goto('/');
    const model = page.getByRole('combobox', { name: '模型', exact: true });
    await expect(model).not.toHaveJSProperty('tagName', 'SELECT');
    await model.click();
    const popup = page.locator('.astryx-selector-popup:visible');
    await expect.poll(async () => {
      const trigger = await model.boundingBox();
      const menu = await popup.boundingBox();
      return !!trigger && !!menu && menu.y >= trigger.y + trigger.height;
    }).toBe(true);
    await page.getByRole('option', { name: /VoxCPM2 · Q8/ }).click();
    await expect(model).toContainText('VoxCPM2');
    await page.getByTestId('nav-text').click();
    await expect(page.getByRole('combobox', { name: '进行中' })).toHaveCount(0);
  });
}

test('缺少 Popover API 时使用原生选择框', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(HTMLElement.prototype, 'showPopover', { value: undefined, configurable: true }));
  await page.goto('/');
  const model = page.getByRole('combobox', { name: '模型', exact: true });
  await expect(model).toHaveJSProperty('tagName', 'SELECT');
  await model.selectOption('voxcpm2-q8');
  await expect(model).toHaveValue('voxcpm2-q8');
});
