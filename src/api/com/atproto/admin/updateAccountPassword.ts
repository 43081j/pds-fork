import { ComAtprotoAdminUpdateAccountPassword } from '@atcute/atproto';
import { ok as ensureOk } from '@atcute/client';
import {
  type XrpcProcedureHandlerOptions,
  InvalidRequestError,
} from '@atcute/xrpc-server';
import { NEW_PASSWORD_MAX_LENGTH } from '../../../../account-manager/helpers/scrypt.js';
import { AppContext } from '../../../../context.js';

export default function (
  ctx: AppContext,
): XrpcProcedureHandlerOptions<ComAtprotoAdminUpdateAccountPassword.mainSchema> {
  const adminToken = ctx.authVerifier.adminToken;
  const { entrywayClient } = ctx;

  return {
    lxm: ComAtprotoAdminUpdateAccountPassword.mainSchema,
    handler: async ({ request, input }) => {
      const responseHeaders = new Headers();
      await adminToken({ request, responseHeaders, params: {} });

      if (entrywayClient) {
        const { headers } = ctx.entrywayPassthruHeaders(request);
        await ensureOk(
          entrywayClient.post('com.atproto.admin.updateAccountPassword', {
            input,
            headers,
            as: null,
          }),
        );
        return new Response(null, { status: 200, headers: responseHeaders });
      }

      const { did, password } = input;

      if (password.length > NEW_PASSWORD_MAX_LENGTH) {
        throw new InvalidRequestError({ message: 'Invalid password length.' });
      }

      await ctx.accountManager.updateAccountPassword({ did, password });

      return new Response(null, { status: 200, headers: responseHeaders });
    },
  };
}
