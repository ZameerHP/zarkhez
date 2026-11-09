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
  villageOrTehsil: string;
  placeName: string;
  lat: number;
  lon: number;
  totalAcres: number;
  primaryCrops: string[];
  avatarUrl: string;
  authProvider: 'google' | 'none';
  isAuthenticated: boolean;
  language: 'ur' | 'en';
  autoSpeakVoice: boolean;
  joinedAt: string;
}

export type FarmProfile = FarmerProfile;

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
  thumbnailDataUrl: string;
  label: string;
  confidence: number;
  advice: Advice;
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
};

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
  const sixDigits = String(Math.abs(hash) % 900000 + 100000);
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
  villageOrTehsil: '',
  placeName: 'Multan, Punjab',
  lat: 30.1575,
  lon: 71.5249,
  totalAcres: 0,
  primaryCrops: ['wheat'],
  avatarUrl: '',
  authProvider: 'none',
  isAuthenticated: false,
  language: 'ur',
  autoSpeakVoice: true,
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
      return { startedRedirect: false, error: error?.message || 'oauth_failed' };
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
    const email = u.email || existing.email || '';
    const fullName =
      u.user_metadata?.full_name ||
      u.user_metadata?.name ||
      existing.fullName ||
      email.split('@')[0] ||
      'کسان بھائی';
    const avatarUrl =
      u.user_metadata?.avatar_url ||
      u.user_metadata?.picture ||
      existing.avatarUrl ||
      '';
    const farmerId =
      existing.farmerId || generateFarmerPersonaId(email || u.id);

    const merged: FarmerProfile = {
      ...existing,
      farmerId,
      fullName,
      email,
      avatarUrl,
      authProvider: 'google',
      isAuthenticated: true,
      joinedAt: existing.joinedAt || new Date().toISOString().slice(0, 10),
    };
    await saveProfile(merged);
    return merged;
  } catch {
    return null;
  }
}

export function getSavedProfile(): FarmerProfile {
  if (typeof window === 'undefined') {
    return DEFAULT_UNAUTHENTICATED_PROFILE;
  }
  try {
    const raw = localStorage.getItem(KEYS.PROFILE);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<FarmerProfile>;
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

  if (typeof window !== 'undefined') {
    localStorage.setItem(KEYS.PROFILE, JSON.stringify(merged));
  }

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.user?.id) {
        await supabase.from('profiles').upsert({
          id: session.user.id,
          farmer_id: merged.farmerId,
          full_name: merged.fullName,
          father_or_farm_name: merged.fatherOrFarmName,
          email: merged.email,
          phone: merged.phone,
          village_or_tehsil: merged.villageOrTehsil,
          total_acres: merged.totalAcres,
          primary_crops: merged.primaryCrops,
          avatar_url: merged.avatarUrl,
          auth_provider: merged.authProvider,
          language: merged.language,
          place_name: merged.placeName,
          lat: merged.lat,
          lon: merged.lon,
        });
      }
    } catch {
      // ignore offline error
    }
  }

  return merged;
}

export async function signOutFarmer(): Promise<void> {
  const current = getSavedProfile();
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
    id: `field-${Date.now()}`,
    completedTaskIds: [],
    created_at: new Date().toISOString(),
  };
  const updated = [newField, ...existing];
  if (typeof window !== 'undefined') {
    localStorage.setItem(KEYS.FIELDS, JSON.stringify(updated));
  }

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.user?.id) {
        await supabase.from('fields').insert({
          user_id: session.user.id,
          name: newField.name,
          crop: newField.crop,
          area_acres: newField.area_acres,
          soil_type: newField.soil_type,
          sowing_date: newField.sowing_date,
        });
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
  const record: SavedScan = {
    ...scan,
    id: `scan-${Date.now()}`,
    created_at: new Date().toISOString(),
  };
  const updated = [record, ...existing].slice(0, 50);
  if (typeof window !== 'undefined') {
    localStorage.setItem(KEYS.SCANS, JSON.stringify(updated));
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
        if (scan.thumbnailDataUrl.startsWith('data:image')) {
          const res = await fetch(scan.thumbnailDataUrl);
          const blob = await res.blob();
          await supabase.storage.from('scans').upload(imagePath, blob, {
            contentType: 'image/jpeg',
            upsert: true,
          });
        }
        await supabase.from('scans').insert({
          user_id: userId,
          field_id: scan.field_id || null,
          image_path: imagePath,
          label: scan.label,
          confidence: scan.confidence,
          advice: scan.advice,
        });
      }
    } catch {
      // ignore offline error
    }
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
    id: `diary-${Date.now()}`,
    created_at: new Date().toISOString(),
  };
  const updated = [record, ...existing];
  if (typeof window !== 'undefined') {
    localStorage.setItem(KEYS.DIARY, JSON.stringify(updated));
  }

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.user?.id) {
        await supabase.from('diary_entries').insert({
          user_id: session.user.id,
          field_id: entry.field_id || null,
          kind: entry.kind,
          category: entry.category,
          amount: entry.amount,
          note: entry.note,
          entry_date: entry.entry_date,
        });
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
  }
  return existing;
}

export async function deleteAllUserData(): Promise<void> {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(KEYS.FIELDS);
    localStorage.removeItem(KEYS.SCANS);
    localStorage.removeItem(KEYS.DIARY);
    // Also clear legacy v1 keys if present
    localStorage.removeItem('zarkhez_fields_v1');
    localStorage.removeItem('zarkhez_scans_v1');
    localStorage.removeItem('zarkhez_diary_v1');
  }
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.user?.id) {
        const userId = session.user.id;
        await supabase.from('tasks').delete().eq('user_id', userId);
        await supabase.from('scans').delete().eq('user_id', userId);
        await supabase.from('diary_entries').delete().eq('user_id', userId);
        await supabase.from('fields').delete().eq('user_id', userId);
      }
    } catch {
      // ignore
    }
  }
}
