# Zarkhez: Complete App Building Prompt

*Full-stack AI farming assistant for the science exhibition. Name, stack, features, APIs, design, bug prevention and ready-to-paste prompts. November 2026.*

## 1. How to use this document
1. Save this file in your project as `docs/SPEC.md`.
2. Paste the **Master Build Prompt** (Section 16) into your AI coding tool (Claude Code, Cursor or similar).
3. Build **one phase at a time** (Section 15). After each phase, test on a real phone before moving on.
4. When something breaks, use the **Bug-Fix Prompt** (Section 16) with the exact error message.

## 2. Name and identity
- **Name:** Zarkhez (زرخیز, meaning fertile or productive land; say zar-KHEZ). Short, premium, rooted in Urdu, and easy to read in English letters.
- **Tagline:** Aap ki kheti, aap ka dost (آپ کی کھیتی، آپ کا دوست).
- **Backup names:** Kisan Dost, Fasal Saathi. Search the web and app stores before publishing publicly so the name does not clash with an existing app.
- **Logo:** a green sprout inside a rounded square, olive green with one small gold leaf. It must stay readable at 24 px.
- **Personality:** calm, respectful, plain words. Never scary, never technical without explaining.

## 3. Concept
**Problem.** Small farmers decide every day what to sow, when to water and spray, and how to treat a sick crop. Expert advice is hard to reach, most apps are English-only and text-heavy, and a weather surprise or late disease detection can destroy a season's income.

**Solution.** A mobile-first web app (installable PWA) where the farmer can speak, photograph or tap and get simple answers in Urdu, with voice.

**Users.** Small and medium farmers first; agriculture students, extension workers and home gardeners second.

**What makes it different.** Urdu and voice first. All-in-one. Tells the farmer what to do and when, not just facts. Honest AI that shows its confidence and sends the farmer to an expert when unsure. Runs in the browser with nothing to install.

## 4. Honest scope (read before building)
- The standard **PlantVillage** dataset covers crops like tomato, potato and maize, **but not wheat, rice, cotton or sugarcane**. For those, look for other open datasets (check each license) or collect your own field photos.
- Version 1 disease detection supports only crops with enough good images: aim for 3 to 6 crops and 8 to 15 problems in total, plus a **Not a plant / unclear** class. The app must clearly show which crops are supported.
- Dataset photos look different from real field photos. Report accuracy on a held-out dataset set **and** on your own real photos.
- The calendar, fertilizer and profit tools can cover all six home crops (wheat, rice, cotton, sugarcane, maize, tomato), but every agronomy number must come from a verified source (provincial agriculture department, PARC, university extension material). Never invent values.
- Market prices are manual sample data and must be labelled as such. There are no live prices.
- AI advice supports a decision. It never replaces the local agriculture officer.

## 5. Final features

| # | Feature | What it does | Done when |
|---|---|---|---|
| 1 | Disease and pest detector | Photo in; problem, confidence, treatment and prevention out, in Urdu and English, with voice | Result in under 5 s on a mid-range phone; low confidence shows an expert banner; non-plant photos are handled |
| 2 | Urdu voice assistant | Speak or type any farming question; streamed answer, read aloud | Speech works where the browser supports ur-PK; typing always works; answers are short and plain |
| 3 | Weather and alerts | Current weather, 7-day forecast, heatwave, rain, frost and spray warnings | Alerts follow the rules in Section 9.3; last forecast is cached for offline |
| 4 | Crop calendar | Crop plus sowing date gives a dated task timeline (irrigation, fertilizer, spraying, harvest) | Tasks can be ticked off; the next task shows on Home |
| 5 | Fertilizer calculator | Crop, soil and land size give the amount per acre and in total | Uses the verified rate table and shows its source |
| 6 | Profit calculator | Costs and expected income give profit per acre, with a what-if price slider | Updates live; handles empty inputs |
| 7 | Farm diary | Saves scans, notes, expenses and income per field | List view plus one simple chart |
| 8 | Urdu / English with voice readout | Language toggle with full right-to-left layout and a listen button on every result | No hardcoded strings; layout mirrors correctly |

