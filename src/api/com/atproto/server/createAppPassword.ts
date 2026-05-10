import { ComAtprotoServerCreateAppPassword } from '@atcute/atproto';
import { ok as ensureOk } from '@atcute/client';
import {
  type XrpcProcedureHandlerOptions,
  ForbiddenError,
  json,
} from '@atcute/xrpc-server';
import { ACCESS_FULL } from '../../../../auth-scope.js';
import { AppContext } from '../../../../context.js';

export default function (
  ctx: AppContext,
): XrpcProcedureHandlerOptions<ComAtprotoServerCreateAppPassword.mainSchema> {
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
    lxm: ComAtprotoServerCreateAppPassword.mainSchema,
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
          'com.atproto.server.createAppPassword',
        );

        const body = await ensureOk(
          ctx.entrywayClient.post('com.atproto.server.createAppPassword', {
            headers,
            input,
          }),
        );

        return json(body, { headers: responseHeaders });
      }

      const appPassword = await ctx.accountManager.createAppPassword(
        auth.credentials.did,
        input.name,
        input.privileged ?? false,
      );

      return json(appPassword, { headers: responseHeaders });
    },
  };
}
