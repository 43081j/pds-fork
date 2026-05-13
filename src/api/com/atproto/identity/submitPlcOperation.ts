import * as plc from '@did-plc/lib';
import { ComAtprotoIdentitySubmitPlcOperation } from '@atcute/atproto';
import {
  type XrpcProcedureHandlerOptions,
  InvalidRequestError,
} from '@atcute/xrpc-server';
import { check } from '@atproto/common';
import { AppContext } from '../../../../context.js';
import { httpLogger as log } from '../../../../logger.js';

export default function (
  ctx: AppContext,
): XrpcProcedureHandlerOptions<ComAtprotoIdentitySubmitPlcOperation.mainSchema> {
  const verifier = ctx.authVerifier.authorization({
    authorize: (permissions) => {
      permissions.assertIdentity({ attr: '*' });
    },
  });

  return {
    lxm: ComAtprotoIdentitySubmitPlcOperation.mainSchema,
    handler: async ({ request, input }) => {
      const responseHeaders = new Headers();
      const auth = await verifier({
        request,
        responseHeaders,
        params: {},
      });

      const requester = auth.credentials.did;
      const op = input.operation;

      if (!check.is(op, plc.def.operation)) {
        throw new InvalidRequestError({ message: 'Invalid operation' });
      }

      const rotationKey =
        ctx.cfg.entryway?.plcRotationKey ?? ctx.plcRotationKey.did();
      if (!op.rotationKeys.includes(rotationKey)) {
        throw new InvalidRequestError({
          message: "Rotation keys do not include server's rotation key",
        });
      }
      if (op.services['atproto_pds']?.type !== 'AtprotoPersonalDataServer') {
        throw new InvalidRequestError({
          message: 'Incorrect type on atproto_pds service',
        });
      }
      if (op.services['atproto_pds']?.endpoint !== ctx.cfg.service.publicUrl) {
        throw new InvalidRequestError({
          message: 'Incorrect endpoint on atproto_pds service',
        });
      }
      const signingKey = await ctx.actorStore.keypair(requester);
      if (op.verificationMethods['atproto'] !== signingKey.did()) {
        throw new InvalidRequestError({ message: 'Incorrect signing key' });
      }
      const account = await ctx.accountManager.getAccount(requester, {
        includeDeactivated: true,
      });
      if (
        account?.handle &&
        op.alsoKnownAs.at(0) !== `at://${account.handle}`
      ) {
        throw new InvalidRequestError({
          message: 'Incorrect handle in alsoKnownAs',
        });
      }

      await ctx.plcClient.sendOperation(requester, op);
      await ctx.sequencer.sequenceIdentityEvt(requester);

      try {
        await ctx.idResolver.did.resolve(requester, true);
      } catch (err) {
        log.error(
          { err, did: requester },
          'failed to refresh did after plc update',
        );
      }

      return new Response(null, { status: 200, headers: responseHeaders });
    },
  };
}
