import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        olive: {
          DEFAULT: '#16A34A',
          dark: '#065F46',
          fresh: '#10B981',
        },
        wheat: '#D97706',
        cream: '#FEF3C7',
        canvas: '#F8FAFC',
        ink: '#0F172A',
        alert: {
          amber: '#F59E0B',
          red: '#DC2626',
        },
      },
      borderRadius: {
        phone: '40px',
        card: '24px',
        tile: '16px',
      },
      boxShadow: {
        soft: '0 10px 28px -6px rgba(15,23,42,0.08), 0 4px 10px -4px rgba(15,23,42,0.04)',
      },
      fontFamily: {
        sans: ['var(--font-jakarta)', 'var(--font-naskh)', 'sans-serif'],
        urduHeading: ['var(--font-nastaliq)', 'var(--font-naskh)', 'serif'],
        urduBody: ['var(--font-naskh)', 'sans-serif'],
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
