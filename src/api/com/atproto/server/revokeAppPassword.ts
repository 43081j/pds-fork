import { ComAtprotoServerRevokeAppPassword } from '@atcute/atproto';
import { ok as ensureOk } from '@atcute/client';
import {
  type XrpcProcedureHandlerOptions,
  ForbiddenError,
} from '@atcute/xrpc-server';
import { AppContext } from '../../../../context.js';

export default function (
  ctx: AppContext,
): XrpcProcedureHandlerOptions<ComAtprotoServerRevokeAppPassword.mainSchema> {
  const verifier = ctx.authVerifier.authorization({
    authorize: () => {
      throw new ForbiddenError({
        message: 'OAuth credentials are not supported for this endpoint',
      });
    },
  });

  return {
    lxm: ComAtprotoServerRevokeAppPassword.mainSchema,
    handler: async ({ request, input }) => {
      const responseHeaders = new Headers();
      const auth = await verifier({
        request,
        responseHeaders,
        params: {},
      });

      if (ctx.entrywayClient) {
        const { headers } = await ctx.entrywayAuthHeaders(
          request,
          auth.credentials.did,
          'com.atproto.server.revokeAppPassword',
        );

        await ensureOk(
          ctx.entrywayClient.post('com.atproto.server.revokeAppPassword', {
            headers,
            input,
            as: null,
          }),
        );
      } else {
        await ctx.accountManager.revokeAppPassword(
          auth.credentials.did,
          input.name,
        );
      }

      return new Response(null, { status: 200, headers: responseHeaders });
    },
  };
}
