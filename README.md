# Zarkhez (زرخیز) — Aap ki kheti, aap ka dost

**Zarkhez** (`زرخیز`) is an Urdu-first, voice-enabled AI farming assistant Progressive Web App (PWA) designed for small and medium farmers in Pakistan. Built from `docs/SPEC.md` for the November 2026 Science Exhibition.

---

## ✨ Features Built (Phases 0 – 4 Complete)

1. **Disease & Pest Detector (`/scan`)**
   - On-device TensorFlow.js model (`public/model/model.json`, `weights.bin`, `metadata.json`) running inside `tf.tidy()` for zero memory leaks.
   - Supports 4 crops (**Tomato, Wheat, Maize, Rice**) + `not_a_plant` / unclear class, plus built-in 1-tap demo leaf samples for exhibition judging.
   - Confidence thresholds: `≥ 75%` confident, `50–74%` likely (asks for closer photo), `< 50%` unsure (displays Local Agriculture Officer banner + optional AI Vision Second Opinion via `/api/verify-image`).
   - Bilingual advice (`ur` and `en`) with low-risk steps first, no exact chemical doses, voice readout (`Listen` / `سنیں`), and Save to Diary.
2. **Urdu Voice Assistant (`/assistant`)**
   - Web Speech API (`ur-PK` and `en-US`) with streaming responses from `/api/chat`, 3 suggested question chips, `Listen` button on every answer, and full typing fallback.
3. **Weather & Agricultural Alerts (`/weather` & `/home`)**
   - Live Open-Meteo 7-day forecast + hourly `0–1 cm` soil temperature & moisture + geocoding search (`/api/weather`, `/api/geocode`).
   - Deterministic alert engine (`lib/alerts.ts`) for **Heatwave (≥ 40°C for 2+ days)**, **Heavy Rain (≥ 60% or ≥ 10mm)**, **Frost (≤ 2°C)**, and **Spray Warning (24h rain ≥ 40% or wind ≥ 5 m/s)**.
   - Automatic offline forecast caching in `localStorage`.
4. **Crop Calendar (`/tools/calendar` & `/crop/[id]`)**
   - Covers all 6 crops (**Wheat, Rice, Cotton, Sugarcane, Maize, Tomato**) with verified stages and repeatable tasks (`lib/calendar.ts`).
5. **Fertilizer Calculator (`/tools/fertilizer`)**
   - Per-acre, total kg, and 50kg bag counts by crop and soil fertility (`poor`, `medium`, `fertile`) with verified PARC / Provincial Agriculture Department sources (`data/fertilizer-rates.json`).
6. **Profit Calculator (`/tools/profit`)**
   - Live per-acre and total net profit calculation with a `-30%` to `+30%` What-If Market Price slider (`lib/profit.ts`).
7. **Farm Diary (`/diary`)**
   - Tracks field notes, expenses, income, and saved leaf scans with a Recharts financial summary bar chart and a one-click **Delete my data** privacy button.
8. **Full Urdu RTL & English LTR (`next-intl`)**
   - Zero hardcoded UI strings (`messages/ur.json`, `messages/en.json`), logical CSS classes (`ms-`, `me-`, `ps-`, `pe-`, `start-`, `end-`), `<bdi dir="ltr">` for numbers/units, and Nastaliq/Naskh typography.

---

## 🚀 Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Run unit tests & model evaluation report
npm run test
npm run eval:model

# 3. Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser (or on your phone over the same Wi-Fi network).

---

## 🔐 Optional Environment Variables (`.env.local`)

The app works out-of-the-box using Open-Meteo (free, no key required), the on-device TensorFlow.js model, verified agronomy JSON tables, and local storage synchronization. To enable live Anthropic Claude responses, Supabase cloud sync, and Upstash Redis rate limiting, copy `.env.example` to `.env.local`:

```env
ANTHROPIC_API_KEY=your_key_here
ANTHROPIC_MODEL=claude-sonnet-4-5
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
UPSTASH_REDIS_REST_URL=your_upstash_url
UPSTASH_REDIS_REST_TOKEN=your_upstash_token
```

For Supabase setup, run `supabase/schema.sql` in the Supabase SQL Editor and enable Anonymous Sign-Ins.
