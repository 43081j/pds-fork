import { Server } from '@atproto/xrpc-server';
import { AppContext } from '../../../../context.js';
import { com } from '../../../../lexicons.js';

export default function (server: Server, ctx: AppContext) {
  server.add(com.atproto.admin.deleteAccount, {
    auth: ctx.authVerifier.adminToken,
    handler: async ({ input }) => {
      const { did } = input.body;
      await ctx.actorStore.destroy(did);
      await ctx.accountManager.deleteAccount(did);
      const accountSeq = await ctx.sequencer.sequenceAccountEvt(did, 'deleted');
      await ctx.sequencer.deleteAllForUser(did, [accountSeq]);
    },
  });
}
