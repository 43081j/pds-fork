import { ComAtprotoSyncListRepos } from '@atcute/atproto';
import {
  type XrpcQueryHandlerOptions,
  InvalidRequestError,
  json,
} from '@atcute/xrpc-server';
import { formatAccountStatus } from '../../../../account-manager/account-manager.js';
import type { AppContext } from '../../../../context.js';
import { Cursor, GenericKeyset, paginate } from '../../../../db/pagination.js';

export default function (
  ctx: AppContext,
): XrpcQueryHandlerOptions<ComAtprotoSyncListRepos.mainSchema> {
  return {
    lxm: ComAtprotoSyncListRepos.mainSchema,
    handler: async ({ params }) => {
      const { limit, cursor } = params;
      const db = ctx.accountManager.db;
      const { ref } = db.db.dynamic;
      let builder = db.db
        .selectFrom('actor')
        .innerJoin('repo_root', 'repo_root.did', 'actor.did')
        .select([
          'actor.did as did',
          'repo_root.cid as head',
          'repo_root.rev as rev',
          'actor.createdAt as createdAt',
          'actor.deactivatedAt as deactivatedAt',
          'actor.takedownRef as takedownRef',
        ]);
      const keyset = new TimeDidKeyset(
        ref('actor.createdAt'),
        ref('actor.did'),
      );
      builder = paginate(builder, {
        limit,
        cursor,
        keyset,
        direction: 'asc',
        tryIndex: true,
      });
      const res = await builder.execute();
      const repos = res.map((row): ComAtprotoSyncListRepos.Repo => {
        const { active, status } = formatAccountStatus(row);
        return {
          did: row.did as ComAtprotoSyncListRepos.Repo['did'],
          head: row.head as ComAtprotoSyncListRepos.Repo['head'],
          rev: (row.rev ?? '') as ComAtprotoSyncListRepos.Repo['rev'],
          active,
          status,
        };
      });
      return json({
        cursor: keyset.packFromResult(res),
        repos,
      });
    },
  };
}

type TimeDidResult = { createdAt: string; did: string };

export class TimeDidKeyset extends GenericKeyset<TimeDidResult, Cursor> {
  labelResult(result: TimeDidResult): Cursor {
    return { primary: result.createdAt, secondary: result.did };
  }
  labeledResultToCursor(labeled: Cursor) {
    return {
      primary: new Date(labeled.primary).getTime().toString(),
      secondary: labeled.secondary,
    };
  }
  cursorToLabeledResult(cursor: Cursor) {
    const primaryDate = new Date(parseInt(cursor.primary, 10));
    if (isNaN(primaryDate.getTime())) {
      throw new InvalidRequestError({ message: 'Malformed cursor' });
    }
    return {
      primary: primaryDate.toISOString(),
      secondary: cursor.secondary,
    };
  }
}
