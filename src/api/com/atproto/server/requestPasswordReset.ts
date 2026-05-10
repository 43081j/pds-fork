import { ComAtprotoServerRequestPasswordReset } from '@atcute/atproto';
import { ok as ensureOk } from '@atcute/client';
import {
  type XrpcProcedureHandlerOptions,
  InvalidRequestError,
} from '@atcute/xrpc-server';
import { AppContext } from '../../../../context.js';

// TODO: rate limiting (was 50/day + 15/hour) - needs router-level middleware.

export default function (
  ctx: AppContext,
): XrpcProcedureHandlerOptions<ComAtprotoServerRequestPasswordReset.mainSchema> {
  return {
    lxm: ComAtprotoServerRequestPasswordReset.mainSchema,
    handler: async ({ request, input }) => {
      const email = input.email.toLowerCase();

      const account = await ctx.accountManager.getAccountByEmail(email, {
        includeDeactivated: true,
        includeTakenDown: true,
      });

      if (account?.email) {
        const token = await ctx.accountManager.createEmailToken(
          account.did,
          'reset_password',
        );
        await ctx.mailer.sendResetPassword(
          { handle: account.handle ?? account.email, token },
          { to: account.email },
        );
        return new Response(null, { status: 200 });
      }

      if (ctx.entrywayClient) {
        const { headers } = ctx.entrywayPassthruHeaders(request);
        await ensureOk(
          ctx.entrywayClient.post('com.atproto.server.requestPasswordReset', {
            headers,
            input,
            as: null,
          }),
        );
        return new Response(null, { status: 200 });
      }

      throw new InvalidRequestError({
        message: 'account does not have an email address',
      });
    },
  };
}
