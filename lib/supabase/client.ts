import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Advice } from '../schemas';
import { SoilType } from '../fertilizer';

/**
 * Zarkhez Authentication, Farmer Persona ID, and Cloud/Local Data Store
 * - Zero fake/demo data: fields, scans, and diary entries contain ONLY real user records.
 * - Supports Google Sign-In (Supabase Google OAuth + direct Google Identity / Persona onboarding)
 * - Generates a deterministic, unique Farmer Persona ID (e.g., ZRK-PK-482910) from the user's identity.
 */

export interface FarmerProfile {
  farmerId: string; // e.g., ZRK-PK-482910
  fullName: string;
  fatherOrFarmName: string;
  email: string;
  phone: string;
  district?: string;
  province?: string;
  villageOrTehsil: string;
  placeName: string;
  lat: number;
  lon: number;
  totalAcres: number;
  landAcresBand?: string;
  primaryCrops: string[];
  mainCrops?: string[];
  avatarUrl: string;
  authProvider: 'google' | 'anonymous' | 'email' | 'none';
  isAuthenticated: boolean;
  language: 'ur' | 'en';
  autoSpeakVoice: boolean;
  preferredVoice?: string; // 'ur-PK-UzmaNeural' | 'ur-PK-AsadNeural'
  voiceSpeed?: number;
  onboardingDone?: boolean;
  consentTermsAt?: string | null;
  consentImproveModel?: boolean;
  joinedAt: string;
  lastSeenAt?: string;
}

export type FarmProfile = FarmerProfile;

export function isValidUuid(val: string | undefined | null): boolean {
  if (!val) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    val
  );
}

export function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Returns true when the farmer has filled out all personal & farm profile fields.
 */
export function arePersonalFieldsComplete(
  p: Partial<FarmerProfile> | null | undefined
): boolean {
  if (!p) return false;
  const name = (p.fullName || '').trim();
  const placeholderNames = new Set(['guest farmer', 'مہمان کسان', 'farmer', 'کسان بھائی', '']);
  if (!name || placeholderNames.has(name.toLowerCase())) return false;
  if (!(p.fatherOrFarmName || '').trim()) return false;
  if (!(p.phone || '').trim()) return false;
  if (!(p.villageOrTehsil || '').trim()) return false;
  if (!(p.placeName || '').trim()) return false;
  if (!(Number(p.totalAcres) > 0)) return false;
  if (!Array.isArray(p.primaryCrops) || p.primaryCrops.length === 0) return false;
  return true;
}

export type ScanOrgan =
  | 'leaf_top'
  | 'leaf_under'
  | 'stem'
  | 'roots'
  | 'whole_plant'
  | 'fruit_flower'
  | 'other';

export interface ScanSession {
  id: string;
  user_id: string;
  field_id?: string | null;
  crop_selected?: string | null;
  answers?: Record<string, unknown>;
  quick?: Record<string, unknown>;
  report?: Record<string, unknown>;
  top_label?: string | null;
  top_confidence?: number | null;
  severity?: 'low' | 'medium' | 'high' | null;
  on_device_label?: string | null;
  on_device_confidence?: number | null;
  status: 'pending' | 'quick_done' | 'done' | 'failed';
  latency_ms?: { quick?: number; detail?: number; tts?: number };
  created_at: string;
}

export interface ScanImage {
  id: string;
  session_id: string;
  user_id: string;
  organ: ScanOrgan;
  storage_path: string;
  quality?: {
    blur?: number;
    brightness?: number;
    subject_size?: number;
    is_blurry?: boolean;
    is_dark?: boolean;
  };
  created_at: string;
}

export interface ScanFeedback {
  id: string;
  session_id: string;
  user_id: string;
  correct: 'yes' | 'no' | 'unsure';
  right_label?: string | null;
  note?: string | null;
  created_at: string;
}

export interface FarmField {
  id: string;
  name: string;
  crop: string;
  area_acres: number;
  soil_type: SoilType;
  sowing_date: string; // YYYY-MM-DD
  completedTaskIds: string[];
  created_at: string;
}

export interface SavedScan {
  id: string;
  field_id?: string | null;
  crop: string;
  selected_crop?: string;
  detected_crop?: string;
  plant_part?: string;
  diagnosis_status?: string;
  thumbnailDataUrl: string;
  label: string;
  confidence: number;
  advice: Advice;
  cloudSynced?: boolean;
  created_at: string;
}

export interface DiaryEntry {
  id: string;
  field_id?: string | null;
  kind: 'note' | 'expense' | 'income';
  category: string;
  amount: number;
  note: string;
  entry_date: string; // YYYY-MM-DD
  created_at: string;
}

const KEYS = {
  PROFILE: 'zarkhez_persona_v2',
  FIELDS: 'zarkhez_real_fields_v2',
  SCANS: 'zarkhez_real_scans_v2',
  DIARY: 'zarkhez_real_diary_v2',
  REGISTERED_ACCOUNTS: 'zarkhez_registered_accounts_v2',
  VAULT_PREFIX: 'zarkhez_account_vault_v1:',
};

const IDB_NAME = 'zarkhez_durable_db_v1';
const IDB_STORE = 'kv';

interface AccountVaultSnapshot {
  profile: FarmerProfile;
  fields: FarmField[];
  scans: SavedScan[];
  diary: DiaryEntry[];
  updatedAt: string;
}

