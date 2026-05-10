import { ComAtprotoServerRequestEmailUpdate } from '@atcute/atproto';
import { ok as ensureOk } from '@atcute/client';
import {
  type XrpcProcedureHandlerOptions,
  InvalidRequestError,
  json,
} from '@atcute/xrpc-server';
import { AppContext } from '../../../../context.js';

// TODO: rate limiting (was 15/day + 5/hour per did) - needs router-level
// middleware in the new XRPCRouter setup.

export default function (
  ctx: AppContext,
): XrpcProcedureHandlerOptions<ComAtprotoServerRequestEmailUpdate.mainSchema> {
  const verifier = ctx.authVerifier.authorization({
    checkTakedown: true,
    authorize: (permissions) => {
      permissions.assertAccount({ attr: 'email', action: 'manage' });
    },
  });

  return {
    lxm: ComAtprotoServerRequestEmailUpdate.mainSchema,
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
          'com.atproto.server.requestEmailUpdate',
        );
        const body = await ensureOk(
          ctx.entrywayClient.post('com.atproto.server.requestEmailUpdate', {
            headers,
          }),
        );
        return json(body, { headers: responseHeaders });
      }

      if (!account.email) {
        throw new InvalidRequestError({
          message: 'account does not have an email address',
        });
      }

      const tokenRequired = !!account.emailConfirmedAt;
      if (tokenRequired) {
        const token = await ctx.accountManager.createEmailToken(
          did,
          'update_email',
        );
        await ctx.mailer.sendUpdateEmail({ token }, { to: account.email });
      }

      return json({ tokenRequired }, { headers: responseHeaders });
    },
  };
}
