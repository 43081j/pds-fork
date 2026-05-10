import { InvalidRequestError } from '@atproto/xrpc-server';

export function authPassthru(request: Request): HeadersParam | undefined {
  const authorization = request.headers.get('authorization');

  if (authorization) {
    // DPoP requests are bound to the endpoint being called. Allowing them to be
    // proxied would require that the receiving end allows DPoP proof not
    // created for him. Since proxying is mainly there to support legacy
    // clients, and DPoP is a new feature, we don't support DPoP requests
    // through the proxy.

    // This is fine since app views are usually called using the requester's
    // credentials when "auth.credentials.type === 'access'", which is the only
    // case were DPoP is used.
    const [type] = authorization.split(' ', 1);
    if (!type) {
      throw new InvalidRequestError('Invalid authorization header');
    }
    if (type.toLowerCase() === 'dpop' || request.headers.has('dpop')) {
      throw new InvalidRequestError('DPoP requests cannot be proxied');
    }

    return { headers: { authorization } };
  }
  return undefined;
}

// @NOTE this function may mutate its params input
// future improvement here would be to forward along all untrusted ips rather than just the first
export const forwardedFor = (
  clientIp: string | undefined,
  params: HeadersParam | undefined,
) => {
  const result: HeadersParam = params ?? { headers: {} };
  if (clientIp) {
    result.headers['x-forwarded-for'] = clientIp;
  }
  return result;
};

// TODO: replace with adapter-provided client IP once the server bootstrap
// switches off Express. For now, behind entryway/CDN, the leftmost
// `x-forwarded-for` entry is the original client.
export const clientIpFromRequest = (request: Request): string | undefined => {
  const forwarded = request.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || undefined;
};

type HeadersParam = { headers: Record<string, string> };
