import { ComAtprotoAdminDefs } from '@atcute/atproto';
import { Did, Datetime, Handle } from '@atcute/lexicons/syntax';
import { INVALID_HANDLE } from '@atproto/syntax';
import { ActorAccount } from '../../../../account-manager/helpers/account.js';
import { CodeDetail } from '../../../../account-manager/helpers/invite.js';

export function formatAccountInfo(
  account: ActorAccount,
  {
    managesOwnInvites,
    invitedBy,
    invites,
  }: {
    managesOwnInvites: boolean;
    invites: Map<string, CodeDetail[]> | CodeDetail[];
    invitedBy: Record<string, CodeDetail>;
  },
): ComAtprotoAdminDefs.AccountView {
  let invitesResults: CodeDetail[] | undefined;
  if (managesOwnInvites) {
    if (Array.isArray(invites)) {
      invitesResults = invites;
    } else {
      invitesResults = invites.get(account.did) || [];
    }
  }
  return {
    did: account.did as Did,
    handle: (account.handle ?? INVALID_HANDLE) as Handle,
    email: account.email ?? undefined,
    indexedAt: account.createdAt as Datetime,
    emailConfirmedAt:
      (account.emailConfirmedAt as Datetime | undefined) ?? undefined,
    invitedBy: managesOwnInvites ? invitedBy[account.did] : undefined,
    invites: invitesResults,
    invitesDisabled: managesOwnInvites
      ? account.invitesDisabled === 1
      : undefined,
    deactivatedAt: (account.deactivatedAt as Datetime | undefined) ?? undefined,
  };
}
