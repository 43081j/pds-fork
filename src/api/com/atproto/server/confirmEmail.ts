import { ComAtprotoServerConfirmEmail } from '@atcute/atproto';
import { ok as ensureOk } from '@atcute/client';
import {
  type XrpcProcedureHandlerOptions,
  InvalidRequestError,
} from '@atcute/xrpc-server';
import { AppContext } from '../../../../context.js';

export default function (
  ctx: AppContext,
): XrpcProcedureHandlerOptions<ComAtprotoServerConfirmEmail.mainSchema> {
  const verifier = ctx.authVerifier.authorization({
    checkTakedown: true,
    authorize: (permissions) => {
      permissions.assertAccount({ attr: 'email', action: 'manage' });
    },
  });

  return {
    lxm: ComAtprotoServerConfirmEmail.mainSchema,
    handler: async ({ request, input }) => {
      const responseHeaders = new Headers();
      const auth = await verifier({
        request,
        responseHeaders,
        params: {},
      });

      const { did } = auth.credentials;

      const user = await ctx.accountManager.getAccount(did, {
        includeDeactivated: true,
      });
      if (!user) {
        throw new InvalidRequestError({
          message: 'user not found',
          error: 'AccountNotFound',
        });
      }

      if (ctx.entrywayClient) {
        const { headers } = await ctx.entrywayAuthHeaders(
          request,
          did,
          'com.atproto.server.confirmEmail',
        );
        await ensureOk(
          ctx.entrywayClient.post('com.atproto.server.confirmEmail', {
            headers,
            input,
            as: null,
          }),
        );
      } else {
        if (user.email !== input.email.toLowerCase()) {
          throw new InvalidRequestError({
            message: 'invalid email',
            error: 'InvalidEmail',
          });
        }
        await ctx.accountManager.confirmEmail({ did, token: input.token });
      }

      return new Response(null, { status: 200, headers: responseHeaders });
    },
  };
}
