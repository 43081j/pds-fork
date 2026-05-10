import { ComAtprotoServerDeactivateAccount } from '@atcute/atproto';
import { ok as ensureOk } from '@atcute/client';
import {
  type XrpcProcedureHandlerOptions,
  ForbiddenError,
} from '@atcute/xrpc-server';
import { ACCESS_FULL } from '../../../../auth-scope.js';
import { AppContext } from '../../../../context.js';

export default function (
  ctx: AppContext,
): XrpcProcedureHandlerOptions<ComAtprotoServerDeactivateAccount.mainSchema> {
  const verifier = ctx.authVerifier.authorization({
    additional: ['com.atproto.takendown'],
    scopes: ACCESS_FULL,
    authorize: () => {
      throw new ForbiddenError({
        message: 'OAuth credentials are not supported for this endpoint',
      });
    },
  });

  return {
    lxm: ComAtprotoServerDeactivateAccount.mainSchema,
    handler: async ({ request, input }) => {
      const responseHeaders = new Headers();
      const auth = await verifier({
        request,
        responseHeaders,
        params: {},
      });

      if (ctx.entrywayClient) {
        // in the case of entryway, the full flow is deactivateAccount (PDS) ->
        // deactivateAccount (Entryway) -> updateSubjectStatus (PDS)
        const { headers } = ctx.entrywayPassthruHeaders(request);
        await ensureOk(
          ctx.entrywayClient.post('com.atproto.server.deactivateAccount', {
            headers,
            input,
            as: null,
          }),
        );
      } else {
        const requester = auth.credentials.did;
        await ctx.accountManager.deactivateAccount(
          requester,
          input.deleteAfter ?? null,
        );
        const status = await ctx.accountManager.getAccountStatus(requester);
        await ctx.sequencer.sequenceAccountEvt(requester, status);
      }

      return new Response(null, { status: 200, headers: responseHeaders });
    },
  };
}
