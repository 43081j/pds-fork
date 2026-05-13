import { ComAtprotoAdminDisableInviteCodes } from '@atcute/atproto';
import {
  type XrpcProcedureHandlerOptions,
  InvalidRequestError,
} from '@atcute/xrpc-server';
import { AppContext } from '../../../../context.js';

export default function (
  ctx: AppContext,
): XrpcProcedureHandlerOptions<ComAtprotoAdminDisableInviteCodes.mainSchema> {
  const verifier = ctx.authVerifier.moderator;

  return {
    lxm: ComAtprotoAdminDisableInviteCodes.mainSchema,
    handler: async ({ request, input }) => {
      const responseHeaders = new Headers();
      await verifier({ request, responseHeaders, params: {} });

      if (ctx.cfg.entryway) {
        throw new InvalidRequestError({
          message: 'Account invites are managed by the entryway service',
        });
      }
      const { codes = [], accounts = [] } = input;
      if (accounts.includes('admin')) {
        throw new InvalidRequestError({
          message: 'cannot disable admin invite codes',
        });
      }
      await ctx.accountManager.disableInviteCodes({ codes, accounts });

      return new Response(null, { status: 200, headers: responseHeaders });
    },
  };
}
