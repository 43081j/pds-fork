import { ComAtprotoAdminGetAccountInfos } from '@atcute/atproto';
import { type XrpcQueryHandlerOptions, json } from '@atcute/xrpc-server';
import { AppContext } from '../../../../context.js';
import { formatAccountInfo } from './util.js';

export default function (
  ctx: AppContext,
): XrpcQueryHandlerOptions<ComAtprotoAdminGetAccountInfos.mainSchema> {
  const verifier = ctx.authVerifier.moderator;

  return {
    lxm: ComAtprotoAdminGetAccountInfos.mainSchema,
    handler: async ({ request, params }) => {
      const responseHeaders = new Headers();
      await verifier({ request, responseHeaders, params });

      const [accounts, invites, invitedBy] = await Promise.all([
        ctx.accountManager.getAccounts(params.dids, {
          includeDeactivated: true,
          includeTakenDown: true,
        }),
        ctx.accountManager.getAccountsInvitesCodes(params.dids),
        ctx.accountManager.getInvitedByForAccounts(params.dids),
      ]);

      const managesOwnInvites = !ctx.cfg.entryway;
      const infos = Array.from(accounts.values()).map((account) => {
        return formatAccountInfo(account, {
          managesOwnInvites,
          invitedBy,
          invites,
        });
      });

      return json({ infos }, { headers: responseHeaders });
    },
  };
}
