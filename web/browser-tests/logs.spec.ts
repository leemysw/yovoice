import { test, expect } from '@playwright/test';
import { seedState } from './seed';
import { emptyState } from '../src/shared/workbench';
import { logLevel } from '../src/shared/lib/preview-logs';

// 设置 › 日志：关键操作与界面事件进入日志，可按级别、模块、关键词筛选，查看详情并导出。

test('日志级别按事件名与错误字段推断，与服务端规则一致', () => {
  expect(logLevel('generation.saved')).toBe('INFO');
  expect(logLevel('project.export', { error: { code: '@yovoice.error.unknown' } })).toBe('ERROR');
  expect(logLevel('state.write_failed')).toBe('ERROR');
  expect(logLevel('client.export_failed')).toBe('ERROR');
  expect(logLevel('rpc.slow')).toBe('WARN');
  expect(logLevel('engine.start_timeout')).toBe('WARN');
});

test('日志页显示关键操作，筛选错误并查看详情与导出', async ({ page }, testInfo) => {
  await page.goto('/');
  await seedState(page, emptyState()); await page.reload();
  await page.evaluate(async () => {
    const modulePath = '/src/shared/lib/client.ts';
    const { call, logEvent } = await import(/* @vite-ignore */ modulePath);
    const state = (await call('state.get')).state;
    await call('preferences.save', state.preferences);
    await call('character.save', { id: 'c', name: '', demoText: '', settings: {} }).catch(() => undefined);
    logEvent('export_saved', 'srt');
  });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '日志', exact: true }).click();
  const panel = page.getByRole('tabpanel', { name: '日志' });
  await expect(panel.getByRole('row')).toHaveCount(4);
  await expect(page.getByRole('tab', { name: '日志', exact: true })).toHaveAttribute('aria-selected', 'true');
  // 新的在前：界面导出事件、失败的角色保存、成功的偏好保存。
  await expect(panel.getByRole('row').nth(1)).toContainText('client.export_saved');
  await expect(panel.getByRole('row').nth(2)).toContainText('character.save');
  await expect(panel.getByRole('row').nth(2)).toContainText('错误');
  await expect(panel.getByRole('row').nth(3)).toContainText('preferences.save');
  await page.waitForTimeout(500);
  await page.screenshot({ path: testInfo.outputPath('logs.png') });

  await panel.getByRole('combobox', { name: '级别', exact: true }).click();
  await page.getByRole('option', { name: '仅错误', exact: true }).click();
  await expect(panel.getByRole('row')).toHaveCount(2);
  await panel.getByRole('row').nth(1).getByRole('button', { name: '详情', exact: true }).click();
  const detail = page.getByRole('dialog', { name: 'character.save' });
  await expect(detail).toContainText('@yovoice.error.characterInvalid');
  // 详情框标题栏的 X 与底部按钮都叫“关闭”，点底部的。
  await detail.getByRole('button', { name: '关闭', exact: true }).last().click();

  await panel.getByRole('combobox', { name: '级别', exact: true }).click();
  await page.getByRole('option', { name: '全部级别', exact: true }).click();
  await panel.getByRole('combobox', { name: '模块', exact: true }).click();
  await page.getByRole('option', { name: 'preferences', exact: true }).click();
  await expect(panel.getByRole('row')).toHaveCount(2);
  await panel.getByRole('combobox', { name: '模块', exact: true }).click();
  await page.getByRole('option', { name: '全部模块', exact: true }).click();
  await panel.getByLabel('搜索').fill('srt');
  await expect(panel.getByRole('row')).toHaveCount(2);
  await expect(panel.getByRole('row').nth(1)).toContainText('client.export_saved');

  const download = page.waitForEvent('download');
  await panel.getByRole('button', { name: '导出诊断包', exact: true }).click();
  const saved = await download; await saved.saveAs(testInfo.outputPath('logs.jsonl'));
  const { readFile } = await import('node:fs/promises');
  const lines = (await readFile(testInfo.outputPath('logs.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  expect(lines.map(line => line.msg)).toEqual(['preferences.save', 'character.save', 'client.export_saved']);
});
