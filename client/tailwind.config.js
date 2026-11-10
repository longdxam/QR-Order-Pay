const token = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: token('background'),
        foreground: token('foreground'),
        primary: {
          DEFAULT: token('primary'),
          foreground: token('primary-fg'),
        },
        accent: {
          DEFAULT: token('accent'),
          foreground: token('accent-fg'),
          ink: token('accent-ink'),
        },
        muted: {
          DEFAULT: token('muted'),
          foreground: token('muted-fg'),
        },
        card: {
          DEFAULT: token('card'),
          foreground: token('card-fg'),
        },
        border: token('border'),
        control: token('control'),
        danger: token('danger'),
        success: token('success'),
        warning: { DEFAULT: token('accent'), foreground: token('accent-fg') },
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        display: ['var(--font-display)'],
      },
      boxShadow: {
        soft: '0 8px 24px -12px rgb(var(--c-shadow) / 0.18)',
      },
    },
  },
  plugins: [],
};
