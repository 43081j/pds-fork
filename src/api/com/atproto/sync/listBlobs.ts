import { ComAtprotoSyncListBlobs } from '@atcute/atproto';
import { type XrpcQueryHandlerOptions, json } from '@atcute/xrpc-server';
import { isUserOrAdmin } from '../../../../auth-verifier.js';
import type { AppContext } from '../../../../context.js';
import { assertRepoAvailability } from './util.js';

export default function (
  ctx: AppContext,
): XrpcQueryHandlerOptions<ComAtprotoSyncListBlobs.mainSchema> {
  const verifier = ctx.authVerifier.authorizationOrAdminTokenOptional({
    additional: ['com.atproto.takendown'],
    authorize: () => {
      // always allow
    },
  });

  return {
    lxm: ComAtprotoSyncListBlobs.mainSchema,
    handler: async ({ request, params }) => {
      const responseHeaders = new Headers();
      const auth = await verifier({
        request,
        responseHeaders,
        params: {},
      });

      const { did, since, limit, cursor } = params;
      await assertRepoAvailability(ctx, did, isUserOrAdmin(auth, did));

      const blobCids = await ctx.actorStore.read(did, (store) =>
        store.repo.blob.listBlobs({ since, limit, cursor }),
      );

      return json(
        {
          cursor: blobCids.at(-1),
          cids: blobCids,
        },
        { headers: responseHeaders },
      );
    },
  };
}
