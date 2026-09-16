/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#FAF7F2',
        foreground: '#2B2118',
        primary: {
          DEFAULT: '#285943',
          foreground: '#FAF7F2',
        },
        accent: {
          DEFAULT: '#C88A4D',
          foreground: '#2B2118',
        },
        muted: {
          DEFAULT: '#EFEAE2',
          foreground: '#6B5E52',
        },
        card: {
          DEFAULT: '#FFFFFF',
          foreground: '#2B2118',
        },
        danger: '#C0392B',
        success: '#2D8F4E',
      },
      fontFamily: {
        sans: ['"Inter"', '"Be Vietnam Pro"', 'system-ui', 'sans-serif'],
        display: ['"Playfair Display"', '"Be Vietnam Pro"', 'serif'],
      },
      boxShadow: {
        soft: '0 8px 24px -12px rgba(43, 33, 24, 0.18)',
      },
    },
  },
  plugins: [],
};
