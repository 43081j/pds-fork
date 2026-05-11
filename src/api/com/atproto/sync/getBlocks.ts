import { Readable } from 'node:stream';
import { ComAtprotoSyncGetBlocks } from '@atcute/atproto';
import {
  type XrpcQueryHandlerOptions,
  InvalidRequestError,
} from '@atcute/xrpc-server';
import { byteIterableToStream } from '@atproto/common';
import { parseCid } from '@atproto/lex-data';
import { blocksToCarStream } from '@atproto/repo';
import { isUserOrAdmin } from '../../../../auth-verifier.js';
import type { AppContext } from '../../../../context.js';
import { assertRepoAvailability } from './util.js';

export default function (
  ctx: AppContext,
): XrpcQueryHandlerOptions<ComAtprotoSyncGetBlocks.mainSchema> {
  const verifier = ctx.authVerifier.authorizationOrAdminTokenOptional({
    authorize: () => {
      // always allow
    },
  });

  return {
    lxm: ComAtprotoSyncGetBlocks.mainSchema,
    handler: async ({ request, params }) => {
      const responseHeaders = new Headers();
      const auth = await verifier({
        request,
        responseHeaders,
        params: {},
      });

      const { did } = params;
      await assertRepoAvailability(ctx, did, isUserOrAdmin(auth, did));

      const cids = params.cids.map(parseCid);
      const got = await ctx.actorStore.read(did, (store) =>
        store.repo.storage.getBlocks(cids),
      );
      if (got.missing.length > 0) {
        const missingStr = got.missing.map((c) => c.toString());
        throw new InvalidRequestError({
          message: `Could not find cids: ${missingStr}`,
        });
      }
      const car = blocksToCarStream(null, got.blocks);

      responseHeaders.set('content-type', 'application/vnd.ipld.car');
      const body = Readable.toWeb(
        byteIterableToStream(car),
      ) as ReadableStream<Uint8Array>;
      return new Response(body, { headers: responseHeaders });
    },
  };
}
