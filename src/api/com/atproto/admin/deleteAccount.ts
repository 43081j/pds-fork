import { ComAtprotoAdminDeleteAccount } from '@atcute/atproto';
import { type XrpcProcedureHandlerOptions } from '@atcute/xrpc-server';
import { AppContext } from '../../../../context.js';

export default function (
  ctx: AppContext,
): XrpcProcedureHandlerOptions<ComAtprotoAdminDeleteAccount.mainSchema> {
  const adminToken = ctx.authVerifier.adminToken;

  return {
    lxm: ComAtprotoAdminDeleteAccount.mainSchema,
    handler: async ({ request, input }) => {
      const responseHeaders = new Headers();
      await adminToken({ request, responseHeaders, params: {} });

      const { did } = input;
      await ctx.actorStore.destroy(did);
      await ctx.accountManager.deleteAccount(did);
      const accountSeq = await ctx.sequencer.sequenceAccountEvt(did, 'deleted');
      await ctx.sequencer.deleteAllForUser(did, [accountSeq]);

      return new Response(null, { status: 200, headers: responseHeaders });
    },
  };
}
