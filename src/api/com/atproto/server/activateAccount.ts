import { ComAtprotoServerActivateAccount } from '@atcute/atproto';
import { ok as ensureOk } from '@atcute/client';
import {
  type XrpcProcedureHandlerOptions,
  ForbiddenError,
  InvalidRequestError,
} from '@atcute/xrpc-server';
import { INVALID_HANDLE } from '@atproto/syntax';
import { ACCESS_FULL } from '../../../../auth-scope.js';
import { AppContext } from '../../../../context.js';
import { assertValidDidDocumentForService } from './util.js';

export default function (
  ctx: AppContext,
): XrpcProcedureHandlerOptions<ComAtprotoServerActivateAccount.mainSchema> {
  const verifier = ctx.authVerifier.authorization({
    scopes: ACCESS_FULL,
    authorize: () => {
      throw new ForbiddenError({
        message: 'OAuth credentials are not supported for this endpoint',
      });
    },
  });

  return {
    lxm: ComAtprotoServerActivateAccount.mainSchema,
    handler: async ({ request }) => {
      const responseHeaders = new Headers();
      const auth = await verifier({
        request,
        responseHeaders,
        params: {},
      });

      // in the case of entryway, the full flow is activateAccount (PDS) ->
      // activateAccount (Entryway) -> updateSubjectStatus (PDS)
      if (ctx.entrywayClient) {
        const { headers } = ctx.entrywayPassthruHeaders(request);
        await ensureOk(
          ctx.entrywayClient.post('com.atproto.server.activateAccount', {
            headers,
            as: null,
          }),
        );
      } else {
        const requester = auth.credentials.did;

        await assertValidDidDocumentForService(ctx, requester);

        const account = await ctx.accountManager.getAccount(requester, {
          includeDeactivated: true,
        });
        if (!account) {
          throw new InvalidRequestError({
            message: 'user not found',
            error: 'AccountNotFound',
          });
        }

        await ctx.accountManager.activateAccount(requester);

        const syncData = await ctx.actorStore.read(requester, (store) =>
          store.repo.getSyncEventData(),
        );

        // @NOTE: we're over-emitting for now for backwards compatibility, can reduce this in the future
        const status = await ctx.accountManager.getAccountStatus(requester);
        await ctx.sequencer.sequenceAccountEvt(requester, status);
        await ctx.sequencer.sequenceIdentityEvt(
          requester,
          account.handle ?? INVALID_HANDLE,
        );
        await ctx.sequencer.sequenceSyncEvt(requester, syncData);
      }

      return new Response(null, { status: 200, headers: responseHeaders });
    },
  };
}
