import { ComAtprotoIdentityResolveHandle } from '@atcute/atproto';
import { ok as ensureOk } from '@atcute/client';
import { type Did, isDid } from '@atcute/lexicons/syntax';
import {
  type XrpcQueryHandlerOptions,
  InvalidRequestError,
  json,
} from '@atcute/xrpc-server';
import { AppContext } from '../../../../context.js';
import { baseNormalizeAndValidate } from '../../../../handle/index.js';

export default function (
  ctx: AppContext,
): XrpcQueryHandlerOptions<ComAtprotoIdentityResolveHandle.mainSchema> {
  return {
    lxm: ComAtprotoIdentityResolveHandle.mainSchema,
    handler: async ({ params }) => {
      const handle = baseNormalizeAndValidate(params.handle);

      const user = await ctx.accountManager.getAccount(handle);
      if (user) {
        return json({ did: asDid(user.did) });
      }

      const supportedHandle = ctx.cfg.identity.serviceHandleDomains.some(
        (host) => handle.endsWith(host) || handle === host.slice(1),
      );
      // this should be in our DB & we couldn't find it, so fail
      if (supportedHandle) {
        throw new InvalidRequestError({ message: 'Unable to resolve handle' });
      }

      const did: Did = ctx.bskyAppView
        ? await ensureOk(
            ctx.bskyAppView.client.get('com.atproto.identity.resolveHandle', {
              params: { handle },
            }),
          ).then((r) => r.did, throwInvalidRequestError)
        : await ctx.idResolver.handle
            .resolve(handle)
            .then(
              (v) => (v && isDid(v) ? v : throwInvalidRequestError()),
              throwInvalidRequestError,
            );

      return json({ did });
    },
  };
}

function asDid(value: string): Did {
  if (!isDid(value)) {
    throw new InvalidRequestError({ message: 'Unable to resolve handle' });
  }
  return value;
}

function throwInvalidRequestError(): never {
  throw new InvalidRequestError({ message: 'Unable to resolve handle' });
}
