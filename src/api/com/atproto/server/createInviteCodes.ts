import { ComAtprotoServerCreateInviteCodes } from '@atcute/atproto';
import {
  type XrpcProcedureHandlerOptions,
  InvalidRequestError,
  json,
} from '@atcute/xrpc-server';
import { AppContext } from '../../../../context.js';
import { genInvCodes } from './util.js';

type AccountCodes = ComAtprotoServerCreateInviteCodes.AccountCodes;

export default function (
  ctx: AppContext,
): XrpcProcedureHandlerOptions<ComAtprotoServerCreateInviteCodes.mainSchema> {
  const adminToken = ctx.authVerifier.adminToken;
  const entrywayConfigured = !!ctx.cfg.entryway;

  return {
    lxm: ComAtprotoServerCreateInviteCodes.mainSchema,
    handler: async ({ request, input }) => {
      const responseHeaders = new Headers();
      await adminToken({ request, responseHeaders, params: {} });

      if (entrywayConfigured) {
        throw new InvalidRequestError({
          message: 'Account invites are managed by the entryway service',
        });
      }

      const { codeCount, useCount } = input;
      const forAccounts = input.forAccounts ?? ['admin'];

      const accountCodes: AccountCodes[] = [];
      for (const account of forAccounts) {
        const codes = genInvCodes(ctx.cfg, codeCount);
        accountCodes.push({ account, codes });
      }
      await ctx.accountManager.createInviteCodes(accountCodes, useCount);

      return json({ codes: accountCodes }, { headers: responseHeaders });
    },
  };
}
