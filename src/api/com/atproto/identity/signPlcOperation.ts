import * as plc from '@did-plc/lib';
import { ComAtprotoIdentitySignPlcOperation } from '@atcute/atproto';
import { ok as ensureOk } from '@atcute/client';
import {
  type XrpcProcedureHandlerOptions,
  InvalidRequestError,
  json,
} from '@atcute/xrpc-server';
import { check } from '@atproto/common';
import { ACCESS_FULL } from '../../../../auth-scope.js';
import { AppContext } from '../../../../context.js';

export default function (
  ctx: AppContext,
): XrpcProcedureHandlerOptions<ComAtprotoIdentitySignPlcOperation.mainSchema> {
  const verifier = ctx.authVerifier.authorization({
    // @NOTE Should match auth rules from requestPlcOperationSignature
    scopes: ACCESS_FULL,
    additional: ['com.atproto.takendown'],
    authorize: (permissions) => {
      permissions.assertIdentity({ attr: '*' });
    },
  });

  return {
    lxm: ComAtprotoIdentitySignPlcOperation.mainSchema,
    handler: async ({ request, input }) => {
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
          'com.atproto.identity.signPlcOperation',
        );

        const result = await ensureOk(
          ctx.entrywayClient.post('com.atproto.identity.signPlcOperation', {
            headers,
            input,
          }),
        );

        return json(result, { headers: responseHeaders });
      }

      const did = auth.credentials.did;
      const { token } = input;
      if (!token) {
        throw new InvalidRequestError({
          message: 'email confirmation token required to sign PLC operations',
        });
      }
      await ctx.accountManager.assertValidEmailTokenAndCleanup(
        did,
        'plc_operation',
        token,
      );

      const lastOp = await ctx.plcClient.getLastOp(did);
      if (check.is(lastOp, plc.def.tombstone)) {
        throw new InvalidRequestError({ message: 'Did is tombstoned' });
      }
      const operation = await plc.createUpdateOp(
        lastOp,
        ctx.plcRotationKey,
        (lastOp) => ({
          ...lastOp,
          rotationKeys: input.rotationKeys ?? lastOp.rotationKeys,
          alsoKnownAs: input.alsoKnownAs ?? lastOp.alsoKnownAs,
          verificationMethods:
            // @TODO: actually validate instead of type casting
            (input.verificationMethods as undefined | Record<string, string>) ??
            lastOp.verificationMethods,
          services:
            // @TODO: actually validate instead of type casting
            (input.services as
              | undefined
              | Record<string, { type: string; endpoint: string }>) ??
            lastOp.services,
        }),
      );

      return json({ operation }, { headers: responseHeaders });
    },
  };
}
