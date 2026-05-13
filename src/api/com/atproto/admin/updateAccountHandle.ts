import { ComAtprotoAdminUpdateAccountHandle } from '@atcute/atproto';
import {
  type XrpcProcedureHandlerOptions,
  InvalidRequestError,
} from '@atcute/xrpc-server';
import { AppContext } from '../../../../context.js';
import { httpLogger } from '../../../../logger.js';

export default function (
  ctx: AppContext,
): XrpcProcedureHandlerOptions<ComAtprotoAdminUpdateAccountHandle.mainSchema> {
  const adminToken = ctx.authVerifier.adminToken;

  return {
    lxm: ComAtprotoAdminUpdateAccountHandle.mainSchema,
    handler: async ({ request, input }) => {
      const responseHeaders = new Headers();
      await adminToken({ request, responseHeaders, params: {} });

      const { did } = input;
      const handle = await ctx.accountManager.normalizeAndValidateHandle(
        input.handle,
        {
          did,
          allowAnyValid: true,
        },
      );

      // Pessimistic check to handle spam: also enforced by updateHandle() and the db.
      const account = await ctx.accountManager.getAccount(handle, {
        includeDeactivated: true,
        includeTakenDown: true,
      });

      if (account) {
        if (account.did !== did) {
          throw new InvalidRequestError({
            message: `Handle already taken: ${handle}`,
          });
        }
      } else {
        if (ctx.cfg.entryway) {
          // the pds defers to the entryway for updating the handle in the user's did doc.
          // here was just check that the handle is already bidirectionally confirmed.
          // @TODO if handle is taken according to this PDS, should we force-update?
          const doc = await ctx.idResolver.did
            .resolveAtprotoData(did, true)
            .catch(() => undefined);
          if (doc?.handle !== handle) {
            throw new InvalidRequestError({
              message: 'Handle does not match DID doc',
            });
          }
        } else {
          await ctx.plcClient.updateHandle(did, ctx.plcRotationKey, handle);
        }
        await ctx.accountManager.updateHandle(did, handle);
      }

      try {
        await ctx.sequencer.sequenceIdentityEvt(did, handle);
      } catch (err) {
        httpLogger.error(
          { err, did, handle },
          'failed to sequence handle update',
        );
      }

      return new Response(null, { status: 200, headers: responseHeaders });
    },
  };
}
