import { ComAtprotoServerDeleteSession } from '@atcute/atproto';
import { ok as ensureOk } from '@atcute/client';
import { type XrpcProcedureHandlerOptions } from '@atcute/xrpc-server';
import { AppContext } from '../../../../context.js';

export default function (
  ctx: AppContext,
): XrpcProcedureHandlerOptions<ComAtprotoServerDeleteSession.mainSchema> {
  const refreshVerifier = ctx.authVerifier.refresh({ allowExpired: true });

  return {
    lxm: ComAtprotoServerDeleteSession.mainSchema,
    handler: async ({ request }) => {
      const responseHeaders = new Headers();

      if (ctx.entrywayClient) {
        const { headers } = ctx.entrywayPassthruHeaders(request);
        await ensureOk(
          ctx.entrywayClient.post('com.atproto.server.deleteSession', {
            headers,
            as: null,
          }),
        );
      } else {
        const auth = await refreshVerifier({
          request,
          responseHeaders,
          params: {},
        });
        await ctx.accountManager.revokeRefreshToken(auth.credentials.tokenId);
      }

      return new Response(null, { status: 200, headers: responseHeaders });
    },
  };
}
