import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
import a11y from 'eslint-plugin-jsx-a11y';
import globals from 'globals';
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'src-tauri/target/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
      '.agent/**',
      '.claude/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': hooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ...a11y.flatConfigs.recommended,
    settings: {
      'jsx-a11y': { components: { TextInput: 'input', TextArea: 'textarea' } },
    },
  },
  {
    files: ['*.{js,mjs,ts}', 'e2e/**'],
    languageOptions: { globals: globals.node },
  },
);
