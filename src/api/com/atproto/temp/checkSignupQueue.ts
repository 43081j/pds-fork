import { ComAtprotoTempCheckSignupQueue } from '@atcute/atproto';
import { ok as ensureOk } from '@atcute/client';
import {
  type XrpcQueryHandlerOptions,
  ForbiddenError,
  json,
} from '@atcute/xrpc-server';
import type { AppContext } from '../../../../context.js';

// THIS IS A TEMPORARY UNSPECCED ROUTE
export default function (
  ctx: AppContext,
): XrpcQueryHandlerOptions<ComAtprotoTempCheckSignupQueue.mainSchema> {
  const verifier = ctx.authVerifier.authorization({
    additional: ['com.atproto.signupQueued'],
    authorize: () => {
      throw new ForbiddenError({
        message: 'OAuth credentials are not supported for this endpoint',
      });
    },
  });

  return {
    lxm: ComAtprotoTempCheckSignupQueue.mainSchema,
    handler: async ({ request }) => {
      const responseHeaders = new Headers();
      await verifier({
        request,
        responseHeaders,
        params: {},
      });

      if (!ctx.entrywayClient) {
        return json({ activated: true }, { headers: responseHeaders });
      }

      const { headers } = ctx.entrywayPassthruHeaders(request);
      const body = await ensureOk(
        ctx.entrywayClient.get('com.atproto.temp.checkSignupQueue', {
          headers,
        }),
      );
      return json(body, { headers: responseHeaders });
    },
  };
}