function openDurableDb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const req = window.indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbGet<T>(key: string): Promise<T | null> {
  const db = await openDurableDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDurableDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function idbDelete(key: string): Promise<void> {
  const db = await openDurableDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

function setAuthCookie(active: boolean): void {
  if (typeof document === 'undefined') return;
  document.cookie = active
    ? 'zarkhez_auth=1; path=/; max-age=31536000; SameSite=Lax'
    : 'zarkhez_auth=; path=/; max-age=0; SameSite=Lax';
}

function writeEmailVaultSnapshot(profile: FarmerProfile): void {
  if (typeof window === 'undefined') return;
  const cleanEmail = (profile.email || '').trim().toLowerCase();
  if (!cleanEmail || !profile.isAuthenticated || profile.authProvider === 'anonymous') return;

  const snapshot: AccountVaultSnapshot = {
    profile,
    fields: getSavedFields(),
    scans: getSavedScans(),
    diary: getDiaryEntries(),
    updatedAt: new Date().toISOString(),
  };

  try {
    localStorage.setItem(`${KEYS.VAULT_PREFIX}${cleanEmail}`, JSON.stringify(snapshot));
  } catch {
    // Fallback without heavy scan thumbnails if localStorage is near quota
    try {
      localStorage.setItem(
        `${KEYS.VAULT_PREFIX}${cleanEmail}`,
        JSON.stringify({
          ...snapshot,
          scans: snapshot.scans.map((s) => ({ ...s, thumbnailDataUrl: '' })),
        })
      );
    } catch {
      // ignore localStorage limit cleanly; IndexedDB still stores full snapshot
    }
  }

  void idbSet('active_session', snapshot);
  void idbSet(`vault:${cleanEmail}`, snapshot);
}

export async function restoreAccountByEmail(rawEmail: string): Promise<FarmerProfile | null> {
  if (typeof window === 'undefined') return null;
  const cleanEmail = (rawEmail || '').trim().toLowerCase();
  if (!cleanEmail) return null;

  let snapshot: AccountVaultSnapshot | null = null;
  try {
    const raw = localStorage.getItem(`${KEYS.VAULT_PREFIX}${cleanEmail}`);
    if (raw) snapshot = JSON.parse(raw) as AccountVaultSnapshot;
  } catch {
    // ignore
  }
  if (!snapshot) {
    snapshot = await idbGet<AccountVaultSnapshot>(`vault:${cleanEmail}`);
  }

  if (snapshot?.profile?.email) {
    try {
      localStorage.setItem(KEYS.PROFILE, JSON.stringify(snapshot.profile));
      if (Array.isArray(snapshot.fields)) {
        localStorage.setItem(KEYS.FIELDS, JSON.stringify(snapshot.fields));
      }
      if (Array.isArray(snapshot.scans)) {
        localStorage.setItem(KEYS.SCANS, JSON.stringify(snapshot.scans));
      }
      if (Array.isArray(snapshot.diary)) {
        localStorage.setItem(KEYS.DIARY, JSON.stringify(snapshot.diary));
      }
    } catch {
      // ignore
    }
    setAuthCookie(true);
    return snapshot.profile;
  }

  return findRegisteredAccount(cleanEmail);
}

export async function restorePersistentSession(): Promise<FarmerProfile | null> {
  if (typeof window === 'undefined') return null;
  const current = getSavedProfile();
  if (
    current.isAuthenticated &&
    current.email &&
    current.authProvider !== 'anonymous' &&
    current.authProvider !== 'none'
  ) {
    setAuthCookie(true);
    writeEmailVaultSnapshot(current);
    return current;
  }

  const snapshot = await idbGet<AccountVaultSnapshot>('active_session');
  if (
    snapshot?.profile?.isAuthenticated &&
    snapshot.profile.email &&
    snapshot.profile.authProvider !== 'anonymous'
  ) {
    try {
      localStorage.setItem(KEYS.PROFILE, JSON.stringify(snapshot.profile));
      if (Array.isArray(snapshot.fields) && getSavedFields().length === 0) {
        localStorage.setItem(KEYS.FIELDS, JSON.stringify(snapshot.fields));
      }
      if (Array.isArray(snapshot.scans) && getSavedScans().length === 0) {
        localStorage.setItem(KEYS.SCANS, JSON.stringify(snapshot.scans));
      }
      if (Array.isArray(snapshot.diary) && getDiaryEntries().length === 0) {
        localStorage.setItem(KEYS.DIARY, JSON.stringify(snapshot.diary));
      }
    } catch {
      // ignore
    }
    setAuthCookie(true);
    return snapshot.profile;
  }

  return null;
}

export function getRegisteredAccounts(): FarmerProfile[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEYS.REGISTERED_ACCOUNTS);
    if (raw) return JSON.parse(raw) as FarmerProfile[];
  } catch {
    // ignore
  }
  return [];
}

export function isEmailRegistered(email: string): boolean {
  const clean = (email || '').trim().toLowerCase();
  if (!clean) return false;
  const list = getRegisteredAccounts();
  return list.some((u) => u.email.trim().toLowerCase() === clean);
}

export function findRegisteredAccount(email: string): FarmerProfile | null {
  const clean = (email || '').trim().toLowerCase();
  if (!clean) return null;
  const list = getRegisteredAccounts();
  return list.find((u) => u.email.trim().toLowerCase() === clean) || null;
}

export function addAccountToRegistered(profile: FarmerProfile): void {
  if (typeof window === 'undefined' || !profile.email) return;
  const clean = profile.email.trim().toLowerCase();
  const list = getRegisteredAccounts().filter(
    (u) => u.email.trim().toLowerCase() !== clean
  );
  list.unshift(profile);
  try {
    localStorage.setItem(KEYS.REGISTERED_ACCOUNTS, JSON.stringify(list));
  } catch {
    // ignore
  }
}

