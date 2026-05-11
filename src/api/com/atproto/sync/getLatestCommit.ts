import { ComAtprotoSyncGetLatestCommit } from '@atcute/atproto';
import {
  type XrpcQueryHandlerOptions,
  InvalidRequestError,
  json,
} from '@atcute/xrpc-server';
import { isUserOrAdmin } from '../../../../auth-verifier.js';
import type { AppContext } from '../../../../context.js';
import { assertRepoAvailability } from './util.js';

export default function (
  ctx: AppContext,
): XrpcQueryHandlerOptions<ComAtprotoSyncGetLatestCommit.mainSchema> {
  const verifier = ctx.authVerifier.authorizationOrAdminTokenOptional({
    authorize: () => {
      // always allow
    },
  });

  return {
    lxm: ComAtprotoSyncGetLatestCommit.mainSchema,
    handler: async ({ request, params }) => {
      const responseHeaders = new Headers();
      const auth = await verifier({
        request,
        responseHeaders,
        params: {},
      });

      const { did } = params;
      await assertRepoAvailability(ctx, did, isUserOrAdmin(auth, did));

      const root = await ctx.actorStore.read(did, (store) =>
        store.repo.storage.getRootDetailed(),
      );
      if (root === null) {
        throw new InvalidRequestError({
          error: 'RepoNotFound',
          message: `Could not find root for DID: ${did}`,
        });
      }
      return json(
        {
          cid: root.cid.toString(),
          rev: root.rev,
        },
        { headers: responseHeaders },
      );
    },
  };
}
