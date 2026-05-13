import { ComAtprotoRepoDescribeRepo } from '@atcute/atproto';
import {
  type XrpcQueryHandlerOptions,
  InvalidRequestError,
  json,
} from '@atcute/xrpc-server';
import * as id from '@atproto/identity';
import { HandleString, INVALID_HANDLE } from '@atproto/syntax';
import { AppContext } from '../../../../context.js';
import { assertRepoAvailability } from '../sync/util.js';

export default function (
  ctx: AppContext,
): XrpcQueryHandlerOptions<ComAtprotoRepoDescribeRepo.mainSchema> {
  return {
    lxm: ComAtprotoRepoDescribeRepo.mainSchema,
    handler: async ({ params }) => {
      const { repo } = params;

      const account = await assertRepoAvailability(ctx, repo, false);

      let didDoc: id.DidDocument;
      try {
        didDoc = await ctx.idResolver.did.ensureResolve(account.did);
      } catch (err) {
        throw new InvalidRequestError({
          message: `Could not resolve DID: ${err}`,
        });
      }

      const handle = id.getHandle(didDoc);
      const handleIsCorrect = handle === account.handle;

      const collections = await ctx.actorStore.read(account.did, (store) =>
        store.record.listCollections(),
      );

      return json({
        handle: (account.handle ?? INVALID_HANDLE) as HandleString,
        did: account.did,
        didDoc,
        collections,
        handleIsCorrect,
      });
    },
  };
}
