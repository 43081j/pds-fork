import { Server } from '@atproto/xrpc-server';
import { isUserOrAdmin } from '../../../../auth-verifier.js';
import { AppContext } from '../../../../context.js';
import { com } from '../../../../lexicons.js';
import { assertRepoAvailability } from './util.js';

export default function (server: Server, ctx: AppContext) {
  server.add(com.atproto.sync.listBlobs, {
    auth: ctx.authVerifier.authorizationOrAdminTokenOptional({
      additional: ['com.atproto.takendown'],
      authorize: () => {
        // always allow
      },
    }),
    handler: async ({ params, auth }) => {
      const { did, since, limit, cursor } = params;
      await assertRepoAvailability(ctx, did, isUserOrAdmin(auth, did));

      const blobCids = await ctx.actorStore.read(did, (store) =>
        store.repo.blob.listBlobs({ since, limit, cursor }),
      );

      return {
        encoding: 'application/json' as const,
        body: {
          cursor: blobCids.at(-1),
          cids: blobCids,
        },
      };
    },
  });
}
