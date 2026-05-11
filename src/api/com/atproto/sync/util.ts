import { InvalidRequestError } from '@atcute/xrpc-server';
import { AtIdentifierString } from '@atproto/syntax';
import { ActorAccount } from '../../../../account-manager/helpers/account.js';
import type { AppContext } from '../../../../context.js';

export const assertRepoAvailability = async (
  ctx: AppContext,
  handleOrDid: AtIdentifierString,
  isAdminOrSelf: boolean,
): Promise<ActorAccount> => {
  const account = await ctx.accountManager.getAccount(handleOrDid, {
    includeDeactivated: true,
    includeTakenDown: true,
  });
  if (!account) {
    throw new InvalidRequestError({
      error: 'RepoNotFound',
      message: `Could not find repo for DID: ${handleOrDid}`,
    });
  }
  if (isAdminOrSelf) {
    return account;
  }
  if (account.takedownRef) {
    throw new InvalidRequestError({
      error: 'RepoTakendown',
      message: `Repo has been takendown: ${handleOrDid}`,
    });
  }
  if (account.deactivatedAt) {
    throw new InvalidRequestError({
      error: 'RepoDeactivated',
      message: `Repo has been deactivated: ${handleOrDid}`,
    });
  }
  return account;
};