## 6. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js (App Router) + TypeScript | Frontend and API routes in one project; keeps API keys on the server |
| Styling | Tailwind CSS + shadcn/ui (Radix) | Fast, consistent, accessible |
| Animation | Framer Motion | Smooth, premium transitions |
| Icons | lucide-react | Clean line icons |
| i18n | next-intl (en, ur) with RTL | Locale routing and direction switching |
| Fonts | Plus Jakarta Sans (Latin), Noto Nastaliq Urdu (Urdu headings), Noto Naskh Arabic (Urdu body and small text), loaded with next/font/google | Premium look and readable Urdu |
| Charts | Recharts | Expense and profit charts |
| Disease model | Teachable Machine image project exported to TensorFlow.js (or a Keras model converted with tfjs-converter) | Runs in the browser; accuracy can be measured |
| AI advice, chat, second opinion | Anthropic API with @anthropic-ai/sdk. Put the model name in an env var (ANTHROPIC_MODEL, for example claude-sonnet-5-5) and confirm current names in the Anthropic docs | Strong Urdu; vision for low-confidence second opinions |
| Weather | Open-Meteo forecast and geocoding APIs | Free for non-commercial use, no key |
| Voice | Web Speech API (speech recognition and speech synthesis) | No cost, runs in the browser |
| Database, auth, files | Supabase (Postgres, anonymous sign-in, Storage) | Farmers need no password; row level security |
| Validation | Zod | Validates every API input and every AI output |
| Rate limiting | Upstash Ratelimit (free tier) | Protects your API budget at the exhibition |
| PWA | Serwist (or next-pwa) | Installable with an offline shell |
| Testing | Vitest and Playwright | Unit tests and smoke tests |
| Hosting | Vercel | Free HTTPS (required for camera and microphone) |

## 7. Architecture and folder structure

```text
zarkhez/
  app/
    [locale]/
      layout.tsx            sets lang, dir and fonts
      page.tsx              welcome screen
      home/page.tsx
      weather/page.tsx
      assistant/page.tsx
      diary/page.tsx
      crop/[id]/page.tsx
      scan/page.tsx
      tools/calendar/page.tsx
      tools/fertilizer/page.tsx
      tools/profit/page.tsx
    api/
      weather/route.ts
      geocode/route.ts
      advice/route.ts
      chat/route.ts
      verify-image/route.ts
  components/
    ui/  layout/  cards/  scan/  weather/  voice/
  lib/
    anthropic.ts  supabase/  weather.ts  alerts.ts  calendar.ts
    fertilizer.ts  profit.ts  model.ts  voice.ts  ratelimit.ts  schemas.ts
  data/
    crops.json  diseases.json  fertilizer-rates.json
  messages/
    en.json  ur.json
  public/
    model/  (model.json, weights.bin, metadata.json)
    images/
  docs/SPEC.md
  tests/
```

**Data flow.** The browser calls Next.js API routes, which call Open-Meteo and Anthropic. The browser talks to Supabase directly with the public anon key and row level security for diary data. The TensorFlow.js model runs fully in the browser. Secret keys exist only in server environment variables.

## 8. Data model (Supabase SQL)

```sql
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  language text default 'ur',
  place_name text, lat double precision, lon double precision,
  created_at timestamptz default now()
);

create table fields (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null, crop text not null,
  area_acres numeric, soil_type text, sowing_date date,
  created_at timestamptz default now()
);

create table scans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  field_id uuid references fields on delete set null,
  image_path text, label text, confidence numeric, advice jsonb,
  created_at timestamptz default now()
);

create table diary_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  field_id uuid references fields on delete set null,
  kind text check (kind in ('note','expense','income')),
  category text, amount numeric, note text,
  entry_date date default current_date,
  created_at timestamptz default now()
);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  field_id uuid not null references fields on delete cascade,
  task_type text, title text, due_date date, done boolean default false
);

-- Row level security: repeat for fields, scans, diary_entries, tasks.
-- For profiles use: id = auth.uid()
alter table fields enable row level security;
create policy own_rows on fields for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
```

**Storage.** Create a private bucket named `scans`. Store files at `user_id/filename` and add a policy so users can only read and write their own folder. Store a small thumbnail (max 800 px), not the original photo.

## 9. APIs and business logic

### 9.1 Internal API routes

| Route | Method | Input | Output | Notes |
|---|---|---|---|---|
| `/api/weather` | GET | `lat, lon` | Trimmed forecast plus computed alerts | Server fetch to Open-Meteo, revalidate every 1800 s |
| `/api/geocode` | GET | `q` | List of places | Open-Meteo geocoding |
| `/api/advice` | POST | `label, confidence, crop` | Advice JSON in English and Urdu | Zod-validated, one retry, cached per label |
| `/api/chat` | POST | `messages, context, lang` | Streamed text | Rate limited, 20 s timeout |
| `/api/verify-image` | POST | `image` (base64, about 1 MB max), `crop` | Second-opinion JSON | Only when model confidence is below the threshold |

