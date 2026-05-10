import { ComAtprotoServerRequestAccountDelete } from '@atcute/atproto';
import { ok as ensureOk } from '@atcute/client';
import {
  type XrpcProcedureHandlerOptions,
  ForbiddenError,
  InvalidRequestError,
} from '@atcute/xrpc-server';
import { ACCESS_FULL } from '../../../../auth-scope.js';
import { AppContext } from '../../../../context.js';

// TODO: rate limiting (was 15/day + 5/hour per did) - needs router-level
// middleware in the new XRPCRouter setup.

export default function (
  ctx: AppContext,
): XrpcProcedureHandlerOptions<ComAtprotoServerRequestAccountDelete.mainSchema> {
  const verifier = ctx.authVerifier.authorization({
    checkTakedown: true,
    scopes: ACCESS_FULL,
    authorize: () => {
      throw new ForbiddenError({
        message: 'OAuth credentials are not supported for this endpoint',
      });
    },
  });

  return {
    lxm: ComAtprotoServerRequestAccountDelete.mainSchema,
    handler: async ({ request }) => {
      const responseHeaders = new Headers();
      const auth = await verifier({
        request,
        responseHeaders,
        params: {},
      });

      const did = auth.credentials.did;
      const account = await ctx.accountManager.getAccount(did, {
        includeDeactivated: true,
        includeTakenDown: true,
      });
      if (!account) {
        throw new InvalidRequestError({ message: 'account not found' });
      }

      if (ctx.entrywayClient) {
        const { headers } = await ctx.entrywayAuthHeaders(
          request,
          did,
          'com.atproto.server.requestAccountDelete',
        );
        await ensureOk(
          ctx.entrywayClient.post('com.atproto.server.requestAccountDelete', {
            headers,
            as: null,
          }),
        );
      } else {
        if (!account.email) {
          throw new InvalidRequestError({
            message: 'account does not have an email address',
          });
        }
        const token = await ctx.accountManager.createEmailToken(
          did,
          'delete_account',
        );
        await ctx.mailer.sendAccountDelete({ token }, { to: account.email });
      }

      return new Response(null, { status: 200, headers: responseHeaders });
    },
  };
}
