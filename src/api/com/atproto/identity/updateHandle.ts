import { ComAtprotoIdentityUpdateHandle } from '@atcute/atproto';
import { ok as ensureOk } from '@atcute/client';
import {
  type XrpcProcedureHandlerOptions,
  InvalidRequestError,
} from '@atcute/xrpc-server';
import { AppContext } from '../../../../context.js';
import { httpLogger } from '../../../../logger.js';

// TODO: rate limiting (was 10/5min + 50/day per did) - needs router-level
// middleware in the new XRPCRouter setup.

export default function (
  ctx: AppContext,
): XrpcProcedureHandlerOptions<ComAtprotoIdentityUpdateHandle.mainSchema> {
  const verifier = ctx.authVerifier.authorization({
    checkTakedown: true,
    authorize: (permissions) => {
      permissions.assertIdentity({ attr: 'handle' });
    },
  });

  return {
    lxm: ComAtprotoIdentityUpdateHandle.mainSchema,
    handler: async ({ request, input }) => {
      const responseHeaders = new Headers();
      const auth = await verifier({
        request,
        responseHeaders,
        params: {},
      });

      const requester = auth.credentials.did;

      if (ctx.entrywayClient) {
        const { headers } = await ctx.entrywayAuthHeaders(
          request,
          requester,
          'com.atproto.identity.updateHandle',
        );
        // the full flow is:
        // -> entryway(identity.updateHandle) [update handle, submit plc op]
        // -> pds(admin.updateAccountHandle)  [track handle, sequence handle update]
        await ensureOk(
          ctx.entrywayClient.post('com.atproto.identity.updateHandle', {
            headers,
            input: {
              handle: input.handle,
              // "did" is not in the schema; entryway accepts it as an
              // optional override for the subject did.
              did: requester,
            },
            as: null,
          }),
        );
        return new Response(null, { status: 200, headers: responseHeaders });
      }

      const handle = await ctx.accountManager.normalizeAndValidateHandle(
        input.handle,
        { did: requester },
      );

      // Pessimistic check to handle spam: also enforced by updateHandle() and the db.
      const account = await ctx.accountManager.getAccount(handle, {
        includeDeactivated: true,
      });

      if (!account) {
        if (requester.startsWith('did:plc:')) {
          await ctx.plcClient.updateHandle(
            requester,
            ctx.plcRotationKey,
            handle,
          );
        } else {
          const resolved = await ctx.idResolver.did.resolveAtprotoData(
            requester,
            true,
          );
          if (resolved.handle !== handle) {
            throw new InvalidRequestError({
              message: 'DID is not properly configured for handle',
            });
          }
        }
        await ctx.accountManager.updateHandle(requester, handle);
      } else {
        // if we found an account with matching handle, check if it is the same as requester
        // if so emit an identity event, otherwise error.
        if (account.did !== requester) {
          throw new InvalidRequestError({
            message: `Handle already taken: ${handle}`,
          });
        }
      }

      try {
        await ctx.sequencer.sequenceIdentityEvt(requester, handle);
      } catch (err) {
        httpLogger.error(
          { err, did: requester, handle },
          'failed to sequence handle update',
        );
      }

      return new Response(null, { status: 200, headers: responseHeaders });
    },
  };
}
