import { Readable } from 'node:stream';
import { ComAtprotoRepoUploadBlob } from '@atcute/atproto';
import {
  type XrpcProcedureHandlerOptions,
  InvalidRequestError,
  UpstreamTimeoutError,
  json,
} from '@atcute/xrpc-server';
import { AppContext } from '../../../../context.js';

export default function (
  ctx: AppContext,
): XrpcProcedureHandlerOptions<ComAtprotoRepoUploadBlob.mainSchema> {
  const verifier = ctx.authVerifier.authorizationOrUserServiceAuth({
    checkTakedown: true,
    authorize: (permissions, { request }) => {
      const encoding = parseRequestEncoding(request);
      permissions.assertBlob({ mime: encoding });
    },
  });

  // TODO: re-add per-day rate limit (durationMs: DAY, points: 1000) once
  // XRPCRouter middleware is wired up.

  return {
    lxm: ComAtprotoRepoUploadBlob.mainSchema,
    handler: async ({ request }) => {
      const responseHeaders = new Headers();
      const auth = await verifier({
        request,
        responseHeaders,
        params: {},
      });

      const requester = auth.credentials.did;
      const encoding = parseRequestEncoding(request);
      if (!request.body) {
        throw new InvalidRequestError({ message: 'Missing request body' });
      }
      const bodyStream = Readable.fromWeb(
        request.body as Parameters<typeof Readable.fromWeb>[0],
      );

      const blob = await ctx.actorStore.writeNoTransaction(
        requester,
        async (store) => {
          const metadata = await store.repo.blob
            .uploadBlobAndGetMetadata(encoding, bodyStream)
            .catch(throwAbortAsUpstreamError);

          return store.transact(async (actorTxn) => {
            const blobRef =
              await actorTxn.repo.blob.trackUntetheredBlob(metadata);

            // make the blob permanent if an associated record is already indexed
            if (await actorTxn.repo.blob.hasRecordsForBlob(blobRef.ref)) {
              await actorTxn.repo.blob.verifyBlobAndMakePermanent(blobRef);
            }

            return blobRef;
          });
        },
      );

      return json({ blob }, { headers: responseHeaders });
    },
  };
}

function parseRequestEncoding(request: Request): string {
  const contentType = request.headers.get('content-type');
  if (!contentType) {
    throw new InvalidRequestError({ message: 'Missing content-type header' });
  }
  // strip parameters (e.g. "; charset=utf-8")
  return contentType.split(';')[0].trim();
}

function throwAbortAsUpstreamError(err: unknown): never {
  if ((err as { name?: string })?.name === 'AbortError') {
    throw new UpstreamTimeoutError({
      message: 'Operation timed out, please try again.',
    });
  }
  throw err;
}
