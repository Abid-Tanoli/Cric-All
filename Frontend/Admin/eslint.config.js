import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default [
  // Node scripts use top-level await (like the User app's PWA scripts), which
  // this ESLint 8 config cannot parse. They are run/tested directly by npm.
  { ignores: ['dist/**', 'scripts/**'] },
  {
    languageOptions: {
      globals: { ...globals.browser },
      ecmaVersion: 2020,
      sourceType: 'module',
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
]
