import { ComAtprotoServerCheckAccountStatus } from '@atcute/atproto';
import { type XrpcQueryHandlerOptions, json } from '@atcute/xrpc-server';
import { AppContext } from '../../../../context.js';
import { isValidDidDocForService } from './util.js';

export default function (
  ctx: AppContext,
): XrpcQueryHandlerOptions<ComAtprotoServerCheckAccountStatus.mainSchema> {
  const verifier = ctx.authVerifier.authorization({
    authorize: () => {
      // always allow
    },
  });

  return {
    lxm: ComAtprotoServerCheckAccountStatus.mainSchema,
    handler: async ({ request }) => {
      const responseHeaders = new Headers();
      const { credentials } = await verifier({
        request,
        responseHeaders,
        params: {},
      });

      const requester = credentials.did;
      const [
        repoRoot,
        repoBlocks,
        indexedRecords,
        importedBlobs,
        expectedBlobs,
      ] = await ctx.actorStore.read(requester, async (store) => {
        return await Promise.all([
          store.repo.storage.getRootDetailed(),
          store.repo.storage.countBlocks(),
          store.record.recordCount(),
          store.repo.blob.blobCount(),
          store.repo.blob.recordBlobCount(),
        ]);
      });
      const [activated, validDid] = await Promise.all([
        ctx.accountManager.isAccountActivated(requester),
        isValidDidDocForService(ctx, requester),
      ]);

      return json(
        {
          activated,
          validDid,
          repoCommit: repoRoot.cid.toString(),
          repoRev: repoRoot.rev,
          repoBlocks,
          indexedRecords,
          privateStateValues: 0,
          expectedBlobs,
          importedBlobs,
        },
        { headers: responseHeaders },
      );
    },
  };
}
