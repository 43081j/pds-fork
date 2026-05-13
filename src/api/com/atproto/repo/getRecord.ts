import { ComAtprotoRepoGetRecord } from '@atcute/atproto';
import {
  type XrpcQueryHandlerOptions,
  InternalServerError,
  InvalidRequestError,
  json,
} from '@atcute/xrpc-server';
import { AtUri } from '@atproto/syntax';
import { AppContext } from '../../../../context.js';

export default function (
  ctx: AppContext,
): XrpcQueryHandlerOptions<ComAtprotoRepoGetRecord.mainSchema> {
  return {
    lxm: ComAtprotoRepoGetRecord.mainSchema,
    handler: async ({ params }) => {
      const { repo, collection, rkey, cid } = params;
      const did = await ctx.accountManager.getDidForActor(repo);

      // fetch from pds if available, if not then fetch from appview
      if (did) {
        const uri = AtUri.make(did, collection, rkey);
        const record = await ctx.actorStore.read(did, (store) =>
          store.record.getRecord(uri, cid ?? null),
        );
        if (!record || record.takedownRef !== null) {
          throw new InvalidRequestError({
            message: `Could not locate record: ${uri}`,
            error: 'RecordNotFound',
          });
        }
        return json({
          uri: uri.toString(),
          cid: record.cid,
          value: record.value,
        });
      }

      if (!ctx.cfg.bskyAppView) {
        throw new InvalidRequestError({ message: `Could not locate record` });
      }

      // TODO: re-add appview pipethrough once src/pipethrough.ts is migrated
      // to a Web Request-native signature.
      throw new InternalServerError({
        message: 'AppView pipethrough not yet wired in atcute migration',
      });
    },
  };
}
