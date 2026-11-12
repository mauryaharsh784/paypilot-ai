/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: { 950: '#070E24', 900: '#0C1636', 800: '#13204A', 700: '#1B2B5E', 600: '#2A3C75' },
        paper: '#F5F7FB', line: '#E2E7F1', ink: '#0C1636', muted: '#5F6B85',
        brand: { DEFAULT: '#5B5BF0', dark: '#4646D6', soft: '#ECECFE' },
        azure: '#2F6BFF', ok: '#12A150', warn: '#B86E00', bad: '#D64545',
      },
      fontFamily: { display: ['Sora', 'system-ui', 'sans-serif'], body: ['Manrope', 'system-ui', 'sans-serif'] },
      boxShadow: { card: '0 1px 2px rgba(12,22,54,.05), 0 6px 20px -8px rgba(12,22,54,.10)' },
    },
  },
  plugins: [],
};