### 9.2 Open-Meteo requests

```text
GET https://api.open-meteo.com/v1/forecast
  latitude, longitude, timezone=auto, forecast_days=7, wind_speed_unit=ms
  current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,weather_code
  hourly=soil_temperature_0cm,soil_moisture_0_to_1cm
  daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,
        precipitation_probability_max,wind_speed_10m_max,sunrise,sunset

GET https://geocoding-api.open-meteo.com/v1/search?name=Multan&count=5&language=en
```

Confirm parameter names in the Open-Meteo docs while building, because variables are occasionally added or renamed. Show soil temperature from the hourly value for the current hour.

### 9.3 Alert rules

| Alert | Starting rule |
|---|---|
| Heatwave | Daily maximum 40 C or more on 2 or more days in a row |
| Heavy rain | Rain probability 60 percent or more, or 10 mm or more in a day |
| Frost | Daily minimum 2 C or below |
| Spray warning | Next 24 hours: rain probability 40 percent or more, or wind 5 m/s or more |

These are starting values only. Tune them with a local agriculture expert for your region. Each alert returns a type, a level (`watch` or `warning`), the day, and a translation key, so the text can be shown in either language.

### 9.4 Disease detection flow
1. Capture or upload the photo. Fix orientation, resize to 1024 px on the long side, JPEG quality 0.8.
2. Lazy-load the TensorFlow.js model and cache it with the service worker. Resize the image to the model input (224 x 224 for Teachable Machine).
3. Predict and keep the top 3 classes.
4. Apply thresholds (tune on your test set): **0.75 or more** = confident result. **0.50 to 0.75** = 'likely', ask for a closer photo. **Below 0.50** = 'not sure', show the expert banner. Top class **Not a plant / unclear** = ask for another photo.
5. If below 0.75 and online, optionally call `/api/verify-image` and show the result labelled as an AI second opinion.
6. Call `/api/advice` with the final label. Cache advice per label so repeat scans are instant and cheap.
7. Save the scan and thumbnail, then show the result card.

### 9.5 Deterministic tools (no AI)
- **Calendar:** each task has a day offset from the sowing date. Due date = sowing date + offset. Repeating tasks use `repeatEveryDays` until harvest.
- **Fertilizer:** total = rate per acre x area in acres, for each product, looked up by crop and soil. Always show the source note.
- **Profit:** income = yield per acre x price per unit x area. Profit = income minus the sum of costs. The slider scales the price from minus 30 percent to plus 30 percent.

```ts
type Crop = {
  key: string;                                   // 'wheat'
  name: { en: string; ur: string };
  season: 'rabi' | 'kharif';
  durationDays: number;                          // VERIFY with agriculture department
  stages: { key: string; name: { en: string; ur: string };
            startDay: number; endDay: number }[];
  tasks: { type: 'irrigation' | 'fertilizer' | 'spray' | 'weeding' | 'harvest';
           title: { en: string; ur: string };
           day: number; repeatEveryDays?: number }[];
  source: string;                                // where the numbers came from
};
// fertilizer-rates.json rows: { crop, soil, product, kgPerAcre, source }
```

## 10. AI prompts

Generate English and Urdu in a single call so switching language needs no new request. Use temperature 0.3, `max_tokens` about 800 for advice and 500 for chat.

### 10.1 Advice system prompt
```text
You are an agriculture advisor for small farmers in Pakistan. You receive a detected crop problem and return practical advice in simple language.
Rules:
- Write for a farmer with low literacy: short sentences, common words, no jargon.
- Give low-risk, low-cost steps first (remove infected leaves, improve drainage, adjust irrigation, field hygiene).
- For chemical treatment, name only the type of product or active ingredient class, never an exact dose. Tell the farmer to follow the product label and confirm with the local agriculture officer.
- If the confidence is low or you are unsure, say so and set see_expert to true.
- Return ONLY valid JSON that matches the schema. No extra text, no markdown.
```