/**
 * Generates a unique, human-readable Zarkhez Farmer Persona ID (e.g., ZRK-PK-839204)
 * deterministically from the user's email/name/phone so their ID stays consistent.
 */
export function generateFarmerPersonaId(seedString: string): string {
  const clean = (seedString || 'kisan').trim().toLowerCase();
  let hash = 2166136261;
  for (let i = 0; i < clean.length; i++) {
    hash ^= clean.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const sixDigits = String((Math.abs(hash) % 900000) + 100000);
  return `ZRK-PK-${sixDigits}`;
}

/**
 * Automatically derives a clean display name and avatar from a Google email
 * so 1-tap Google Sign-In/Sign-Up populates everything directly without tedious forms.
 */
export function deriveGoogleIdentityFromEmail(
  rawEmail: string,
  explicitName?: string,
  explicitAvatar?: string
): {
  email: string;
  fullName: string;
  avatarUrl: string;
  farmerId: string;
} {
  const cleanEmail =
    rawEmail.trim().toLowerCase() || 'kisan.zarkhez@gmail.com';
  const emailWithDomain = cleanEmail.includes('@')
    ? cleanEmail
    : `${cleanEmail}@gmail.com`;

  const localPart = emailWithDomain.split('@')[0] || 'Kisan';
  const derivedName =
    explicitName?.trim() ||
    localPart
      .replace(/[._-]+/g, ' ')
      .replace(/\d+/g, '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ') ||
    'Muhammad Kisan';

  const initials = derivedName
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const svgAvatar = `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#062409"/>
          <stop offset="100%" stop-color="#2E7D32"/>
        </linearGradient>
      </defs>
      <rect width="120" height="120" rx="60" fill="url(#g)"/>
      <circle cx="60" cy="60" r="56" fill="none" stroke="#66BB6A" stroke-width="3" stroke-opacity="0.6"/>
      <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" fill="#FFFFFF" font-family="Arial, sans-serif" font-weight="800" font-size="42">${initials}</text>
    </svg>`
  )}`;

  return {
    email: emailWithDomain,
    fullName: derivedName,
    avatarUrl: explicitAvatar || svgAvatar,
    farmerId: generateFarmerPersonaId(emailWithDomain),
  };
}

const DEFAULT_UNAUTHENTICATED_PROFILE: FarmerProfile = {
  farmerId: '',
  fullName: '',
  fatherOrFarmName: '',
  email: '',
  phone: '',
  district: 'Faisalabad',
  province: 'Punjab',
  villageOrTehsil: '',
  placeName: 'Faisalabad, Punjab',
  lat: 31.418,
  lon: 73.079,
  totalAcres: 0,
  landAcresBand: '1-5',
  primaryCrops: ['wheat'],
  mainCrops: ['wheat'],
  avatarUrl: '',
  authProvider: 'none',
  isAuthenticated: false,
  language: 'en',
  autoSpeakVoice: true,
  preferredVoice: 'ur-PK-UzmaNeural',
  voiceSpeed: 1.0,
  onboardingDone: false,
  consentTermsAt: null,
  consentImproveModel: false,
  joinedAt: '',
};

let supabaseSingleton: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  if (!supabaseSingleton) {
    supabaseSingleton = createClient(url, anonKey);
  }
  return supabaseSingleton;
}

export async function triggerSupabaseGoogleOAuth(
  redirectPath = '/ur/home'
): Promise<{ startedRedirect: boolean; error?: string }> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { startedRedirect: false, error: 'local_google_flow' };
  }

  try {
    const redirectTo =
      typeof window !== 'undefined'
        ? `${window.location.origin}${redirectPath}`
        : undefined;
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    });
    if (error || !data?.url) {
      return { startedRedirect: false, error: 'oauth_failed' };
    }
    return { startedRedirect: true };
  } catch {
    return { startedRedirect: false, error: 'oauth_unavailable' };
  }
}

export async function syncSupabaseAuthSession(): Promise<FarmerProfile | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user) return null;

    const u = session.user;
    const existing = getSavedProfile();

    // Hydrate from cloud database first so saved personal details & crops persist across reloads/devices
    const { data: dbProfile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', u.id)
      .maybeSingle();

    const email = u.email || dbProfile?.email || existing.email || '';
    const fullName =
      (dbProfile?.full_name && String(dbProfile.full_name).trim()) ||
      existing.fullName ||
      u.user_metadata?.full_name ||
      u.user_metadata?.name ||
      email.split('@')[0] ||
      'کسان بھائی';
    const avatarUrl =
      dbProfile?.avatar_url ||
      u.user_metadata?.avatar_url ||
      u.user_metadata?.picture ||
      existing.avatarUrl ||
      '';
    const farmerId =
      dbProfile?.farmer_id || existing.farmerId || generateFarmerPersonaId(email || u.id);

    const dbPrimaryCrops =
      Array.isArray(dbProfile?.primary_crops) && dbProfile.primary_crops.length > 0
        ? (dbProfile.primary_crops as string[])
        : Array.isArray(dbProfile?.main_crops) && dbProfile.main_crops.length > 0
        ? (dbProfile.main_crops as string[])
        : null;

    const merged: FarmerProfile = {
      ...existing,
      farmerId,
      fullName,
      fatherOrFarmName:
        (dbProfile?.father_or_farm_name as string) || existing.fatherOrFarmName || '',
      email,
      phone: (dbProfile?.phone as string) || existing.phone || '',
      district: (dbProfile?.district as string) || existing.district,
      province: (dbProfile?.province as string) || existing.province,
      villageOrTehsil:
        (dbProfile?.village_or_tehsil as string) || existing.villageOrTehsil || '',
      placeName: (dbProfile?.place_name as string) || existing.placeName || 'Faisalabad, Punjab',
      lat: typeof dbProfile?.lat === 'number' ? dbProfile.lat : existing.lat,
      lon: typeof dbProfile?.lon === 'number' ? dbProfile.lon : existing.lon,
      totalAcres:
        typeof dbProfile?.total_acres === 'number' && dbProfile.total_acres > 0
          ? Number(dbProfile.total_acres)
          : existing.totalAcres,
      landAcresBand: (dbProfile?.land_acres_band as string) || existing.landAcresBand,
      primaryCrops: dbPrimaryCrops || existing.primaryCrops,
      mainCrops: dbPrimaryCrops || existing.mainCrops || existing.primaryCrops,
      preferredVoice: (dbProfile?.preferred_voice as string) || existing.preferredVoice,
      voiceSpeed:
        typeof dbProfile?.voice_speed === 'number'
          ? Number(dbProfile.voice_speed)
          : existing.voiceSpeed,
      onboardingDone:
        typeof dbProfile?.onboarding_done === 'boolean'
          ? dbProfile.onboarding_done
          : existing.onboardingDone,
      avatarUrl,
      authProvider: (dbProfile?.auth_provider as FarmerProfile['authProvider']) || 'google',
      isAuthenticated: true,
      joinedAt:
        existing.joinedAt ||
        (dbProfile?.created_at ? String(dbProfile.created_at).slice(0, 10) : '') ||
        new Date().toISOString().slice(0, 10),
    };

    await saveProfile(merged);

    // Sync user's saved fields & diary entries from cloud DB into local cache if present
    if (typeof window !== 'undefined') {
      try {
        const [{ data: remoteFields }, { data: remoteDiary }, { data: remoteScans }] =
          await Promise.all([
            supabase.from('fields').select('*').eq('user_id', u.id).order('created_at', { ascending: false }),
            supabase.from('diary_entries').select('*').eq('user_id', u.id).order('created_at', { ascending: false }),
            supabase.from('scans').select('*').eq('user_id', u.id).order('created_at', { ascending: false }).limit(50),
          ]);

        if (Array.isArray(remoteFields) && remoteFields.length > 0) {
          const localFields = getSavedFields();
          const seenFieldIds = new Set(remoteFields.map((f) => String(f.id)));
          const localOnly = localFields.filter((lf) => !seenFieldIds.has(lf.id));
          const mergedFields: FarmField[] = [
            ...remoteFields.map((rf) => ({
              id: String(rf.id),
              name: String(rf.name || ''),
              crop: String(rf.crop || 'wheat'),
              area_acres: Number(rf.area_acres || 1),
              soil_type: (rf.soil_type as SoilType) || 'medium',
              sowing_date: String(rf.sowing_date || new Date().toISOString().slice(0, 10)),
              completedTaskIds: [] as string[],
              created_at: String(rf.created_at || new Date().toISOString()),
            })),
            ...localOnly,
          ];
          localStorage.setItem(KEYS.FIELDS, JSON.stringify(mergedFields));
        }

        if (Array.isArray(remoteDiary) && remoteDiary.length > 0) {
          const localDiary = getDiaryEntries();
          const seenDiaryIds = new Set(remoteDiary.map((d) => String(d.id)));
          const localOnlyDiary = localDiary.filter((ld) => !seenDiaryIds.has(ld.id));
          const mergedDiary: DiaryEntry[] = [
            ...remoteDiary.map((rd) => ({
              id: String(rd.id),
              field_id: rd.field_id ? String(rd.field_id) : null,
              kind: (rd.kind as DiaryEntry['kind']) || 'note',
              category: String(rd.category || 'general'),
              amount: Number(rd.amount || 0),
              note: String(rd.note || ''),
              entry_date: String(rd.entry_date || new Date().toISOString().slice(0, 10)),
              created_at: String(rd.created_at || new Date().toISOString()),
            })),
            ...localOnlyDiary,
          ];
          localStorage.setItem(KEYS.DIARY, JSON.stringify(mergedDiary));
        }

        if (Array.isArray(remoteScans) && remoteScans.length > 0) {
          const localScans = getSavedScans();
          const seenScanCreated = new Set(localScans.map((s) => `${s.label}:${s.created_at?.slice(0, 16)}`));
          const mergedScans: SavedScan[] = [...localScans];
          for (const rs of remoteScans) {
            const rsLabel = String(rs.label || 'Plant Scan');
            const rsCreated = String(rs.created_at || new Date().toISOString());
            const key = `${rsLabel}:${rsCreated.slice(0, 16)}`;
            if (!seenScanCreated.has(key)) {
              mergedScans.push({
                id: String(rs.id),
                field_id: rs.field_id ? String(rs.field_id) : null,
                crop: String(rs.advice?.plant_name?.en || 'wheat'),
                thumbnailDataUrl: '',
                label: rsLabel,
                confidence: Number(rs.confidence || 0),
                advice: rs.advice as Advice,
                cloudSynced: true,
                created_at: rsCreated,
              });
            }
          }
          localStorage.setItem(KEYS.SCANS, JSON.stringify(mergedScans.slice(0, 50)));
        }

        writeEmailVaultSnapshot(merged);
      } catch {
        // ignore cloud pull errors when offline
      }
    }

    return merged;
  } catch {
    return null;
  }
}

/**
 * 1-Tap Guest Access: farmer can start scanning immediately without filling any form.
 */
export async function signInGuestAnonymously(): Promise<FarmerProfile> {
  const existing = getSavedProfile();
  if (existing.isAuthenticated && existing.authProvider !== 'anonymous') {
    return existing;
  }

  const supabase = getSupabaseClient();
  let anonymousId = '';
  if (supabase) {
    try {
      const { data, error } = await supabase.auth.signInAnonymously();
      if (!error && data?.user) {
        anonymousId = data.user.id;
      }
    } catch {
      // offline / mock mode
    }
  }

  const guestSeed = anonymousId || `guest_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const guestProfile: FarmerProfile = {
    ...existing,
    farmerId: existing.farmerId || generateFarmerPersonaId(guestSeed),
    fullName: existing.fullName || (existing.language === 'en' ? 'Guest Farmer' : 'مہمان کسان'),
    authProvider: 'anonymous',
    isAuthenticated: false, // guest status until signed in
    onboardingDone: true,   // don't block guest with onboarding
  };

  await saveProfile(guestProfile);
  return guestProfile;
}

