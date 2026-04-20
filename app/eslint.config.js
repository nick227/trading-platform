import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default [
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // Core hooks rules (from recommended)
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // New strict rules from v5 — downgrade to warn; many are false positives in this codebase
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/purity': 'warn',

      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'no-unused-vars': ['warn', { varsIgnorePattern: '^_', argsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-duplicate-imports': 'error',
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        // Browser globals
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        fetch: 'readonly',
        performance: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        location: 'readonly',
        navigator: 'readonly',
        history: 'readonly',
        // Network/async
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        WebSocket: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        Headers: 'readonly',
        FormData: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        EventSource: 'readonly',
        // DOM
        HTMLElement: 'readonly',
        Event: 'readonly',
        CustomEvent: 'readonly',
        MutationObserver: 'readonly',
        IntersectionObserver: 'readonly',
        ResizeObserver: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        queueMicrotask: 'readonly',
        // JS builtins
        Date: 'readonly',
        Math: 'readonly',
        Promise: 'readonly',
        Map: 'readonly',
        Set: 'readonly',
        Array: 'readonly',
        Object: 'readonly',
        JSON: 'readonly',
        Error: 'readonly',
        RegExp: 'readonly',
        Number: 'readonly',
        String: 'readonly',
        Boolean: 'readonly',
        Symbol: 'readonly',
        BigInt: 'readonly',
        parseInt: 'readonly',
        parseFloat: 'readonly',
        isNaN: 'readonly',
        isFinite: 'readonly',
        Intl: 'readonly',
        Proxy: 'readonly',
        Reflect: 'readonly',
        WeakMap: 'readonly',
        WeakSet: 'readonly',
        WeakRef: 'readonly',
        FinalizationRegistry: 'readonly',
        crypto: 'readonly',
        // Node/env
        process: 'readonly',
        global: 'readonly',
        globalThis: 'readonly',
        // React (JSX transform — no import needed in React 17+)
        React: 'readonly',
      },
    },
  },
]
