/**
 * Real-Time Google Identity Services (GIS) & OAuth2 UserInfo Integration (lib/google-auth.ts)
 * - Loads Google's official `https://accounts.google.com/gsi/client` SDK.
 * - Supports:
 *   1. Real-time OAuth2 Account Chooser Popup (`google.accounts.oauth2.initTokenClient`)
 *      which calls `https://www.googleapis.com/oauth2/v3/userinfo` to pull the user's
 *      real Google Name, Gmail, Profile Photo (`picture`), Verified status, and Google `sub` ID.
 *   2. Real-time Google One-Tap & Official Google Sign-In Button (`google.accounts.id`)
 *      which decodes the signed Google JWT credential.
 */

export interface RealGoogleUserInfo {
  sub: string;
  name: string;
  given_name?: string;
  family_name?: string;
  picture: string;
  email: string;
  email_verified?: boolean;
  locale?: string;
}

interface GoogleTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface GoogleTokenClient {
  requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
}

interface GoogleCredentialResponse {
  credential: string;
  select_by?: string;
}

interface GoogleAccountsWindow {
  google?: {
    accounts: {
      id: {
        initialize: (config: {
          client_id: string;
          callback: (response: GoogleCredentialResponse) => void;
          auto_select?: boolean;
          cancel_on_tap_outside?: boolean;
        }) => void;
        prompt: () => void;
        renderButton: (
          parent: HTMLElement,
          options: {
            theme?: 'outline' | 'filled_blue' | 'filled_black';
            size?: 'large' | 'medium' | 'small';
            type?: 'standard' | 'icon';
            shape?: 'rectangular' | 'pill' | 'circle' | 'square';
            width?: number;
            text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
            logo_alignment?: 'left' | 'center';
          }
        ) => void;
      };
      oauth2: {
        initTokenClient: (config: {
          client_id: string;
          scope: string;
          prompt?: string;
          callback: (response: GoogleTokenResponse) => void;
          error_callback?: (err: { type?: string; message?: string }) => void;
        }) => GoogleTokenClient;
      };
    };
  };
}

const CUSTOM_CLIENT_ID_KEY = 'zarkhez_google_client_id_v1';

export function getEffectiveGoogleClientId(): string {
  const envId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';
  if (envId.trim()) return envId.trim();
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem(CUSTOM_CLIENT_ID_KEY);
    if (stored && stored.trim()) return stored.trim();
  }
  return '';
}

export function setCustomGoogleClientId(clientId: string): void {
  if (typeof window === 'undefined') return;
  const clean = clientId.trim();
  if (clean) {
    localStorage.setItem(CUSTOM_CLIENT_ID_KEY, clean);
  } else {
    localStorage.removeItem(CUSTOM_CLIENT_ID_KEY);
  }
}

let gsiScriptPromise: Promise<boolean> | null = null;

export function loadGoogleIdentityScript(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  const w = window as unknown as GoogleAccountsWindow;
  if (w.google?.accounts) return Promise.resolve(true);

  if (gsiScriptPromise) return gsiScriptPromise;

  gsiScriptPromise = new Promise<boolean>((resolve) => {
    const existing = document.querySelector(
      'script[src="https://accounts.google.com/gsi/client"]'
    );
    if (existing) {
      existing.addEventListener('load', () => resolve(true));
      existing.addEventListener('error', () => resolve(false));
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(true);
    script.onerror = () => {
      gsiScriptPromise = null;
      resolve(false);
    };
    document.head.appendChild(script);
  });

  return gsiScriptPromise;
}

/**
 * Decodes a Google ID Token JWT (from Google One-Tap or Official Button)
 * into a RealGoogleUserInfo object.
 */
export function decodeGoogleJwt(jwtCredential: string): RealGoogleUserInfo | null {
  try {
    const parts = jwtCredential.split('.');
    if (parts.length < 2) return null;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    const payload = JSON.parse(jsonPayload) as Partial<RealGoogleUserInfo>;
    if (!payload.email) return null;
    return {
      sub: payload.sub || payload.email,
      name: payload.name || payload.email.split('@')[0],
      given_name: payload.given_name,
      family_name: payload.family_name,
      picture: payload.picture || '',
      email: payload.email,
      email_verified: payload.email_verified ?? true,
      locale: payload.locale,
    };
  } catch {
    return null;
  }
}

/**
 * Opens Google's real-time native Account Chooser popup (`select_account`)
 * and fetches the user's real profile (`name`, `email`, `picture`, `sub`)
 * from `https://www.googleapis.com/oauth2/v3/userinfo`.
 */
export async function launchRealGoogleAccountChooser(
  clientId: string
): Promise<RealGoogleUserInfo> {
  const loaded = await loadGoogleIdentityScript();
  const w = window as unknown as GoogleAccountsWindow;

  if (!loaded || !w.google?.accounts?.oauth2) {
    throw new Error('Google Identity Services failed to load');
  }

  return new Promise<RealGoogleUserInfo>((resolve, reject) => {
    const tokenClient = w.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'openid email profile',
      prompt: 'select_account',
      callback: async (tokenResponse) => {
        if (tokenResponse.error || !tokenResponse.access_token) {
          reject(
            new Error(
              tokenResponse.error_description ||
                tokenResponse.error ||
                'Google authorization cancelled'
            )
          );
          return;
        }

        try {
          const res = await fetch(
            'https://www.googleapis.com/oauth2/v3/userinfo',
            {
              headers: {
                Authorization: `Bearer ${tokenResponse.access_token}`,
              },
            }
          );
          if (!res.ok) {
            throw new Error('Failed to fetch Google userinfo');
          }
          const userInfo = (await res.json()) as RealGoogleUserInfo;
          resolve(userInfo);
        } catch (err) {
          reject(
            err instanceof Error
              ? err
              : new Error('Failed to fetch Google profile')
          );
        }
      },
      error_callback: (err) => {
        reject(new Error(err?.message || 'Google popup closed'));
      },
    });

    tokenClient.requestAccessToken({ prompt: 'select_account' });
  });
}

/**
 * Initializes Google One-Tap and optionally renders the official Google button
 * inside a target container element.
 */
export async function initGoogleOneTapAndButton(
  clientId: string,
  onSuccess: (user: RealGoogleUserInfo) => void,
  buttonContainer?: HTMLElement | null
): Promise<void> {
  if (!clientId) return;
  const loaded = await loadGoogleIdentityScript();
  const w = window as unknown as GoogleAccountsWindow;
  if (!loaded || !w.google?.accounts?.id) return;

  w.google.accounts.id.initialize({
    client_id: clientId,
    callback: (response) => {
      const decoded = decodeGoogleJwt(response.credential);
      if (decoded) {
        onSuccess(decoded);
      }
    },
    auto_select: false,
    cancel_on_tap_outside: true,
  });

  if (buttonContainer) {
    buttonContainer.innerHTML = '';
    w.google.accounts.id.renderButton(buttonContainer, {
      theme: 'outline',
      size: 'large',
      shape: 'pill',
      text: 'continue_with',
      width: Math.min(360, buttonContainer.clientWidth || 320),
    });
  }

  try {
    w.google.accounts.id.prompt();
  } catch {
    // ignore
  }
}