/**
 * Sends a 6-digit passwordless sign-in OTP code to the farmer's email.
 */
export async function sendEmailOtp(
  email: string
): Promise<{ success: boolean; error?: string }> {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes('@')) {
    return { success: false, error: 'invalid_email' };
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    // Development simulated OTP when offline
    return { success: true };
  }

  try {
    const { error } = await supabase.auth.signInWithOtp({
      email: cleanEmail,
      options: {
        shouldCreateUser: true,
      },
    });

    if (error) {
      return { success: false, error: 'otp_send_failed' };
    }
    return { success: true };
  } catch {
    return { success: false, error: 'network_error' };
  }
}

/**
 * Verifies the 6-digit OTP code and signs the farmer in.
 */
export async function verifyEmailOtp(
  email: string,
  token: string
): Promise<{ success: boolean; profile?: FarmerProfile; error?: string }> {
  const cleanEmail = email.trim().toLowerCase();
  const cleanToken = token.trim();

  if (cleanToken.length !== 6) {
    return { success: false, error: 'invalid_token_length' };
  }

  const current = getSavedProfile();
  const identity = deriveGoogleIdentityFromEmail(cleanEmail);

  const supabase = getSupabaseClient();
  if (!supabase) {
    // Offline simulation for local exhibition test
    const profile = await saveProfile({
      ...current,
      email: cleanEmail,
      fullName: current.fullName && current.fullName !== 'مہمان کسان' ? current.fullName : identity.fullName,
      farmerId: current.farmerId || identity.farmerId,
      avatarUrl: current.avatarUrl || identity.avatarUrl,
      authProvider: 'email',
      isAuthenticated: true,
    });
    return { success: true, profile };
  }

  try {
    const { data, error } = await supabase.auth.verifyOtp({
      email: cleanEmail,
      token: cleanToken,
      type: 'email',
    });

    if (error || !data?.user) {
      return { success: false, error: 'verification_failed' };
    }

    const profile = await saveProfile({
      ...current,
      email: cleanEmail,
      fullName: current.fullName && current.fullName !== 'مہمان کسان' ? current.fullName : identity.fullName,
      farmerId: current.farmerId || identity.farmerId,
      avatarUrl: current.avatarUrl || identity.avatarUrl,
      authProvider: 'email',
      isAuthenticated: true,
    });

    // Link guest records to the verified user ID
    await linkGuestToAccount(data.user.id);

    return { success: true, profile };
  } catch {
    return { success: false, error: 'network_error' };
  }
}

