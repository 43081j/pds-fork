import { ComAtprotoAdminUpdateAccountEmail } from '@atcute/atproto';
import { ok as ensureOk } from '@atcute/client';
import {
  type XrpcProcedureHandlerOptions,
  InvalidRequestError,
} from '@atcute/xrpc-server';
import { AppContext } from '../../../../context.js';

export default function (
  ctx: AppContext,
): XrpcProcedureHandlerOptions<ComAtprotoAdminUpdateAccountEmail.mainSchema> {
  const adminToken = ctx.authVerifier.adminToken;

  return {
    lxm: ComAtprotoAdminUpdateAccountEmail.mainSchema,
    handler: async ({ request, input }) => {
      const responseHeaders = new Headers();
      await adminToken({ request, responseHeaders, params: {} });

      const account = await ctx.accountManager.getAccount(input.account, {
        includeDeactivated: true,
        includeTakenDown: true,
      });
      if (!account) {
        throw new InvalidRequestError({
          message: `Account does not exist: ${input.account}`,
        });
      }

      if (ctx.entrywayClient) {
        const { headers } = ctx.entrywayPassthruHeaders(request);
        await ensureOk(
          ctx.entrywayClient.post('com.atproto.admin.updateAccountEmail', {
            headers,
            input,
            as: null,
          }),
        );
        return new Response(null, { status: 200, headers: responseHeaders });
      }

      await ctx.accountManager.updateEmail({
        did: account.did,
        email: input.email,
      });

      return new Response(null, { status: 200, headers: responseHeaders });
    },
  };
}
