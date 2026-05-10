import { ComAtprotoServerDeleteAccount } from '@atcute/atproto';
import { ok as ensureOk } from '@atcute/client';
import {
  type XrpcProcedureHandlerOptions,
  AuthRequiredError,
  InvalidRequestError,
} from '@atcute/xrpc-server';
import { OLD_PASSWORD_MAX_LENGTH } from '../../../../account-manager/helpers/scrypt.js';
import { AppContext } from '../../../../context.js';

// TODO: rate limiting (was 50/5min) - needs router-level middleware.

export default function (
  ctx: AppContext,
): XrpcProcedureHandlerOptions<ComAtprotoServerDeleteAccount.mainSchema> {
  return {
    lxm: ComAtprotoServerDeleteAccount.mainSchema,
    handler: async ({ request, input }) => {
      const { did, password, token } = input;

      const account = await ctx.accountManager.getAccount(did, {
        includeDeactivated: true,
        includeTakenDown: true,
      });
      if (!account) {
        throw new InvalidRequestError({ message: 'account not found' });
      }

      if (ctx.entrywayClient) {
        const { headers } = ctx.entrywayPassthruHeaders(request);
        await ensureOk(
          ctx.entrywayClient.post('com.atproto.server.deleteAccount', {
            input,
            headers,
            as: null,
          }),
        );
        return new Response(null, { status: 200 });
      }

      if (password.length > OLD_PASSWORD_MAX_LENGTH) {
        throw new InvalidRequestError({ message: 'Invalid password length.' });
      }

      const validPass = await ctx.accountManager.verifyAccountPassword(
        did,
        password,
      );
      if (!validPass) {
        throw new AuthRequiredError({ message: 'Invalid did or password' });
      }

      await ctx.accountManager.assertValidEmailToken(
        did,
        'delete_account',
        token,
      );
      await ctx.actorStore.destroy(did);
      await ctx.accountManager.deleteAccount(did);
      const accountSeq = await ctx.sequencer.sequenceAccountEvt(did, 'deleted');
      await ctx.sequencer.deleteAllForUser(did, [accountSeq]);

      return new Response(null, { status: 200 });
    },
  };
}