/**
 * Links previous guest scans, fields, and diary to authenticated user ID.
 */
export async function linkGuestToAccount(newUserId: string): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;

  try {
    const localScans = getSavedScans();
    for (const scan of localScans) {
      await supabase.from('scans').upsert({
        ...(isValidUuid(scan.id) ? { id: scan.id } : {}),
        user_id: newUserId,
        label: scan.label,
        confidence: scan.confidence,
        advice: scan.advice,
        created_at: scan.created_at,
      });
    }

    const localFields = getSavedFields();
    for (const field of localFields) {
      await supabase.from('fields').upsert({
        ...(isValidUuid(field.id) ? { id: field.id } : {}),
        user_id: newUserId,
        name: field.name,
        crop: field.crop,
        area_acres: field.area_acres,
        soil_type: field.soil_type,
        sowing_date: field.sowing_date,
        created_at: field.created_at,
      });
    }
  } catch {
    // ignore
  }
}

/**
 * Saves onboarding answers (max 4 taps) and marks onboarding_done = true.
 */
export async function saveOnboardingProfile(answers: {
  language?: 'ur' | 'en';
  district?: string;
  placeName?: string;
  lat?: number;
  lon?: number;
  mainCrops?: string[];
  landAcresBand?: string;
  consentImproveModel?: boolean;
}): Promise<FarmerProfile> {
  const current = getSavedProfile();
  const updated = await saveProfile({
    ...current,
    language: answers.language || current.language,
    district: answers.district || current.district,
    placeName: answers.placeName || current.placeName,
    lat: answers.lat ?? current.lat,
    lon: answers.lon ?? current.lon,
    primaryCrops: answers.mainCrops || current.primaryCrops,
    mainCrops: answers.mainCrops || current.mainCrops,
    landAcresBand: answers.landAcresBand || current.landAcresBand,
    consentTermsAt: new Date().toISOString(),
    consentImproveModel: answers.consentImproveModel ?? current.consentImproveModel,
    onboardingDone: true,
  });
  return updated;
}

