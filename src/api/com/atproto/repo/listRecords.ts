import { ComAtprotoRepoListRecords } from '@atcute/atproto';
import {
  type XrpcQueryHandlerOptions,
  InvalidRequestError,
  json,
} from '@atcute/xrpc-server';
import { AtUri } from '@atproto/syntax';
import { AppContext } from '../../../../context.js';

export default function (
  ctx: AppContext,
): XrpcQueryHandlerOptions<ComAtprotoRepoListRecords.mainSchema> {
  return {
    lxm: ComAtprotoRepoListRecords.mainSchema,
    handler: async ({ params }) => {
      const { repo, collection, limit = 50, cursor, reverse = false } = params;

      const did = await ctx.accountManager.getDidForActor(repo);
      if (!did) {
        throw new InvalidRequestError({
          message: `Could not find repo: ${repo}`,
        });
      }

      const records = await ctx.actorStore.read(did, (store) =>
        store.record.listRecordsForCollection({
          collection,
          limit,
          reverse,
          cursor,
        }),
      );

      const lastRecord = records.at(-1);
      const lastUri = lastRecord && new AtUri(lastRecord?.uri);

      return json({
        records,
        cursor: lastUri?.rkey,
      });
    },
  };
}
