import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // shared/theme/yovoice-*.* 由 astryx theme build 生成。
  { ignores: ['dist', 'test-results', 'playwright-report', 'src/shared/theme/yovoice-*'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // 未启用 React Compiler，只检查 Hook 调用规则与依赖完整性。
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      // 产品里不用“闪光星星”一类的 AI 装饰图标，按功能选具体的图标。
      'no-restricted-imports': ['error', { paths: [{ name: 'lucide-react', importNames: ['Sparkle', 'Sparkles', 'WandSparkles', 'MessageSquareSparkle', 'MessageCircleSparkle', 'BookOpenSparkle', 'FileSparkle', 'SparklesIcon', 'SparkleIcon', 'LucideSparkles', 'LucideSparkle'], message: '不使用闪光星星图标，请按功能换成具体的图标。' }] }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
    },
  },
);
