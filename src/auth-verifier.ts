import { Secp256k1PublicKey } from '@atcute/crypto';
import * as jose from 'jose';
import { getVerificationMaterial } from '@atproto/common';
import { IdResolver, getDidKeyFromMultibase } from '@atproto/identity';
import { AtIdentifierString, DidString, isDidString } from '@atproto/lex';
import {
  OAuthError,
  OAuthVerifier,
  VerifyTokenPayloadOptions,
  WWWAuthenticateError,
} from '@atproto/oauth-provider';
import {
  ScopePermissions,
  ScopePermissionsTransition,
} from '@atproto/oauth-scopes';
import {
  AuthRequiredError,
  Awaitable,
  ForbiddenError,
  InvalidRequestError,
  XRPCError,
  verifyJwt as verifyServiceJwt,
} from '@atproto/xrpc-server';
import { AccountManager } from './account-manager/account-manager.js';
import { ActorAccount } from './account-manager/helpers/account.js';
import {
  AccessOutput,
  AdminTokenOutput,
  ModServiceOutput,
  OAuthOutput,
  RefreshOutput,
  UnauthenticatedOutput,
  UserServiceAuthOutput,
} from './auth-output.js';
import { ACCESS_STANDARD, AuthScope, isAuthScope } from './auth-scope.js';
import { softDeleted } from './db/index.js';
import { WithRequired } from './util/types.js';

export type AuthParams = Record<string, unknown>;

export type AuthContext<P extends AuthParams = AuthParams> = {
  request: Request;
  responseHeaders: Headers;
  params: P;
};

export type AuthVerifierFn<A, P extends AuthParams = AuthParams> = (
  ctx: AuthContext<P>,
) => Awaitable<A>;

export type VerifiedOptions = {
  checkTakedown?: boolean;
  checkDeactivated?: boolean;
};

export type ScopedOptions<S extends AuthScope = AuthScope> = {
  scopes?: readonly S[];
};

export type ExtraScopedOptions<S extends AuthScope = AuthScope> = {
  additional?: readonly S[];
};

export type AuthorizedOptions<P extends AuthParams = AuthParams> = {
  authorize: (
    permissions: ScopePermissions,
    ctx: AuthContext<P>,
  ) => Awaitable<void>;
};

export type AuthVerifierOpts = {
  publicUrl: string;
  jwtKey: jose.KeyLike | Uint8Array;
  adminPass: string;
  dids: {
    pds: string;
    entryway?: string;
    modService?: string;
  };
};

export type VerifyBearerJwtOptions<S extends AuthScope = AuthScope> =
  WithRequired<
    Omit<jose.JWTVerifyOptions, 'scopes'> & {
      scopes: readonly S[];
    },
    'audience' | 'typ'
  >;

export type VerifyBearerJwtResult<S extends AuthScope = AuthScope> = {
  sub: DidString;
  aud: string;
  jti: string | undefined;
  scope: S;
};

export class AuthVerifier {
  private _publicUrl: string;
  private _jwtKey: jose.KeyLike | Uint8Array;
  private _adminPass: string;
  public dids: AuthVerifierOpts['dids'];
  public accountManager: AccountManager;
  public idResolver: IdResolver;
  public oauthVerifier: OAuthVerifier;

  constructor(
    accountManager: AccountManager,
    idResolver: IdResolver,
    oauthVerifier: OAuthVerifier,
    opts: AuthVerifierOpts,
  ) {
    this._publicUrl = opts.publicUrl;
    this._jwtKey = opts.jwtKey;
    this._adminPass = opts.adminPass;
    this.dids = opts.dids;
    this.accountManager = accountManager;
    this.idResolver = idResolver;
    this.oauthVerifier = oauthVerifier;
  }

  // verifiers (arrow fns to preserve scope)

  public unauthenticated: AuthVerifierFn<UnauthenticatedOutput> = (ctx) => {
    setAuthHeaders(ctx.responseHeaders);

    // @NOTE this auth method is typically used as fallback when no other auth
    // method is applicable. This means that the presence of an "authorization"
    // header means that that header is invalid (as it did not match any of the
    // other auth methods).
    if (ctx.request.headers.get('authorization')) {
      throw new AuthRequiredError('Invalid authorization header');
    }

    return {
      credentials: null,
    };
  };

