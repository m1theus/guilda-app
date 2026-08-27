import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#f6f3ee',
        canvas: '#101116',
        panel: '#171920',
        panelRaised: '#1e212a',
        line: '#2e323d',
        muted: '#9aa0ad',
        violet: '#9684ff',
        violetDark: '#6f5bd6',
        mint: '#75e0bd',
        coral: '#f18b82',
      },
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
      boxShadow: { glow: '0 0 40px rgba(150,132,255,.12)' },
    },
  },
  plugins: [],
} satisfies Config;
