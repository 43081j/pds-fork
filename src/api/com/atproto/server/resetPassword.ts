import { ComAtprotoServerResetPassword } from '@atcute/atproto';
import { ok as ensureOk } from '@atcute/client';
import {
  type XrpcProcedureHandlerOptions,
  InvalidRequestError,
} from '@atcute/xrpc-server';
import { NEW_PASSWORD_MAX_LENGTH } from '../../../../account-manager/helpers/scrypt.js';
import { AppContext } from '../../../../context.js';

// TODO: rate limiting (was 50/5min) - needs router-level middleware.

export default function (
  ctx: AppContext,
): XrpcProcedureHandlerOptions<ComAtprotoServerResetPassword.mainSchema> {
  return {
    lxm: ComAtprotoServerResetPassword.mainSchema,
    handler: async ({ request, input }) => {
      if (ctx.entrywayClient) {
        const { headers } = ctx.entrywayPassthruHeaders(request);
        await ensureOk(
          ctx.entrywayClient.post('com.atproto.server.resetPassword', {
            headers,
            input,
            as: null,
          }),
        );
      } else {
        const { token, password } = input;

        if (password.length > NEW_PASSWORD_MAX_LENGTH) {
          throw new InvalidRequestError({
            message: 'Invalid password length.',
          });
        }

        await ctx.accountManager.resetPassword({ token, password });
      }

      return new Response(null, { status: 200 });
    },
  };
}
