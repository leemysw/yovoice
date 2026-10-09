import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const files = (dir: string, ext: RegExp): string[] => readdirSync(dir, { withFileTypes: true, recursive: true })
  .filter(entry => entry.isFile() && ext.test(entry.name)).map(entry => join(entry.parentPath, entry.name));

// 引用不存在的令牌会让整条声明静默失效（例如间距只定义到 --spacing-12）。
test('样式表只引用已定义的 CSS 变量', () => {
  const defined = new Set<string>();
  const sources = [...files('node_modules/@astryxdesign/core/dist', /\.css$/), ...files('node_modules/@astryxdesign/theme-neutral', /\.css$/), ...files('src', /\.css$/)];
  for (const file of sources) for (const [, name] of readFileSync(file, 'utf8').matchAll(/(--[\w-]+)\s*:/g)) defined.add(name);
  // 组件通过 style 属性设置的变量。
  for (const file of files('src', /\.tsx?$/)) for (const [, name] of readFileSync(file, 'utf8').matchAll(/['"](--[\w-]+)['"]\s*:/g)) defined.add(name);
  const missing = files('src', /\.css$/).flatMap(file => readFileSync(file, 'utf8').split('\n').flatMap((line, index) =>
    [...line.matchAll(/var\((--[\w-]+)/g)].filter(([, name]) => !defined.has(name)).map(([, name]) => `${file}:${index + 1} ${name}`)));
  expect(missing).toEqual([]);
});
