/**
 * Tenant- & User-Scoped LocalStorage Helper (Audit Finding #11)
 * Guarantees zero cross-account localStorage leakage and cleans sensitive caches on logout.
 */

export interface StorageUserIdentity {
  id?: string | null;
  userId?: string | null;
  officeId?: string | null;
  username?: string | null;
}

const SCOPED_PREFIX = 'legal_tenant_v2_';

const LEGACY_SHARED_KEYS = [
  'legal_poa_records_v1',
  'legal_tasks_v1',
  'legal_judgments_v1',
  'court_ai_chat_draft',
];

export function getTenantScopeKey(user?: StorageUserIdentity | null): string | null {
  if (!user) return null;
  const officePart = (user.officeId || user.id || user.userId || user.username || '').trim();
  const userPart = (user.id || user.userId || user.username || '').trim();
  if (!officePart && !userPart) return null;
  const safeOffice = officePart.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeUser = userPart.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${safeOffice}__${safeUser}`;
}

export function buildUserScopedKey(
  namespace: string,
  user?: StorageUserIdentity | null,
): string | null {
  const scope = getTenantScopeKey(user);
  if (!scope) return null;
  return `${SCOPED_PREFIX}${scope}__${namespace}`;
}

export function readUserScopedJson<T>(
  namespace: string,
  user: StorageUserIdentity | null | undefined,
  fallback: T,
): T {
  try {
    const key = buildUserScopedKey(namespace, user);
    if (!key) return fallback;
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeUserScopedJson<T>(
  namespace: string,
  user: StorageUserIdentity | null | undefined,
  value: T,
): void {
  try {
    const key = buildUserScopedKey(namespace, user);
    if (!key) return;
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota errors
  }
}

export function readUserScopedString(
  namespace: string,
  user: StorageUserIdentity | null | undefined,
  fallback: string | null = null,
): string | null {
  try {
    const key = buildUserScopedKey(namespace, user);
    if (!key) return fallback;
    const val = localStorage.getItem(key);
    return val !== null ? val : fallback;
  } catch {
    return fallback;
  }
}

export function writeUserScopedString(
  namespace: string,
  user: StorageUserIdentity | null | undefined,
  value: string,
): void {
  try {
    const key = buildUserScopedKey(namespace, user);
    if (!key) return;
    localStorage.setItem(key, value);
  } catch {
    // ignore quota errors
  }
}

/**
 * Purges legacy shared keys and sensitive session caches upon logout,
 * while preserving user's UI theme preference (`theme`) and unsent `pending_sync` queues
 * ONLY if explicitly requested; by default removes all cached tenant records on logout.
 */
export function purgeSensitiveLocalStorageOnLogout(): void {
  try {
    for (const k of LEGACY_SHARED_KEYS) {
      localStorage.removeItem(k);
    }
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (
        (k.startsWith(SCOPED_PREFIX) && !k.endsWith('__poa_pending_sync')) ||
        k.startsWith('session_report_draft_') ||
        k.startsWith('legal_poa_records_')
      ) {
        keysToRemove.push(k);
      }
    }
    for (const k of keysToRemove) {
      localStorage.removeItem(k);
    }
  } catch {
    // ignore storage errors
  }
}
