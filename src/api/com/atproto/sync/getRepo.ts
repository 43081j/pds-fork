import { Readable } from 'node:stream';
import { ComAtprotoSyncGetRepo } from '@atcute/atproto';
import {
  type XrpcQueryHandlerOptions,
  InvalidRequestError,
} from '@atcute/xrpc-server';
import { byteIterableToStream } from '@atproto/common';
import {
  RepoRootNotFoundError,
  SqlRepoReader,
} from '../../../../actor-store/repo/sql-repo-reader.js';
import { isUserOrAdmin } from '../../../../auth-verifier.js';
import type { AppContext } from '../../../../context.js';
import { assertRepoAvailability } from './util.js';

export default function (
  ctx: AppContext,
): XrpcQueryHandlerOptions<ComAtprotoSyncGetRepo.mainSchema> {
  const verifier = ctx.authVerifier.authorizationOrAdminTokenOptional({
    additional: ['com.atproto.takendown'],
    authorize: () => {
      // always allow
    },
  });

  return {
    lxm: ComAtprotoSyncGetRepo.mainSchema,
    handler: async ({ request, params }) => {
      const responseHeaders = new Headers();
      const auth = await verifier({
        request,
        responseHeaders,
        params: {},
      });

      const { did, since } = params;
      await assertRepoAvailability(ctx, did, isUserOrAdmin(auth, did));

      const carStream = await getCarStream(ctx, did, since);

      responseHeaders.set('content-type', 'application/vnd.ipld.car');
      const body = Readable.toWeb(carStream) as ReadableStream<Uint8Array>;
      return new Response(body, { headers: responseHeaders });
    },
  };
}

export const getCarStream = async (
  ctx: AppContext,
  did: string,
  since?: string,
): Promise<Readable> => {
  const actorDb = await ctx.actorStore.openDb(did);
  let carStream: Readable;
  try {
    const storage = new SqlRepoReader(actorDb);
    const carIter = await storage.getCarStream(since);
    carStream = byteIterableToStream(carIter);
  } catch (err) {
    await actorDb.close();
    if (err instanceof RepoRootNotFoundError) {
      throw new InvalidRequestError({
        message: `Could not find repo for DID: ${did}`,
      });
    }
    throw err;
  }
  const closeDb = () => actorDb.close();
  carStream.on('error', closeDb);
  carStream.on('close', closeDb);
  return carStream;
};
