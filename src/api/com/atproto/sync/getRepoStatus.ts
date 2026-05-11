import { ComAtprotoSyncGetRepoStatus } from '@atcute/atproto';
import { type XrpcQueryHandlerOptions, json } from '@atcute/xrpc-server';
import { formatAccountStatus } from '../../../../account-manager/account-manager.js';
import type { AppContext } from '../../../../context.js';
import { assertRepoAvailability } from './util.js';

export default function (
  ctx: AppContext,
): XrpcQueryHandlerOptions<ComAtprotoSyncGetRepoStatus.mainSchema> {
  return {
    lxm: ComAtprotoSyncGetRepoStatus.mainSchema,
    handler: async ({ params }) => {
      const { did } = params;
      const account = await assertRepoAvailability(ctx, did, true);

      const { active, status } = formatAccountStatus(account);

      let rev: string | undefined = undefined;
      if (active) {
        const root = await ctx.actorStore.read(did, (store) =>
          store.repo.storage.getRootDetailed(),
        );
        rev = root.rev;
      }

      return json({
        did,
        active,
        status,
        rev,
      });
    },
  };
}
