import { ComAtprotoServerRefreshSession } from '@atcute/atproto';
import { ok as ensureOk } from '@atcute/client';
import {
  type XrpcProcedureHandlerOptions,
  AuthRequiredError,
  InvalidRequestError,
  json,
} from '@atcute/xrpc-server';
import { DidString, HandleString, INVALID_HANDLE } from '@atproto/syntax';
import { formatAccountStatus } from '../../../../account-manager/account-manager.js';
import { AppContext } from '../../../../context.js';
import { softDeleted } from '../../../../db/util.js';
import { didDocForSession } from './util.js';

export default function (
  ctx: AppContext,
): XrpcProcedureHandlerOptions<ComAtprotoServerRefreshSession.mainSchema> {
  const refreshVerifier = ctx.authVerifier.refresh();

  return {
    lxm: ComAtprotoServerRefreshSession.mainSchema,
    handler: async ({ request }) => {
      const responseHeaders = new Headers();
      const auth = await refreshVerifier({
        request,
        responseHeaders,
        params: {},
      });

      const did = auth.credentials.did;
      const user = await ctx.accountManager.getAccount(did, {
        includeDeactivated: true,
        includeTakenDown: true,
      });
      if (!user) {
        throw new InvalidRequestError({
          message: `Could not find user info for account: ${did}`,
        });
      }
      if (softDeleted(user)) {
        throw new AuthRequiredError({
          message: 'Account has been taken down',
          error: 'AccountTakedown',
        });
      }

      if (ctx.entrywayClient) {
        const { headers } = ctx.entrywayPassthruHeaders(request);
        const body = await ensureOk(
          ctx.entrywayClient.post('com.atproto.server.refreshSession', {
            headers,
          }),
        );
        return json(body, { headers: responseHeaders });
      }

      const [didDoc, rotated] = await Promise.all([
        didDocForSession(ctx, user.did),
        ctx.accountManager.rotateRefreshToken(auth.credentials.tokenId),
      ]);
      if (rotated === null) {
        throw new InvalidRequestError({
          message: 'Token has been revoked',
          error: 'ExpiredToken',
        });
      }

      const { status, active } = formatAccountStatus(user);

      return json(
        {
          accessJwt: rotated.accessJwt,
          refreshJwt: rotated.refreshJwt,
          did: user.did as DidString,
          didDoc,
          handle: (user.handle ?? INVALID_HANDLE) as HandleString,
          email: user.email ?? undefined,
          emailConfirmed: !!user.emailConfirmedAt,
          active,
          status,
        },
        { headers: responseHeaders },
      );
    },
  };
}
