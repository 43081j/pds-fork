import { Readable } from 'node:stream';
import { ComAtprotoSyncGetRecord } from '@atcute/atproto';
import {
  type XrpcQueryHandlerOptions,
  InvalidRequestError,
} from '@atcute/xrpc-server';
import { byteIterableToStream } from '@atproto/common';
import * as repo from '@atproto/repo';
import { SqlRepoReader } from '../../../../actor-store/repo/sql-repo-reader.js';
import { isUserOrAdmin } from '../../../../auth-verifier.js';
import type { AppContext } from '../../../../context.js';
import { assertRepoAvailability } from './util.js';

export default function (
  ctx: AppContext,
): XrpcQueryHandlerOptions<ComAtprotoSyncGetRecord.mainSchema> {
  const verifier = ctx.authVerifier.authorizationOrAdminTokenOptional({
    authorize: () => {
      // always allow
    },
  });

  return {
    lxm: ComAtprotoSyncGetRecord.mainSchema,
    handler: async ({ request, params }) => {
      const responseHeaders = new Headers();
      const auth = await verifier({
        request,
        responseHeaders,
        params: {},
      });

      const { did, collection, rkey } = params;
      await assertRepoAvailability(ctx, did, isUserOrAdmin(auth, did));

      // must open up the db outside of store interface so that we can close the file handle after finished streaming
      const actorDb = await ctx.actorStore.openDb(did);

      let carStream: Readable;
      try {
        const storage = new SqlRepoReader(actorDb);
        const commit = await storage.getRoot();

        if (!commit) {
          throw new InvalidRequestError({
            message: `Could not find repo for DID: ${did}`,
          });
        }
        const carIter = repo.getRecords(storage, commit, [
          { collection, rkey },
        ]);
        carStream = byteIterableToStream(carIter);
      } catch (err) {
        actorDb.close();
        throw err;
      }
      const closeDb = () => actorDb.close();
      carStream.on('error', closeDb);
      carStream.on('close', closeDb);

      responseHeaders.set('content-type', 'application/vnd.ipld.car');
      const body = Readable.toWeb(carStream) as ReadableStream<Uint8Array>;
      return new Response(body, { headers: responseHeaders });
    },
  };
}