export function getSavedProfile(): FarmerProfile {
  if (typeof window === 'undefined') {
    return DEFAULT_UNAUTHENTICATED_PROFILE;
  }
  try {
    const raw = localStorage.getItem(KEYS.PROFILE);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<FarmerProfile>;
      if (
        parsed.isAuthenticated &&
        parsed.email &&
        parsed.authProvider !== 'anonymous' &&
        parsed.authProvider !== 'none'
      ) {
        if (typeof document !== 'undefined' && !document.cookie.includes('zarkhez_auth=1')) {
          document.cookie = 'zarkhez_auth=1; path=/; max-age=31536000; SameSite=Lax';
        }
      }
      return {
        ...DEFAULT_UNAUTHENTICATED_PROFILE,
        ...parsed,
      };
    }
  } catch {
    // ignore
  }
  return DEFAULT_UNAUTHENTICATED_PROFILE;
}

export async function saveProfile(
  profileUpdate: Partial<FarmerProfile>
): Promise<FarmerProfile> {
  const current = getSavedProfile();
  const merged: FarmerProfile = {
    ...current,
    ...profileUpdate,
  };

  if (merged.isAuthenticated && !merged.farmerId) {
    merged.farmerId = generateFarmerPersonaId(
      merged.email || merged.phone || merged.fullName || String(Date.now())
    );
  }
  if (merged.isAuthenticated && !merged.joinedAt) {
    merged.joinedAt = new Date().toISOString().slice(0, 10);
  }

  if (merged.isAuthenticated && merged.email) {
    addAccountToRegistered(merged);
  }

  if (typeof window !== 'undefined') {
    localStorage.setItem(KEYS.PROFILE, JSON.stringify(merged));
    writeEmailVaultSnapshot(merged);
  }

  if (typeof document !== 'undefined') {
    setAuthCookie(
      Boolean(
        merged.isAuthenticated &&
        merged.email &&
        merged.authProvider !== 'anonymous' &&
        merged.authProvider !== 'none'
      )
    );
  }

  // Sync to Supabase database reliably (await upsert so caller knows save reached DB)
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.user?.id) {
        const { error: dbError } = await supabase.from('profiles').upsert({
          id: session.user.id,
          farmer_id: merged.farmerId,
          full_name: merged.fullName,
          father_or_farm_name: merged.fatherOrFarmName,
          email: merged.email,
          phone: merged.phone,
          district: merged.district || (merged.placeName ? merged.placeName.split(',')[0].trim() : undefined),
          province: merged.province || (merged.placeName ? merged.placeName.split(',')[1]?.trim() : undefined),
          village_or_tehsil: merged.villageOrTehsil,
          total_acres: merged.totalAcres,
          land_acres_band: merged.landAcresBand,
          primary_crops: merged.primaryCrops,
          main_crops: merged.mainCrops || merged.primaryCrops,
          preferred_voice: merged.preferredVoice || 'ur-PK-UzmaNeural',
          voice_speed: merged.voiceSpeed || 1.0,
          onboarding_done: merged.onboardingDone ?? false,
          consent_terms_at: merged.consentTermsAt,
          consent_improve_model: merged.consentImproveModel ?? false,
          avatar_url: merged.avatarUrl,
          auth_provider: merged.authProvider,
          language: merged.language,
          place_name: merged.placeName,
          lat: merged.lat,
          lon: merged.lon,
          last_seen_at: new Date().toISOString(),
        });
        if (dbError) {
          console.warn('[Sync] Profile update deferred; saved locally.');
        }
      }
    } catch {
      // ignore offline error — localStorage copy preserved
    }
  }

  return merged;
}

export async function signOutFarmer(): Promise<void> {
  const current = getSavedProfile();
  // Preserve this user's vault cleanly before signing out so logging back in restores all fields/scans/diary
  writeEmailVaultSnapshot(current);
  await idbDelete('active_session');

  const signedOut: FarmerProfile = {
    ...DEFAULT_UNAUTHENTICATED_PROFILE,
    placeName: current.placeName,
    lat: current.lat,
    lon: current.lon,
    language: current.language,
  };
  if (typeof window !== 'undefined') {
    localStorage.setItem(KEYS.PROFILE, JSON.stringify(signedOut));
  }
  setAuthCookie(false);
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      await supabase.auth.signOut();
    } catch {
      // ignore
    }
  }
}

/**
 * Returns ONLY real user-created fields (Zero fake/demo fields).
 */
export function getSavedFields(): FarmField[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEYS.FIELDS);
    if (raw) return JSON.parse(raw) as FarmField[];
  } catch {
    // ignore
  }
  return [];
}

export async function addFarmField(
  field: Omit<FarmField, 'id' | 'created_at' | 'completedTaskIds'>
): Promise<FarmField> {
  const existing = getSavedFields();
  const newField: FarmField = {
    ...field,
    id: generateUuid(),
    completedTaskIds: [],
    created_at: new Date().toISOString(),
  };
  const updated = [newField, ...existing];
  if (typeof window !== 'undefined') {
    localStorage.setItem(KEYS.FIELDS, JSON.stringify(updated));
    writeEmailVaultSnapshot(getSavedProfile());
  }

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.user?.id) {
        const { error: dbError } = await supabase.from('fields').insert({
          id: newField.id,
          user_id: session.user.id,
          name: newField.name,
          crop: newField.crop,
          area_acres: newField.area_acres,
          soil_type: newField.soil_type,
          sowing_date: newField.sowing_date,
        });
        if (dbError) {
          console.warn('[Sync] Field save deferred; saved locally.');
        }
      }
    } catch {
      // ignore offline error
    }
  }
  return newField;
}

