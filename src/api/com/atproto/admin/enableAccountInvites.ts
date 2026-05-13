import { ComAtprotoAdminEnableAccountInvites } from '@atcute/atproto';
import {
  type XrpcProcedureHandlerOptions,
  InvalidRequestError,
} from '@atcute/xrpc-server';
import { AppContext } from '../../../../context.js';

export default function (
  ctx: AppContext,
): XrpcProcedureHandlerOptions<ComAtprotoAdminEnableAccountInvites.mainSchema> {
  const verifier = ctx.authVerifier.moderator;

  return {
    lxm: ComAtprotoAdminEnableAccountInvites.mainSchema,
    handler: async ({ request, input }) => {
      const responseHeaders = new Headers();
      await verifier({ request, responseHeaders, params: {} });

      if (ctx.cfg.entryway) {
        throw new InvalidRequestError({
          message: 'Account invites are managed by the entryway service',
        });
      }
      const { account } = input;
      await ctx.accountManager.setAccountInvitesDisabled(account, false);

      return new Response(null, { status: 200, headers: responseHeaders });
    },
  };
}
