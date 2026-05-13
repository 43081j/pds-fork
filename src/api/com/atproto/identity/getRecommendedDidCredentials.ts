import { ComAtprotoIdentityGetRecommendedDidCredentials } from '@atcute/atproto';
import { type XrpcQueryHandlerOptions, json } from '@atcute/xrpc-server';
import { AppContext } from '../../../../context.js';

export default function (
  ctx: AppContext,
): XrpcQueryHandlerOptions<ComAtprotoIdentityGetRecommendedDidCredentials.mainSchema> {
  const verifier = ctx.authVerifier.authorization({
    authorize: () => {
      // always allow
    },
  });

  return {
    lxm: ComAtprotoIdentityGetRecommendedDidCredentials.mainSchema,
    handler: async ({ request }) => {
      const responseHeaders = new Headers();
      const auth = await verifier({
        request,
        responseHeaders,
        params: {},
      });

      const requester = auth.credentials.did;
      const signingKey = await ctx.actorStore.keypair(requester);
      const verificationMethods = {
        atproto: signingKey.did(),
      };
      const account = await ctx.accountManager.getAccount(requester, {
        includeDeactivated: true,
      });
      const alsoKnownAs = account?.handle
        ? [`at://${account.handle}`]
        : undefined;

      const plcRotationKey =
        ctx.cfg.entryway?.plcRotationKey ?? ctx.plcRotationKey.did();
      const rotationKeys = [plcRotationKey];
      if (ctx.cfg.identity.recoveryDidKey) {
        rotationKeys.unshift(ctx.cfg.identity.recoveryDidKey);
      }

      const services = {
        atproto_pds: {
          type: 'AtprotoPersonalDataServer',
          endpoint: ctx.cfg.service.publicUrl,
        },
      };

      return json(
        {
          alsoKnownAs,
          verificationMethods,
          rotationKeys,
          services,
        },
        { headers: responseHeaders },
      );
    },
  };
}
