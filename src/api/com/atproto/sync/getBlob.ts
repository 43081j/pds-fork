import { Readable } from 'node:stream';
import { ComAtprotoSyncGetBlob } from '@atcute/atproto';
import {
  type XrpcQueryHandlerOptions,
  InvalidRequestError,
} from '@atcute/xrpc-server';
import { parseCid } from '@atproto/lex-data';
import { BlobNotFoundError } from '@atproto/repo';
import { isUserOrAdmin } from '../../../../auth-verifier.js';
import type { AppContext } from '../../../../context.js';
import { assertRepoAvailability } from './util.js';

export default function (
  ctx: AppContext,
): XrpcQueryHandlerOptions<ComAtprotoSyncGetBlob.mainSchema> {
  const verifier = ctx.authVerifier.authorizationOrAdminTokenOptional({
    additional: ['com.atproto.takendown'],
    authorize: () => {
      // always allow
    },
  });

  return {
    lxm: ComAtprotoSyncGetBlob.mainSchema,
    handler: async ({ request, params }) => {
      const responseHeaders = new Headers();
      const auth = await verifier({
        request,
        responseHeaders,
        params: {},
      });

      const { did } = params;
      await assertRepoAvailability(ctx, did, isUserOrAdmin(auth, did));

      const cid = parseCid(params.cid);
      const found = await ctx.actorStore.read(did, async (store) => {
        try {
          return await store.repo.blob.getBlob(cid);
        } catch (err) {
          if (err instanceof BlobNotFoundError) {
            throw new InvalidRequestError({ message: 'Blob not found' });
          } else {
            throw err;
          }
        }
      });
      if (!found) {
        throw new InvalidRequestError({ message: 'Blob not found' });
      }

      responseHeaders.set('content-length', String(found.size));
      responseHeaders.set(
        'content-type',
        found.mimeType || 'application/octet-stream',
      );

      // Important Security headers

      // This prevents the browser from trying to guess the content type
      // and potentially loading the blob as executable code, or rendering it
      // in some other unsafe way.
      responseHeaders.set('x-content-type-options', 'nosniff');

      // This forces the browser to download the blob instead of trying to
      // render it when visiting the URL. This is important to prevent XSS
      // attacks if the blob happens to be HTML. Even if JS is disabled via the
      // CSP header below, a blob could still contain malicious HTML links.
      responseHeaders.set(
        'content-disposition',
        `attachment; filename="${params.cid}"`,
      );

      // This should prevent the browser from executing the blob in any way
      responseHeaders.set(
        'content-security-policy',
        `default-src 'none'; sandbox`,
      );

      const body = Readable.toWeb(found.stream) as ReadableStream<Uint8Array>;
      return new Response(body, { headers: responseHeaders });
    },
  };
}
