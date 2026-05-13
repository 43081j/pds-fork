import { ComAtprotoRepoListMissingBlobs } from '@atcute/atproto';
import { type XrpcQueryHandlerOptions, json } from '@atcute/xrpc-server';
import { AppContext } from '../../../../context.js';

export default function (
  ctx: AppContext,
): XrpcQueryHandlerOptions<ComAtprotoRepoListMissingBlobs.mainSchema> {
  const verifier = ctx.authVerifier.authorization({
    authorize: () => {
      // always allow
    },
  });

  return {
    lxm: ComAtprotoRepoListMissingBlobs.mainSchema,
    handler: async ({ request, params }) => {
      const responseHeaders = new Headers();
      const auth = await verifier({ request, responseHeaders, params: {} });

      const { did } = auth.credentials;
      const { limit, cursor } = params;

      const blobs = await ctx.actorStore.read(did, (store) =>
        store.repo.blob.listMissingBlobs({ limit, cursor }),
      );

      return json(
        {
          blobs,
          cursor: blobs.at(-1)?.cid,
        },
        { headers: responseHeaders },
      );
    },
  };
}
