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
  REGISTERED_ACCOUNTS: 'zarkhez_registered_accounts_v2',
};

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
  language: 'ur',
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

  if (merged.isAuthenticated && merged.email) {
    addAccountToRegistered(merged);
  }

  if (typeof window !== 'undefined') {
    localStorage.setItem(KEYS.PROFILE, JSON.stringify(merged));
  }

  // Sync to Supabase in the background without blocking the UI
  const supabase = getSupabaseClient();
  if (supabase) {
    (async () => {
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
        }
      } catch {
        // ignore offline error
      }
    })();
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
    localStorage.removeItem('zarkhez_scan_sessions_v2');
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
    id: sessionData.id || `session-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    user_id: sessionData.user_id || 'anonymous',
    field_id: sessionData.field_id || null,
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
