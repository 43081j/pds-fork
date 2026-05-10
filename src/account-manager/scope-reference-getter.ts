import { ComAtprotoTempDereferenceScope } from '@atcute/atproto';
import { Client, ClientResponseError, ok as ensureOk } from '@atcute/client';
import Redis from 'ioredis';
import { DAY, backoffMs, retry } from '@atproto/common';
import { InvalidTokenError, OAuthScope } from '@atproto/oauth-provider';
import { UpstreamFailureError } from '@atproto/xrpc-server';
import { CachedGetter, GetterOptions } from '@atproto-labs/simple-store';
import { SimpleStoreMemory } from '@atproto-labs/simple-store-memory';
import { SimpleStoreRedis } from '@atproto-labs/simple-store-redis';
import { oauthLogger } from '../logger.js';

const PREFIX = 'ref:';

type ScopeReference = `${typeof PREFIX}${string}`;
const isScopeReference = (scope?: OAuthScope): scope is ScopeReference =>
  scope != null && scope.startsWith(PREFIX) && !scope.includes(' ');

const identity = <T>(value: T): T => value;

const isRetryableUpstreamFailure = (err: unknown): boolean => {
  if (!(err instanceof ClientResponseError)) return false;
  return err.status >= 500 && err.status <= 599;
};

export class ScopeReferenceGetter extends CachedGetter<
  ScopeReference,
  OAuthScope
> {
  protected readonly entryway: Client;

  constructor(entryway: Client, redis?: Redis) {
    super(
      async (ref, options) => {
        return retry(async () => this.fetchDereferencedScope(ref, options), {
          maxRetries: 3,
          getWaitMs: (n) => backoffMs(n, 250, 2000),
          retryable: (err) =>
            !options?.signal?.aborted && isRetryableUpstreamFailure(err),
        });
      },
      redis
        ? new SimpleStoreRedis(redis, {
            // tradeoff between wasted memory usage (by no longer used scopes)
            // and amount of requests to entryway:
            ttl: 1 * DAY,

            keyPrefix: `auth-scope-${PREFIX}`,
            encode: identity,
            decode: identity,
          })
        : new SimpleStoreMemory({ max: 1000 }),
    );
    this.entryway = entryway;
  }

  protected async fetchDereferencedScope(
    ref: ScopeReference,
    opts?: GetterOptions,
  ): Promise<OAuthScope> {
    oauthLogger.info({ ref }, 'Fetching scope reference');

    try {
      const { scope } = await ensureOk(
        this.entryway.call(ComAtprotoTempDereferenceScope.mainSchema, {
          params: { scope: ref },
          signal: opts?.signal,
          headers: opts?.noCache ? { 'Cache-Control': 'no-cache' } : undefined,
        }),
      );

      oauthLogger.info({ ref, scope }, 'Successfully fetched scope reference');

      // @NOTE the part after `PREFIX` (in the input scope) is the CID of the
      // scope string returned by entryway. Since there is a trust
      // relationship with the entryway, we don't need to verify or enforce
      // that here.

      return scope;
    } catch (err) {
      oauthLogger.error({ err, ref }, 'Failed to fetch scope reference');

      throw err;
    }
  }

  async dereference(scope?: OAuthScope): Promise<undefined | OAuthScope> {
    oauthLogger.debug({ scope }, 'Dereferencing scope');

    if (!isScopeReference(scope)) return scope;
    return this.get(scope).catch(handleDereferenceError);
  }
}

function handleDereferenceError(cause: unknown): never {
  if (
    cause instanceof ClientResponseError &&
    cause.error === 'InvalidScopeReference'
  ) {
    // The scope reference cannot be found on the server.
    // Consider the session as invalid, allowing entryway to
    // re-build the scope as the user re-authenticates. This
    // should never happen though.
    throw InvalidTokenError.from(cause, 'DPoP');
  }

  throw new UpstreamFailureError(
    'Failed to fetch token permissions',
    undefined,
    { cause },
  );
}
