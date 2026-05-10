import { ComAtprotoServerReserveSigningKey } from '@atcute/atproto';
import { type XrpcProcedureHandlerOptions, json } from '@atcute/xrpc-server';
import { AppContext } from '../../../../context.js';

export default function (
  ctx: AppContext,
): XrpcProcedureHandlerOptions<ComAtprotoServerReserveSigningKey.mainSchema> {
  return {
    lxm: ComAtprotoServerReserveSigningKey.mainSchema,
    handler: async ({ input }) => {
      const signingKey = await ctx.actorStore.reserveKeypair(input.did);
      return json({ signingKey });
    },
  };
}