  public adminToken: AuthVerifierFn<AdminTokenOutput> = async (ctx) => {
    setAuthHeaders(ctx.responseHeaders);
    const parsed = parseBasicAuth(ctx.request);
    if (!parsed) {
      throw new AuthRequiredError();
    }
    const { username, password } = parsed;
    if (username !== 'admin' || password !== this._adminPass) {
      throw new AuthRequiredError();
    }

    return { credentials: { type: 'admin_token' } };
  };

  public modService: AuthVerifierFn<ModServiceOutput> = async (ctx) => {
    setAuthHeaders(ctx.responseHeaders);
    if (!this.dids.modService) {
      throw new AuthRequiredError('Untrusted issuer', 'UntrustedIss');
    }
    const payload = await this.verifyServiceJwt(ctx.request, {
      iss: [this.dids.modService, `${this.dids.modService}#atproto_labeler`],
    });
    return {
      credentials: {
        type: 'mod_service',
        did: payload.iss,
      },
    };
  };

  public moderator: AuthVerifierFn<AdminTokenOutput | ModServiceOutput> =
    async (ctx) => {
      const type = extractAuthType(ctx.request);
      if (type === 'Bearer') {
        return this.modService(ctx);
      } else {
        return this.adminToken(ctx);
      }
    };

  protected access<S extends AuthScope>(
    options: VerifiedOptions & Required<ScopedOptions<S>>,
  ): AuthVerifierFn<AccessOutput<S>> {
    const { scopes, ...statusOptions } = options;

    const verifyJwtOptions: VerifyBearerJwtOptions<S> = {
      audience: this.dids.pds,
      typ: 'at+jwt',
      scopes:
        // @NOTE We can reject taken down credentials based on the scope if
        // "checkTakedown" is set.
        statusOptions.checkTakedown &&
        scopes.includes('com.atproto.takendown' as S)
          ? scopes.filter((s) => s !== 'com.atproto.takendown')
          : scopes,
    };

    return async (ctx) => {
      setAuthHeaders(ctx.responseHeaders);

      const { sub: did, scope } = await this.verifyBearerJwt(
        ctx.request,
        verifyJwtOptions,
      );

      await this.verifyStatus(did, statusOptions);

      return {
        credentials: { type: 'access', did, scope },
      };
    };
  }

  public refresh(options?: {
    allowExpired?: boolean;
  }): AuthVerifierFn<RefreshOutput> {
    const verifyOptions: VerifyBearerJwtOptions<'com.atproto.refresh'> = {
      clockTolerance: options?.allowExpired ? Infinity : undefined,
      typ: 'refresh+jwt',
      // when using entryway, proxying refresh credentials
      audience: this.dids.entryway ? this.dids.entryway : this.dids.pds,
      scopes: ['com.atproto.refresh'],
    };

    return async (ctx) => {
      setAuthHeaders(ctx.responseHeaders);

      const result = await this.verifyBearerJwt(ctx.request, verifyOptions);

      const tokenId = result.jti;
      if (!tokenId) {
        throw new AuthRequiredError(
          'Unexpected missing refresh token id',
          'MissingTokenId',
        );
      }

      return {
        credentials: {
          type: 'refresh',
          did: result.sub,
          scope: result.scope,
          tokenId,
        },
      };
    };
  }

  public authorization<P extends AuthParams>({
    scopes = ACCESS_STANDARD,
    additional = [],
    ...options
  }: VerifiedOptions &
    ScopedOptions &
    ExtraScopedOptions &
    AuthorizedOptions<P>): AuthVerifierFn<AccessOutput | OAuthOutput, P> {
    const access = this.access({
      ...options,
      scopes: [...scopes, ...additional],
    });
    const oauth = this.oauth(options);

    return async (ctx) => {
      const type = extractAuthType(ctx.request);

      if (type === 'Bearer') {
        return access(ctx);
      }

      if (type === 'DPoP') {
        return oauth(ctx);
      }

      // Auth headers are set through the access and oauth methods so we only
      // need to set them here if we reach this point
      setAuthHeaders(ctx.responseHeaders);

      if (type !== null) {
        throw new InvalidRequestError(
          'Unexpected authorization type',
          'InvalidToken',
        );
      }

      throw new AuthRequiredError(undefined, 'AuthMissing');
    };
  }

