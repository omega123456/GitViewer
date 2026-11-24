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
    files: ['src/**/*.{ts,tsx}', 'e2e/**/*.ts'],
    rules: {
      'id-length': ['error', { min: 2, properties: 'never' }],
      'no-magic-numbers': 'off',
      '@typescript-eslint/no-magic-numbers': [
        'error',
        {
          ignore: [0, 1, -1],
          ignoreArrayIndexes: true,
          ignoreDefaultValues: true,
          ignoreEnums: true,
          ignoreNumericLiteralTypes: true,
          ignoreReadonlyClassProperties: true,
          ignoreTypeIndexes: true,
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSNonNullExpression',
          message: 'Narrow the value with a guard instead of asserting it.',
        },
        {
          selector:
            'TSAsExpression:not([typeAnnotation.typeName.name="const"]), TSTypeAssertion',
          message: 'Get the value in the right shape at its source.',
        },
        {
          selector: 'SwitchStatement',
          message: 'Branch on a key through a lookup table.',
        },
        {
          selector: 'IfStatement[alternate]',
          message:
            'Return early with a guard clause instead of an else branch.',
        },
      ],
      'no-nested-ternary': 'error',
      'max-depth': ['error', 2],
      'max-lines-per-function': ['error', 60],
      'max-lines': ['error', 400],
      complexity: ['error', 10],
      'object-shorthand': ['error', 'consistent'],
      'max-params': ['error', 3],
    },
  },
  {
    files: ['*.{js,mjs,ts}', 'e2e/**'],
    languageOptions: { globals: globals.node },
  },
);