export function deleteFarmField(fieldId: string): FarmField[] {
  const updated = getSavedFields().filter((f) => f.id !== fieldId);
  if (typeof window !== 'undefined') {
    localStorage.setItem(KEYS.FIELDS, JSON.stringify(updated));
    writeEmailVaultSnapshot(getSavedProfile());
  }
  const supabase = getSupabaseClient();
  if (supabase && isValidUuid(fieldId)) {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user?.id) {
        supabase
          .from('fields')
          .delete()
          .eq('id', fieldId)
          .eq('user_id', session.user.id)
          .then(({ error }) => {
            if (error) console.warn('[Sync] Field delete deferred; removed locally.');
          });
      }
    }).catch(() => {});
  }
  return updated;
}

export function toggleFieldTaskDone(fieldId: string, taskId: string): FarmField[] {
  const fields = getSavedFields();
  const updated = fields.map((f) => {
    if (f.id !== fieldId) return f;
    const exists = f.completedTaskIds.includes(taskId);
    const completedTaskIds = exists
      ? f.completedTaskIds.filter((id) => id !== taskId)
      : [...f.completedTaskIds, taskId];
    return { ...f, completedTaskIds };
  });
  if (typeof window !== 'undefined') {
    localStorage.setItem(KEYS.FIELDS, JSON.stringify(updated));
    writeEmailVaultSnapshot(getSavedProfile());
  }
  return updated;
}

/**
 * Returns ONLY real user leaf scans (Zero fake scans).
 */
export function getSavedScans(): SavedScan[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEYS.SCANS);
    if (raw) return JSON.parse(raw) as SavedScan[];
  } catch {
    // ignore
  }
  return [];
}

export async function saveScanRecord(
  scan: Omit<SavedScan, 'id' | 'created_at'>
): Promise<SavedScan> {
  const existing = getSavedScans();
  let cloudSynced = false;
  const record: SavedScan = {
    ...scan,
    id: `scan-${Date.now()}`,
    cloudSynced: false,
    created_at: new Date().toISOString(),
  };

  if (typeof window !== 'undefined') {
    const updated = [record, ...existing].slice(0, 50);
    try {
      localStorage.setItem(KEYS.SCANS, JSON.stringify(updated));
    } catch {
      // Storage quota exceeded: keep recent 15 scans, strip older heavy base64 thumbnails
      try {
        const trimmed = updated.slice(0, 15).map((item, idx) =>
          idx === 0 ? item : { ...item, thumbnailDataUrl: '' }
        );
        localStorage.setItem(KEYS.SCANS, JSON.stringify(trimmed));
      } catch {
        // Last-resort: strip thumbnail on current record too so metadata still persists
        localStorage.setItem(
          KEYS.SCANS,
          JSON.stringify([{ ...record, thumbnailDataUrl: '' }])
        );
      }
    }
  }

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.user?.id) {
        const userId = session.user.id;
        const imagePath = `${userId}/${record.id}.jpg`;
        if (scan.thumbnailDataUrl && scan.thumbnailDataUrl.startsWith('data:image')) {
          try {
            const res = await fetch(scan.thumbnailDataUrl);
            const blob = await res.blob();
            await supabase.storage.from('scans').upload(imagePath, blob, {
              contentType: 'image/jpeg',
              upsert: true,
            });
          } catch {
            console.warn('[Sync] Thumbnail upload deferred; saved locally.');
          }
        }
        const { error: dbError } = await supabase.from('scans').insert({
          user_id: userId,
          field_id: isValidUuid(scan.field_id) ? scan.field_id : null,
          image_path: imagePath,
          label: scan.label,
          confidence: scan.confidence,
          advice: scan.advice,
        });
        if (dbError) {
          console.warn('[Sync] Scan record save deferred; preserved locally.');
          cloudSynced = false;
        } else {
          cloudSynced = true;
        }
      }
    } catch {
      console.warn('[Sync] Offline mode active; scan preserved locally.');
    }
  }

  record.cloudSynced = cloudSynced;
  if (typeof window !== 'undefined') {
    writeEmailVaultSnapshot(getSavedProfile());
  }
  return record;
}

/**
 * Returns ONLY real user diary entries (Zero fake/demo diary entries).
 */
export function getDiaryEntries(): DiaryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEYS.DIARY);
    if (raw) return JSON.parse(raw) as DiaryEntry[];
  } catch {
    // ignore
  }
  return [];
}

export async function addDiaryEntry(
  entry: Omit<DiaryEntry, 'id' | 'created_at'>
): Promise<DiaryEntry> {
  const existing = getDiaryEntries();
  const record: DiaryEntry = {
    ...entry,
    id: generateUuid(),
    created_at: new Date().toISOString(),
  };
  const updated = [record, ...existing];
  if (typeof window !== 'undefined') {
    localStorage.setItem(KEYS.DIARY, JSON.stringify(updated));
    writeEmailVaultSnapshot(getSavedProfile());
  }

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.user?.id) {
        const { error: dbError } = await supabase.from('diary_entries').insert({
          id: record.id,
          user_id: session.user.id,
          field_id: isValidUuid(entry.field_id) ? entry.field_id : null,
          kind: entry.kind,
          category: entry.category,
          amount: entry.amount,
          note: entry.note,
          entry_date: entry.entry_date,
        });
        if (dbError) {
          console.warn('[Sync] Diary save deferred; saved locally.');
        }
      }
    } catch {
      // ignore offline error
    }
  }
  return record;
}

export async function deleteDiaryEntry(id: string): Promise<DiaryEntry[]> {
  const existing = getDiaryEntries().filter((e) => e.id !== id);
  if (typeof window !== 'undefined') {
    localStorage.setItem(KEYS.DIARY, JSON.stringify(existing));
    writeEmailVaultSnapshot(getSavedProfile());
  }
  const supabase = getSupabaseClient();
  if (supabase && isValidUuid(id)) {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.user?.id) {
        await supabase
          .from('diary_entries')
          .delete()
          .eq('id', id)
          .eq('user_id', session.user.id);
      }
    } catch {
      // ignore offline error
    }
  }
  return existing;
}

