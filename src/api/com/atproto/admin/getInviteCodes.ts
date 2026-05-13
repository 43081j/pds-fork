import { ComAtprotoAdminGetInviteCodes } from '@atcute/atproto';
import {
  type XrpcQueryHandlerOptions,
  InvalidRequestError,
  json,
} from '@atcute/xrpc-server';
import {
  CodeDetail,
  selectInviteCodesQb,
} from '../../../../account-manager/helpers/invite.js';
import { AppContext } from '../../../../context.js';
import {
  Cursor,
  GenericKeyset,
  LabeledResult,
  paginate,
} from '../../../../db/pagination.js';

export default function (
  ctx: AppContext,
): XrpcQueryHandlerOptions<ComAtprotoAdminGetInviteCodes.mainSchema> {
  const verifier = ctx.authVerifier.moderator;

  return {
    lxm: ComAtprotoAdminGetInviteCodes.mainSchema,
    handler: async ({ request, params }) => {
      const responseHeaders = new Headers();
      await verifier({ request, responseHeaders, params });

      if (ctx.cfg.entryway) {
        throw new InvalidRequestError({
          message: 'Account invites are managed by the entryway service',
        });
      }

      const { sort, limit, cursor } = params;
      const db = ctx.accountManager.db;
      const keyset = createKeyset(ctx, sort);

      const builder = selectInviteCodesQb(db);

      const res = await paginate(builder, {
        limit,
        cursor,
        keyset,
      }).execute();

      const codes = res.map((row) => row.code);
      const uses = await ctx.accountManager.getInviteCodesUses(codes);

      const resultCursor = keyset.packFromResult(res);
      const codeDetails = res.map(
        ({ disabled, createdAt, ...row }): CodeDetail => ({
          ...row,
          createdAt,
          disabled: disabled === 1,
          uses: uses[row.code] ?? [],
        }),
      );

      return json(
        {
          cursor: resultCursor,
          codes: codeDetails,
        },
        { headers: responseHeaders },
      );
    },
  };
}

function createKeyset(ctx: AppContext, sort?: string): GenericKeyset<any, any> {
  const { ref } = ctx.accountManager.db.db.dynamic;

  if (sort === 'recent') {
    return new TimeCodeKeyset(ref('createdAt'), ref('code'));
  }

  if (sort === 'usage') {
    return new UseCodeKeyset(ref('uses'), ref('code'));
  }

  throw new InvalidRequestError({ message: `unknown sort method: ${sort}` });
}

type TimeCodeResult = { createdAt: string; code: string };

export class TimeCodeKeyset extends GenericKeyset<TimeCodeResult, Cursor> {
  labelResult(result: TimeCodeResult): Cursor {
    return { primary: result.createdAt, secondary: result.code };
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

type UseCodeResult = { uses: number; code: string };

export class UseCodeKeyset extends GenericKeyset<UseCodeResult, LabeledResult> {
  labelResult(result: UseCodeResult): LabeledResult {
    return { primary: result.uses, secondary: result.code };
  }
  labeledResultToCursor(labeled: Cursor) {
    return {
      primary: labeled.primary.toString(),
      secondary: labeled.secondary,
    };
  }
  cursorToLabeledResult(cursor: Cursor) {
    const primaryCode = parseInt(cursor.primary, 10);
    if (isNaN(primaryCode)) {
      throw new InvalidRequestError({ message: 'Malformed cursor' });
    }
    return {
      primary: primaryCode,
      secondary: cursor.secondary,
    };
  }
}
