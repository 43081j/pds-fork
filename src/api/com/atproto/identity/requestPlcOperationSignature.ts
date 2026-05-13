import { ComAtprotoIdentityRequestPlcOperationSignature } from '@atcute/atproto';
import { ok as ensureOk } from '@atcute/client';
import {
  type XrpcProcedureHandlerOptions,
  InvalidRequestError,
} from '@atcute/xrpc-server';
import { ACCESS_FULL } from '../../../../auth-scope.js';
import { AppContext } from '../../../../context.js';

export default function (
  ctx: AppContext,
): XrpcProcedureHandlerOptions<ComAtprotoIdentityRequestPlcOperationSignature.mainSchema> {
  const verifier = ctx.authVerifier.authorization({
    // @NOTE Reflect any change in signPlcOperation
    scopes: ACCESS_FULL,
    additional: ['com.atproto.takendown'],
    authorize: (permissions) => {
      permissions.assertIdentity({ attr: '*' });
    },
  });

  return {
    lxm: ComAtprotoIdentityRequestPlcOperationSignature.mainSchema,
    handler: async ({ request }) => {
      const responseHeaders = new Headers();
      const auth = await verifier({
        request,
        responseHeaders,
        params: {},
      });

      if (ctx.entrywayClient) {
        const { headers } = await ctx.entrywayAuthHeaders(
          request,
          auth.credentials.did,
          'com.atproto.identity.requestPlcOperationSignature',
        );
        await ensureOk(
          ctx.entrywayClient.post(
            'com.atproto.identity.requestPlcOperationSignature',
            { headers, as: null },
          ),
        );
      } else {
        const did = auth.credentials.did;
        const account = await ctx.accountManager.getAccount(did, {
          includeDeactivated: true,
          includeTakenDown: true,
        });
        if (!account) {
          throw new InvalidRequestError({ message: 'account not found' });
        } else if (!account.email) {
          throw new InvalidRequestError({
            message: 'account does not have an email address',
          });
        }
        const token = await ctx.accountManager.createEmailToken(
          did,
          'plc_operation',
        );
        await ctx.mailer.sendPlcOperation({ token }, { to: account.email });
      }

      return new Response(null, { status: 200, headers: responseHeaders });
    },
  };
}
