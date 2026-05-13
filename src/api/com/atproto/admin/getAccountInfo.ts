import { ComAtprotoAdminGetAccountInfo } from '@atcute/atproto';
import {
  type XrpcQueryHandlerOptions,
  InvalidRequestError,
  json,
} from '@atcute/xrpc-server';
import { AppContext } from '../../../../context.js';
import { formatAccountInfo } from './util.js';

export default function (
  ctx: AppContext,
): XrpcQueryHandlerOptions<ComAtprotoAdminGetAccountInfo.mainSchema> {
  const verifier = ctx.authVerifier.moderator;

  return {
    lxm: ComAtprotoAdminGetAccountInfo.mainSchema,
    handler: async ({ request, params }) => {
      const responseHeaders = new Headers();
      await verifier({ request, responseHeaders, params });

      const [account, invites, invitedBy] = await Promise.all([
        ctx.accountManager.getAccount(params.did, {
          includeDeactivated: true,
          includeTakenDown: true,
        }),
        ctx.accountManager.getAccountInvitesCodes(params.did),
        ctx.accountManager.getInvitedByForAccounts([params.did]),
      ]);
      if (!account) {
        throw new InvalidRequestError({
          message: 'Account not found',
          error: 'NotFound',
        });
      }
      const managesOwnInvites = !ctx.cfg.entryway;
      return json(
        formatAccountInfo(account, {
          managesOwnInvites,
          invitedBy,
          invites,
        }),
        { headers: responseHeaders },
      );
    },
  };
}