```ts
type Advice = {
  problem_name: { en: string; ur: string };
  severity: 'low' | 'medium' | 'high';
  summary: { en: string; ur: string };          // 2 sentences max
  steps: { en: string; ur: string }[];          // 3 to 5 action steps
  prevention: { en: string; ur: string }[];     // 2 to 3 tips
  see_expert: boolean;
  expert_reason?: { en: string; ur: string };
};
```

Validate with Zod. On a parse failure, retry once. If it fails again, show a built-in fallback message from `diseases.json`.

### 10.2 Chat system prompt
```text
You are Zarkhez, a friendly farming assistant for small farmers in Pakistan.
Context: crop, region name, growth stage and a short weather summary are provided with each question.
Rules:
- Answer in the language of the question. For Urdu, use Urdu script.
- Keep answers under 120 words. Use numbered steps when giving instructions.
- Ask at most one clarifying question, and only if needed.
- You cannot diagnose a disease from text alone. Suggest the Scan feature or an expert.
- For pesticides: no exact doses; follow the label; confirm with the local agriculture officer.
- If the question is not about farming, politely say you can only help with farming.
```

### 10.3 Second-opinion image prompt
```text
Look at this crop photo. The on-device model thinks it shows {label} on {crop} with low confidence. Say whether the photo is a clear plant leaf, what visible symptoms you see, and whether you agree. If the image is unclear or not a plant, say so. Return only the JSON schema provided.
```

## 11. Design system (from the reference UI)

**Look:** premium, photo-led and calm. Olive green and wheat gold on a soft off-white page, frosted glass over photos, and a floating black navigation pill. Use your own photos or free-licence ones (Unsplash, Pexels). Do not copy images or the logo from the reference design.

### 11.1 Tokens
```ts
// tailwind.config.ts (extend)
colors: {
  olive:  { DEFAULT: '#6B8A1F', dark: '#3F5A1E', fresh: '#5FA52E' },
  wheat:  '#C8962E',
  cream:  '#FBF6D9',
  canvas: '#F4F5EE',
  ink:    '#111111',
  alert:  { amber: '#E0A100', red: '#C0392B' }
},
borderRadius: { phone: '40px', card: '24px', tile: '16px' },
boxShadow: { soft: '0 8px 30px rgba(30,50,10,0.10)' }

/* glass effect */
.glass { background: rgba(255,255,255,0.25); backdrop-filter: blur(14px);
         border: 1px solid rgba(255,255,255,0.45); }
@supports not (backdrop-filter: blur(1px)) { .glass { background: rgba(255,255,255,0.85); } }
```

- **Type:** headings in Plus Jakarta Sans weight 800 (uppercase only on the welcome headline); body weights 400 to 600. Body 16 px, small 14 px, page title 28 to 32 px. Urdu: minimum 18 px with line-height 2.
- **Spacing:** 4 px grid, 20 px page padding, minimum tap target 48 px.
- **Rules:** real photography, not cartoons. One idea per screen. Every number comes with a small icon. Primary actions sit in the lower 40 percent of the screen for one-handed use. Maximum two accent colours per screen. Text contrast must meet WCAG AA.

### 11.2 Screens
- **Welcome.** Full-bleed wheat photo that fades to white over the top 45 percent. Logo top-left. Large heavy headline (SMART FARMING IN YOUR LANGUAGE) with a tiny round field photo inline, and one short subtitle. Two glass chips on the photo (Crop doctor, Urdu voice) and a thin circular tick ring over the wheat. Two glass language pills (اردو and English) above a full-width frosted Get Started button. Next step asks for location with a plain explanation and a manual search fallback.
- **Home.** Olive header with a rounded bottom edge. Greeting in two weights (Assalam o Alaikum light, Kisan bold), date below, round refresh button top-right. Voice bar: translucent pill with a search icon, placeholder Ask anything, and a large mic; tapping it opens the Assistant with the mic ready. White weather card overlapping the header: place name, soft cloud icon, big temperature, four stats with icons (soil temperature, humidity, wind, rain) and a dotted sun arc with sunrise and sunset. Amber alert banner when an alert is active. **My Crops:** horizontal row of white rounded tiles (wheat, rice, cotton, sugarcane, maize, tomato). **Quick tools:** Scan Leaf, Calendar, Fertilizer, Profit. **My Fields:** photo cards with crop stage and next task. Floating black pill nav with four icons: Home, Weather, Assistant, Diary; the active icon is bright green.
- **Weather.** Same card style, larger. Hourly strip, 7-day list, alert list with plain-language actions, soil section.
- **Assistant.** Chat bubbles, large mic button, three suggested question chips, a listen button on every answer, typing fallback.
- **Scan.** Camera or upload with a guide frame and tips (one leaf, good light, fill the frame). Analysing state with a pulsing scanner ring. Result card: problem name, confidence bar, severity chip, 3 to 5 steps, prevention tips, Listen, Save to diary, and an expert banner when needed.
- **Crop detail.** Full-bleed crop photo, glass back button, glass pill with crop thumbnail and place, glass side buttons (Scan, Calendar). Bottom white card: crop name in bold green, expected harvest date, estimated profit (from the profit tool, labelled as an estimate) and the next three tasks.
- **Tools.** Calendar as a timeline with tick boxes. Fertilizer and Profit as simple forms with big numeric inputs and a result card with large green numbers.
- **Diary.** Tabs for Notes, Expenses and Scans. Monthly summary card with one bar chart. Floating add button.

