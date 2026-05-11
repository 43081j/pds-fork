import { ComAtprotoSyncSubscribeRepos } from '@atcute/atproto';
import {
  type SubscriptionConfig,
  XRPCSubscriptionError,
} from '@atcute/xrpc-server';
import type { AppContext } from '../../../../context.js';
import { httpLogger } from '../../../../logger.js';
import { Outbox } from '../../../../sequencer/outbox.js';

type SubscribeReposHandlerOptions = {
  lxm: ComAtprotoSyncSubscribeRepos.mainSchema;
} & SubscriptionConfig<ComAtprotoSyncSubscribeRepos.mainSchema>;

export default function (ctx: AppContext): SubscribeReposHandlerOptions {
  return {
    lxm: ComAtprotoSyncSubscribeRepos.mainSchema,
    handler: async function* ({ params, signal }) {
      const { cursor } = params;
      const outbox = new Outbox(ctx.sequencer, {
        maxBufferSize: ctx.cfg.subscription.maxBuffer,
      });
      httpLogger.info({ cursor }, 'request to com.atproto.sync.subscribeRepos');

      const backfillTime = new Date(
        Date.now() - ctx.cfg.subscription.repoBackfillLimitMs,
      ).toISOString();
      let outboxCursor: number | undefined = undefined;
      if (cursor !== undefined) {
        const [next, curr] = await Promise.all([
          ctx.sequencer.next(cursor),
          ctx.sequencer.curr(),
        ]);
        if (cursor > (curr ?? 0)) {
          throw new XRPCSubscriptionError({
            error: 'FutureCursor',
            message: 'Cursor in the future.',
          });
        } else if (next && next.sequencedAt < backfillTime) {
          // if cursor is before backfill time, find earliest cursor from backfill window
          yield {
            $type: 'com.atproto.sync.subscribeRepos#info',
            name: 'OutdatedCursor',
            message: 'Requested cursor exceeded limit. Possibly missing events',
          } satisfies ComAtprotoSyncSubscribeRepos.Info;
          const startEvt = await ctx.sequencer.earliestAfterTime(backfillTime);
          outboxCursor = startEvt?.seq ? startEvt.seq - 1 : undefined;
        } else {
          outboxCursor = cursor;
        }
      }

      for await (const evt of outbox.events(outboxCursor, signal)) {
        if (evt.type === 'commit') {
          yield {
            $type: 'com.atproto.sync.subscribeRepos#commit',
            seq: evt.seq,
            time: evt.time,
            ...evt.evt,
          } satisfies ComAtprotoSyncSubscribeRepos.Commit;
        } else if (evt.type === 'sync') {
          yield {
            $type: 'com.atproto.sync.subscribeRepos#sync',
            seq: evt.seq,
            time: evt.time,
            ...evt.evt,
          } satisfies ComAtprotoSyncSubscribeRepos.Sync;
        } else if (evt.type === 'identity') {
          yield {
            $type: 'com.atproto.sync.subscribeRepos#identity',
            seq: evt.seq,
            time: evt.time,
            ...evt.evt,
          } satisfies ComAtprotoSyncSubscribeRepos.Identity;
        } else if (evt.type === 'account') {
          yield {
            $type: 'com.atproto.sync.subscribeRepos#account',
            seq: evt.seq,
            time: evt.time,
            ...evt.evt,
          } satisfies ComAtprotoSyncSubscribeRepos.Account;
        }
      }
    },
  };
}
