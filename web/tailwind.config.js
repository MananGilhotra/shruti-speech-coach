/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#0f172a', soft: '#334155', muted: '#64748b', faint: '#94a3b8' },
        line: { DEFAULT: '#e2e8f0', strong: '#cbd5e1' },
        surface: { DEFAULT: '#ffffff', sunken: '#f8fafc', raised: '#ffffff' },
        accent: { DEFAULT: '#3730a3', soft: '#eef2ff', hover: '#312e81', ring: '#6366f1' },
        refc: { DEFAULT: '#b45309', soft: '#fef3c7' },
        dim: {
          pacing: '#0072B2',
          pausing: '#E69F00',
          intonation: '#009E73',
          projection: '#CC79A7',
          fluency: '#D55E00',
          clarity: '#56B4E9',
          emphasis: '#9a8a00',
        },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      maxWidth: { page: '1440px' },
    },
  },
  plugins: [],
};
