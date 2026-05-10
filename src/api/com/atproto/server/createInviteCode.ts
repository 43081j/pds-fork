import { ComAtprotoServerCreateInviteCode } from '@atcute/atproto';
import {
  type XrpcProcedureHandlerOptions,
  InvalidRequestError,
  json,
} from '@atcute/xrpc-server';
import { AppContext } from '../../../../context.js';
import { genInvCode } from './util.js';

export default function (
  ctx: AppContext,
): XrpcProcedureHandlerOptions<ComAtprotoServerCreateInviteCode.mainSchema> {
  const adminToken = ctx.authVerifier.adminToken;
  const entrywayConfigured = !!ctx.cfg.entryway;

  return {
    lxm: ComAtprotoServerCreateInviteCode.mainSchema,
    handler: async ({ request, input }) => {
      const responseHeaders = new Headers();
      await adminToken({ request, responseHeaders, params: {} });

      if (entrywayConfigured) {
        throw new InvalidRequestError({
          message: 'Account invites are managed by the entryway service',
        });
      }

      const { useCount, forAccount = 'admin' } = input;

      const code = genInvCode(ctx.cfg);

      await ctx.accountManager.createInviteCodes(
        [{ account: forAccount, codes: [code] }],
        useCount,
      );

      return json({ code }, { headers: responseHeaders });
    },
  };
}