  public authorizationOrAdminTokenOptional<P extends AuthParams>(
    opts: VerifiedOptions & ExtraScopedOptions & AuthorizedOptions<P>,
  ): AuthVerifierFn<
    OAuthOutput | AccessOutput | AdminTokenOutput | UnauthenticatedOutput,
    P
  > {
    const authorization = this.authorization(opts);
    return async (ctx) => {
      const type = extractAuthType(ctx.request);
      if (type === 'Bearer' || type === 'DPoP') {
        return authorization(ctx);
      } else if (type === 'Basic') {
        return this.adminToken(ctx);
      } else {
        return this.unauthenticated(ctx);
      }
    };
  }

  public userServiceAuth: AuthVerifierFn<UserServiceAuthOutput> = async (
    ctx,
  ) => {
    setAuthHeaders(ctx.responseHeaders);
    const payload = await this.verifyServiceJwt(ctx.request);
    return {
      credentials: {
        type: 'user_service_auth',
        did: payload.iss,
      },
    };
  };

  public userServiceAuthOptional: AuthVerifierFn<
    UserServiceAuthOutput | UnauthenticatedOutput
  > = async (ctx) => {
    const type = extractAuthType(ctx.request);
    if (type === 'Bearer') {
      return await this.userServiceAuth(ctx);
    } else {
      return this.unauthenticated(ctx);
    }
  };

  public authorizationOrUserServiceAuth<P extends AuthParams>(
    options: VerifiedOptions &
      ScopedOptions &
      ExtraScopedOptions &
      AuthorizedOptions<P>,
  ): AuthVerifierFn<UserServiceAuthOutput | OAuthOutput | AccessOutput, P> {
    const authorizationVerifier = this.authorization(options);
    return async (ctx) => {
      if (isDefinitelyServiceAuth(ctx.request)) {
        return this.userServiceAuth(ctx);
      } else {
        return authorizationVerifier(ctx);
      }
    };
  }

  protected oauth<P extends AuthParams>({
    authorize,
    ...verifyStatusOptions
  }: VerifiedOptions & AuthorizedOptions<P>): AuthVerifierFn<OAuthOutput, P> {
    const verifyTokenOptions: VerifyTokenPayloadOptions = {
      audience: [this.dids.pds],
      scope: ['atproto'],
    };

    return async (ctx) => {
      setAuthHeaders(ctx.responseHeaders);

      const { request, responseHeaders } = ctx;

      // https://datatracker.ietf.org/doc/html/rfc9449#section-8.2
      const dpopNonce = this.oauthVerifier.nextDpopNonce();
      if (dpopNonce) {
        responseHeaders.set('DPoP-Nonce', dpopNonce);
        responseHeaders.append('Access-Control-Expose-Headers', 'DPoP-Nonce');
      }

      const url = new URL(request.url, this._publicUrl);

      const { scope, sub: did } = await this.oauthVerifier
        .authenticateRequest(
          request.method,
          url,
          headersToRecord(request.headers),
          verifyTokenOptions,
        )
        .catch((err) => {
          // Make sure to include any WWW-Authenticate header in the response
          // (particularly useful for DPoP's "use_dpop_nonce" error)
          if (err instanceof WWWAuthenticateError) {
            responseHeaders.set('WWW-Authenticate', err.wwwAuthenticateHeader);
            responseHeaders.append(
              'Access-Control-Expose-Headers',
              'WWW-Authenticate',
            );
          }

          if (err instanceof OAuthError) {
            throw new XRPCError(err.status, err.error_description, err.error);
          }

          throw err;
        });

      if (!isDidString(did)) {
        throw new InvalidRequestError('Malformed token', 'InvalidToken');
      }

      await this.verifyStatus(did, verifyStatusOptions);

      const permissions = new ScopePermissionsTransition(scope?.split(' '));

      // Should never happen
      if (!permissions.scopes.has('atproto')) {
        throw new InvalidRequestError(
          'OAuth token does not have "atproto" scope',
          'InvalidToken',
        );
      }

      await authorize(permissions, ctx);

      return {
        credentials: {
          type: 'oauth',
          did,
          permissions,
        },
      };
    };
  }

  protected async verifyStatus(
    did: DidString,
    options: VerifiedOptions,
  ): Promise<void> {
    if (options.checkDeactivated || options.checkTakedown) {
      await this.findAccount(did, options);
    }
  }

