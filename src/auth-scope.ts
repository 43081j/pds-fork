// @TODO sync-up with current method names, consider backwards compat.
export type AuthScope =
  | 'com.atproto.access'
  | 'com.atproto.refresh'
  | 'com.atproto.appPass'
  | 'com.atproto.appPassPrivileged'
  | 'com.atproto.signupQueued'
  | 'com.atproto.takendown';

export const ACCESS_FULL = ['com.atproto.access'] as const;
export const ACCESS_PRIVILEGED = [
  ...ACCESS_FULL,
  'com.atproto.appPassPrivileged',
] as const;
export const ACCESS_STANDARD = [
  ...ACCESS_PRIVILEGED,
  'com.atproto.appPass',
] as const;

const authScopesValues = new Set<AuthScope>([
  'com.atproto.access',
  'com.atproto.refresh',
  'com.atproto.appPass',
  'com.atproto.appPassPrivileged',
  'com.atproto.signupQueued',
  'com.atproto.takendown',
]);
export function isAuthScope(val: unknown): val is AuthScope {
  return (authScopesValues as Set<unknown>).has(val);
}

export function isAccessFull(
  scope: AuthScope,
): scope is (typeof ACCESS_FULL)[number] {
  return (ACCESS_FULL as readonly string[]).includes(scope);
}

export function isAccessPrivileged(
  scope: AuthScope,
): scope is (typeof ACCESS_PRIVILEGED)[number] {
  return (ACCESS_PRIVILEGED as readonly string[]).includes(scope);
}

export function isTakendown(scope: unknown): scope is 'com.atproto.takendown' {
  return scope === 'com.atproto.takendown';
}