### 11.3 Motion and states
- 200 to 300 ms ease-out. Slide between tabs, fade-up cards on load, pulsing scanner ring while analysing. Respect `prefers-reduced-motion`.
- Every screen needs a loading skeleton, an empty state (one friendly line and one action) and an error state (plain words and a Retry button).

### 11.4 Right-to-left rules
- Set `html` `lang` and `dir` from the locale. Use logical Tailwind classes (`ms-`, `me-`, `ps-`, `pe-`, `start-`, `end-`, `text-start`). Never use `left` or `right`.
- Mirror direction icons (chevrons, back arrows). Do not mirror logos, photos or the sun arc.
- Keep numbers, temperatures and units as left-to-right runs (`bdi` or `dir=ltr` spans).
- Test every screen in both languages.

## 12. Bug prevention and fixes
- API key leaks -> Call Anthropic only from `/api` routes; never in `NEXT_PUBLIC_`
- Camera or mic does nothing -> HTTPS, permission-denied UI with steps, offer file upload
- No Urdu speech input -> Detect support, hide mic or show typing fallback
- Voice readout silent -> List `speechSynthesis` voices, pick Urdu if present, otherwise note
- Bottom nav hidden on iPhone -> Use `dvh` units, `env(safe-area-inset-bottom)`, `viewport-fit=cover`
- Nastaliq text clipped -> `line-height: 2`, extra vertical padding, no fixed-height text boxes
- Layout broken in Urdu -> Use logical properties (`ms-`, `me-`, `ps-`, `pe-`, `start-`, `end-`)
- Hydration mismatch -> Render date, time and location content on client only
- Weather fails or is slow -> 8 s timeout; show last cached forecast with updated time; Retry button
- Wrong sunrise or day -> Request `timezone=auto` and format with returned timezone
- App slows after many scans -> Wrap in `tf.tidy`, dispose tensors, load model once and reuse
- Wrong results on phone photos -> Normalise orientation, resize on canvas, accept `image/*`
- AI returns broken JSON -> Strip code fences, Zod validate, retry once, static fallback
- AI call hangs -> `AbortController` at 20 s, rate limit, cache advice per label
- Voice reads symbols aloud -> Strip markdown before speech

## 13. Security, privacy and cost
- Secrets only in server environment variables. Validate all input with Zod, limit request body size, and rate limit AI routes (20 AI calls per 10 minutes per IP).
- Use anonymous sign-in. Do not send exact coordinates or personal detail to the AI; send only crop, district name and a weather summary.
- Save scan photos only with the farmer's consent, as small thumbnails. Add a Delete my data button.
- Keep disclaimers visible on advice screens: guidance only, confirm with your local agriculture officer.

## 14. Testing and QA
- Automated: unit tests for alerts, calendar, fertilizer and profit using hand-calculated cases. Playwright smoke tests.

## 15. Build phases
- **Phase 0. Setup:** Repo, Next.js, Tailwind, fonts, next-intl with RTL, Supabase, env vars
- **Phase 1. Look and weather:** Welcome, Home, floating nav, weather card, location, alerts, read-aloud button
- **Phase 2. Scan and advice:** Model, TensorFlow.js, scan flow, advice API, result card, save scans
- **Phase 3. Tools and diary:** Crop data, calendar, fertilizer, profit, diary, crop detail, My Fields
- **Phase 4. Assistant and polish:** Streaming chat, voice input, PWA, offline, rate limits, QA