  /**
   * Finds an account by its handle or DID, returning possibly deactivated or
   * taken down accounts (unless `options.checkDeactivated` or
   * `options.checkTakedown` are set to true, respectively).
   */
  public async findAccount(
    handleOrDid: AtIdentifierString,
    options: VerifiedOptions,
  ): Promise<ActorAccount> {
    const account = await this.accountManager.getAccount(handleOrDid, {
      includeDeactivated: true,
      includeTakenDown: true,
    });
    if (!account) {
      // will be turned into ExpiredToken for the client if proxied by entryway
      throw new ForbiddenError('Account not found', 'AccountNotFound');
    }
    if (options.checkTakedown && softDeleted(account)) {
      throw new AuthRequiredError(
        'Account has been taken down',
        'AccountTakedown',
      );
    }
    if (options.checkDeactivated && account.deactivatedAt) {
      throw new AuthRequiredError(
        'Account is deactivated',
        'AccountDeactivated',
      );
    }
    return account;
  }

  /**
   * Wraps {@link jose.jwtVerify} into a function that also validates the token
   * payload's type and wraps errors into {@link InvalidRequestError}.
   */
  protected async verifyBearerJwt<S extends AuthScope = AuthScope>(
    request: Request,
    { scopes, ...options }: VerifyBearerJwtOptions<S>,
  ): Promise<VerifyBearerJwtResult<S>> {
    const token = bearerTokenFromRequest(request);
    if (!token) {
      throw new AuthRequiredError(undefined, 'AuthMissing');
    }

    const { payload } = await jose
      .jwtVerify(token, this._jwtKey, options)
      .catch((cause) => {
        if (cause instanceof jose.errors.JWTExpired) {
          throw new InvalidRequestError('Token has expired', 'ExpiredToken', {
            cause,
          });
        } else {
          throw new InvalidRequestError(
            'Token could not be verified',
            'InvalidToken',
            { cause },
          );
        }
      });

    const { sub, aud, scope, lxm, cnf, jti } = payload;

    if (typeof lxm !== 'undefined') {
      // Service auth tokens should never make it to here. But since service
      // auth tokens do not have a "typ" header, the "typ" check above will not
      // catch them. This check here is mainly to protect against the
      // hypothetical case in which a PDS would issue service auth tokens using
      // its private key.
      throw new InvalidRequestError('Malformed token', 'InvalidToken');
    }
    if (typeof cnf !== 'undefined') {
      // Proof-of-Possession (PoP) tokens are not allowed here
      // https://www.rfc-editor.org/rfc/rfc7800.html
      throw new InvalidRequestError('Malformed token', 'InvalidToken');
    }
    if (typeof sub !== 'string' || !isDidString(sub)) {
      throw new InvalidRequestError('Malformed token', 'InvalidToken');
    }
    if (typeof aud !== 'string' || !aud.startsWith('did:')) {
      throw new InvalidRequestError('Malformed token', 'InvalidToken');
    }
    if (typeof jti !== 'string' && typeof jti !== 'undefined') {
      throw new InvalidRequestError('Malformed token', 'InvalidToken');
    }
    if (!isAuthScope(scope) || !scopes.includes(scope as any)) {
      throw new InvalidRequestError('Bad token scope', 'InvalidToken');
    }

    return { sub, aud, jti, scope: scope as S };
  }

  protected async verifyServiceJwt(
    request: Request,
    opts?: { iss?: string[] },
  ) {
    const jwtStr = bearerTokenFromRequest(request);
    if (!jwtStr) {
      throw new AuthRequiredError('missing jwt', 'MissingJwt');
    }

    const nsid = parseXrpcNsid(new URL(request.url).pathname);
    const payload = await verifyServiceJwt(
      jwtStr,
      null,
      nsid,
      async (iss, forceRefresh) => {
        if (opts?.iss && !opts.iss.includes(iss)) {
          throw new AuthRequiredError('Untrusted issuer', 'UntrustedIss');
        }
        const [did, serviceId] = iss.split('#') as [string, ...string[]];
        const keyId =
          serviceId === 'atproto_labeler' ? 'atproto_label' : 'atproto';
        const didDoc = await this.idResolver.did.resolve(did, forceRefresh);
        if (!didDoc) {
          throw new AuthRequiredError('could not resolve iss did');
        }
        const parsedKey = getVerificationMaterial(didDoc, keyId);
        if (!parsedKey) {
          throw new AuthRequiredError('missing or bad key in did doc');
        }
        const didKey = getDidKeyFromMultibase(parsedKey);
        if (!didKey) {
          throw new AuthRequiredError('missing or bad key in did doc');
        }
        return didKey;
      },
    );
    if (
      payload.aud !== this.dids.pds &&
      (!this.dids.entryway || payload.aud !== this.dids.entryway)
    ) {
      throw new AuthRequiredError(
        'jwt audience does not match service did',
        'BadJwtAudience',
      );
    }
    return payload;
  }
}

