import { ComAtprotoServerListAppPasswords } from '@atcute/atproto';
import { ok as ensureOk } from '@atcute/client';
import {
  type XrpcQueryHandlerOptions,
  ForbiddenError,
  json,
} from '@atcute/xrpc-server';
import { AppContext } from '../../../../context.js';

export default function (
  ctx: AppContext,
): XrpcQueryHandlerOptions<ComAtprotoServerListAppPasswords.mainSchema> {
  const verifier = ctx.authVerifier.authorization({
    authorize: () => {
      throw new ForbiddenError({
        message: 'OAuth credentials are not supported for this endpoint',
      });
    },
  });

  return {
    lxm: ComAtprotoServerListAppPasswords.mainSchema,
    handler: async ({ request }) => {
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
          'com.atproto.server.listAppPasswords',
        );

        const body = await ensureOk(
          ctx.entrywayClient.get('com.atproto.server.listAppPasswords', {
            headers,
          }),
        );

        return json(body, { headers: responseHeaders });
      }

      const passwords = await ctx.accountManager.listAppPasswords(
        auth.credentials.did,
      );
      return json({ passwords }, { headers: responseHeaders });
    },
  };
}
