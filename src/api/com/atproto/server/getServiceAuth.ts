import { ComAtprotoServerGetServiceAuth } from '@atcute/atproto';
import {
  type XrpcQueryHandlerOptions,
  InvalidRequestError,
  json,
} from '@atcute/xrpc-server';
import { HOUR, MINUTE } from '@atproto/common';
import { createServiceJwt } from '@atproto/xrpc-server';
import { isAccessPrivileged, isTakendown } from '../../../../auth-scope.js';
import { AppContext } from '../../../../context.js';
import {
  PRIVILEGED_METHODS,
  PROTECTED_METHODS,
} from '../../../../pipethrough.js';

export default function (
  ctx: AppContext,
): XrpcQueryHandlerOptions<ComAtprotoServerGetServiceAuth.mainSchema> {
  const verifier =
    ctx.authVerifier.authorization<ComAtprotoServerGetServiceAuth.$params>({
      additional: ['com.atproto.takendown'],
      authorize: (permissions, { params }) => {
        const { aud, lxm = '*' } = params;
        permissions.assertRpc({ aud, lxm });
      },
    });

  return {
    lxm: ComAtprotoServerGetServiceAuth.mainSchema,
    handler: async ({ request, params }) => {
      const responseHeaders = new Headers();
      const auth = await verifier({
        request,
        responseHeaders,
        params,
      });

      const did = auth.credentials.did;

      // @NOTE "exp" is expressed in seconds since epoch, not milliseconds
      const { aud, exp, lxm = null } = params;

      // Takendown accounts should not be able to generate service auth tokens
      // except for methods necessary for account migration
      if (auth.credentials.type === 'access') {
        // @NOTE We should probably use "ForbiddenError" here. Using
        // "InvalidRequestError" for legacy reasons.
        if (
          isTakendown(auth.credentials.scope) &&
          lxm !== 'com.atproto.server.createAccount'
        ) {
          throw new InvalidRequestError({
            message: 'Bad token scope',
            error: 'InvalidToken',
          });
        }

        // @NOTE "oauth" based credentials already checked through permission
        // set in "authorize" method above.
        if (
          lxm != null &&
          PRIVILEGED_METHODS.has(lxm) &&
          !isAccessPrivileged(auth.credentials.scope)
        ) {
          throw new InvalidRequestError({
            message: `insufficient access to request a service auth token for the following method: ${lxm}`,
          });
        }
      }

      if (exp) {
        const diff = exp * 1000 - Date.now();
        if (diff < 0) {
          throw new InvalidRequestError({
            message: 'expiration is in past',
            error: 'BadExpiration',
          });
        } else if (diff > HOUR) {
          throw new InvalidRequestError({
            message:
              'cannot request a token with an expiration more than an hour in the future',
            error: 'BadExpiration',
          });
        } else if (!lxm && diff > MINUTE) {
          throw new InvalidRequestError({
            message:
              'cannot request a method-less token with an expiration more than a minute in the future',
            error: 'BadExpiration',
          });
        }
      }

      if (lxm && PROTECTED_METHODS.has(lxm)) {
        throw new InvalidRequestError({
          message: `cannot request a service auth token for the following protected method: ${lxm}`,
        });
      }

      const keypair = await ctx.actorStore.keypair(did);

      const token = await createServiceJwt({
        iss: did,
        aud,
        exp,
        lxm,
        keypair,
      });
      return json({ token }, { headers: responseHeaders });
    },
  };
}
