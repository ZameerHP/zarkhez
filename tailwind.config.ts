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
          DEFAULT: '#6B8A1F',
          dark: '#3F5A1E',
          fresh: '#5FA52E',
        },
        wheat: '#C8962E',
        cream: '#FBF6D9',
        canvas: '#F4F5EE',
        ink: '#111111',
        alert: {
          amber: '#E0A100',
          red: '#C0392B',
        },
      },
      borderRadius: {
        phone: '40px',
        card: '24px',
        tile: '16px',
      },
      boxShadow: {
        soft: '0 8px 30px rgba(30,50,10,0.10)',
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