// HELPERS
// ---------

export function isUserOrAdmin(
  auth: AccessOutput | OAuthOutput | AdminTokenOutput | UnauthenticatedOutput,
  did: string,
): boolean {
  if (!auth.credentials) {
    return false;
  } else if (auth.credentials.type === 'admin_token') {
    return true;
  } else {
    return auth.credentials.did === did;
  }
}

const knownAuthTypes = ['Basic', 'Bearer', 'DPoP'] as const;
type AuthType = (typeof knownAuthTypes)[number];

const parseAuthorizationHeader = (
  request: Request,
): [type: null] | [type: AuthType, token: string] => {
  const authorization = request.headers.get('authorization');
  if (!authorization) return [null];

  const result = authorization.split(' ');
  if (result.length !== 2) {
    throw new InvalidRequestError(
      'Malformed authorization header',
      'InvalidToken',
    );
  }

  // authorization type is case-insensitive
  const authType = result[0]!.toUpperCase();

  const type = Object.hasOwn(knownAuthTypes, authType)
    ? (authType as AuthType)
    : null;
  if (type) return [type, result[1]!];

  throw new InvalidRequestError(
    `Unsupported authorization type: ${result[0]}`,
    'InvalidToken',
  );
};

/**
 * @note Not all service auth tokens are guaranteed to have "lxm" claim, so this
 * function should not be used to verify service auth tokens. It is only used to
 * check if a token is definitely a service auth token.
 */
const isDefinitelyServiceAuth = (request: Request): boolean => {
  const token = bearerTokenFromRequest(request);
  if (!token) return false;
  const payload = jose.decodeJwt(token);
  return payload['lxm'] != null;
};

const extractAuthType = (request: Request): AuthType | null => {
  const [type] = parseAuthorizationHeader(request);
  return type;
};

export const bearerTokenFromRequest = (request: Request) => {
  const [type, token] = parseAuthorizationHeader(request);
  return type === 'Bearer' ? token : null;
};

const parseBasicAuth = (
  request: Request,
): { username: string; password: string } | null => {
  try {
    const [type, b64] = parseAuthorizationHeader(request);
    if (type !== 'Basic') return null;
    const decoded = Buffer.from(b64, 'base64').toString('utf8');
    // We must not use split(':') because the password can contain colons
    const colon = decoded.indexOf(':');
    if (colon === -1) return null;
    const username = decoded.slice(0, colon);
    const password = decoded.slice(colon + 1);
    return { username, password };
  } catch (err) {
    return null;
  }
};

export const createSecretKeyObject = (secret: string): Uint8Array => {
  return new TextEncoder().encode(secret);
};

export const createPublicKeyObject = async (
  publicKeyHex: string,
): Promise<jose.KeyLike> => {
  const bytes = Buffer.from(publicKeyHex, 'hex');
  const key = await Secp256k1PublicKey.importRaw(bytes);
  const jwk = await key.exportPublicKey('jwk');
  return (await jose.importJWK(jwk as jose.JWK, 'ES256K')) as jose.KeyLike;
};

const headersToRecord = (
  headers: Headers,
): Record<string, string | string[] | undefined> => {
  const record: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of headers) {
    const lower = key.toLowerCase();
    const existing = record[lower];
    if (existing === undefined) {
      record[lower] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      record[lower] = [existing, value];
    }
  }
  return record;
};

const parseXrpcNsid = (pathname: string): string => {
  const match = pathname.match(/\/xrpc\/([^/?#]+)/);
  if (!match) {
    throw new InvalidRequestError('Invalid xrpc path');
  }
  return match[1]!;
};

function setAuthHeaders(headers: Headers) {
  headers.set('Cache-Control', 'private');
  appendVary(headers, 'Authorization');
}

function appendVary(headers: Headers, value: string) {
  const existing = headers.get('Vary');
  const search = value.toLowerCase();
  if (existing) {
    const present = existing
      .split(',')
      .map((v) => v.trim().toLowerCase())
      .some((v) => v === search || v === '*');
    if (present) return;
  }
  headers.append('Vary', value);
}
