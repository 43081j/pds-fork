import { Readable } from 'node:stream';
import { ComAtprotoSyncGetCheckout } from '@atcute/atproto';
import { type XrpcQueryHandlerOptions } from '@atcute/xrpc-server';
import { isUserOrAdmin } from '../../../../../auth-verifier.js';
import type { AppContext } from '../../../../../context.js';
import { getCarStream } from '../getRepo.js';
import { assertRepoAvailability } from '../util.js';

export default function (
  ctx: AppContext,
): XrpcQueryHandlerOptions<ComAtprotoSyncGetCheckout.mainSchema> {
  const verifier = ctx.authVerifier.authorizationOrAdminTokenOptional({
    authorize: () => {
      // always allow
    },
  });

  return {
    lxm: ComAtprotoSyncGetCheckout.mainSchema,
    handler: async ({ request, params }) => {
      const responseHeaders = new Headers();
      const auth = await verifier({
        request,
        responseHeaders,
        params: {},
      });

      const { did } = params;
      await assertRepoAvailability(ctx, did, isUserOrAdmin(auth, did));

      const carStream = await getCarStream(ctx, did);

      responseHeaders.set('content-type', 'application/vnd.ipld.car');
      const body = Readable.toWeb(carStream) as ReadableStream<Uint8Array>;
      return new Response(body, { headers: responseHeaders });
    },
  };
}