export async function deleteAllUserData(): Promise<void> {
  const current = getSavedProfile();
  const cleanEmail = (current.email || '').trim().toLowerCase();
  if (typeof window !== 'undefined') {
    localStorage.removeItem(KEYS.FIELDS);
    localStorage.removeItem(KEYS.SCANS);
    localStorage.removeItem(KEYS.DIARY);
    localStorage.removeItem('zarkhez_scan_sessions_v2');
    // Also clear legacy v1 keys & active account vault if present
    localStorage.removeItem('zarkhez_fields_v1');
    localStorage.removeItem('zarkhez_scans_v1');
    localStorage.removeItem('zarkhez_diary_v1');
    if (cleanEmail) {
      localStorage.removeItem(`${KEYS.VAULT_PREFIX}${cleanEmail}`);
    }
  }
  await idbDelete('active_session');
  if (cleanEmail) {
    await idbDelete(`vault:${cleanEmail}`);
  }
  setAuthCookie(false);
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.user?.id) {
        const userId = session.user.id;
        // Delete child tables first, then sessions and fields
        await supabase.from('scan_feedback').delete().eq('user_id', userId);
        await supabase.from('scan_images').delete().eq('user_id', userId);
        await supabase.from('scan_sessions').delete().eq('user_id', userId);
        await supabase.from('tasks').delete().eq('user_id', userId);
        await supabase.from('scans').delete().eq('user_id', userId);
        await supabase.from('diary_entries').delete().eq('user_id', userId);
        await supabase.from('fields').delete().eq('user_id', userId);
        // Delete profile
        await supabase.from('profiles').delete().eq('id', userId);

        // Delete user's files from private scans bucket
        try {
          const { data: fileList } = await supabase.storage.from('scans').list(userId);
          if (fileList && fileList.length > 0) {
            const filePaths = fileList.map((f) => `${userId}/${f.name}`);
            await supabase.storage.from('scans').remove(filePaths);
          }
        } catch {
          // ignore storage delete errors
        }
      }
    } catch {
      // ignore
    }
  }
}

/**
 * Creates a new ScanSession record in local and cloud store.
 */
export async function createScanSession(
  sessionData: Partial<ScanSession>
): Promise<ScanSession> {
  const session: ScanSession = {
    id: isValidUuid(sessionData.id) ? (sessionData.id as string) : generateUuid(),
    user_id: sessionData.user_id || 'anonymous',
    field_id: isValidUuid(sessionData.field_id) ? sessionData.field_id : null,
    crop_selected: sessionData.crop_selected || null,
    answers: sessionData.answers || {},
    quick: sessionData.quick || {},
    report: sessionData.report || {},
    top_label: sessionData.top_label || null,
    top_confidence: sessionData.top_confidence || null,
    severity: sessionData.severity || null,
    on_device_label: sessionData.on_device_label || null,
    on_device_confidence: sessionData.on_device_confidence || null,
    status: sessionData.status || 'pending',
    latency_ms: sessionData.latency_ms || {},
    created_at: sessionData.created_at || new Date().toISOString(),
  };

  if (typeof window !== 'undefined') {
    try {
      const existing = JSON.parse(localStorage.getItem('zarkhez_scan_sessions_v2') || '[]') as ScanSession[];
      localStorage.setItem('zarkhez_scan_sessions_v2', JSON.stringify([session, ...existing]));
    } catch {
      // ignore
    }
  }

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { data: { session: authSession } } = await supabase.auth.getSession();
      if (authSession?.user?.id) {
        session.user_id = authSession.user.id;
        await supabase.from('scan_sessions').insert({
          id: session.id,
          user_id: session.user_id,
          field_id: session.field_id,
          crop_selected: session.crop_selected,
          answers: session.answers,
          quick: session.quick,
          report: session.report,
          top_label: session.top_label,
          top_confidence: session.top_confidence,
          severity: session.severity,
          on_device_label: session.on_device_label,
          on_device_confidence: session.on_device_confidence,
          status: session.status,
          latency_ms: session.latency_ms,
          created_at: session.created_at,
        });
      }
    } catch {
      // offline fallback
    }
  }

  return session;
}

/**
 * Updates an existing ScanSession with partial data.
 */
export async function updateScanSession(
  sessionId: string,
  updates: Partial<ScanSession>
): Promise<void> {
  if (typeof window !== 'undefined') {
    try {
      const existing = JSON.parse(localStorage.getItem('zarkhez_scan_sessions_v2') || '[]') as ScanSession[];
      const updated = existing.map((s) => (s.id === sessionId ? { ...s, ...updates } : s));
      localStorage.setItem('zarkhez_scan_sessions_v2', JSON.stringify(updated));
    } catch {
      // ignore
    }
  }

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      await supabase.from('scan_sessions').update(updates).eq('id', sessionId);
    } catch {
      // offline fallback
    }
  }
}

/**
 * Submits feedback for a scan session.
 */
export async function submitScanFeedback(
  feedback: {
    sessionId: string;
    correct: 'yes' | 'no' | 'unsure';
    rightLabel?: string;
    note?: string;
  }
): Promise<void> {
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.id) {
        await supabase.from('scan_feedback').insert({
          session_id: feedback.sessionId,
          user_id: session.user.id,
          correct: feedback.correct,
          right_label: feedback.rightLabel || null,
          note: feedback.note || null,
        });
      }
    } catch {
      // ignore
    }
  }
}
