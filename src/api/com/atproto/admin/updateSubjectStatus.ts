import { ComAtprotoAdminUpdateSubjectStatus } from '@atcute/atproto';
import {
  type XrpcProcedureHandlerOptions,
  InvalidRequestError,
  json,
} from '@atcute/xrpc-server';
import { parseCid } from '@atproto/lex-data';
import { AtUri } from '@atproto/syntax';
import { AppContext } from '../../../../context.js';

export default function (
  ctx: AppContext,
): XrpcProcedureHandlerOptions<ComAtprotoAdminUpdateSubjectStatus.mainSchema> {
  const verifier = ctx.authVerifier.moderator;

  return {
    lxm: ComAtprotoAdminUpdateSubjectStatus.mainSchema,
    handler: async ({ request, input }) => {
      const responseHeaders = new Headers();
      await verifier({ request, responseHeaders, params: {} });

      const { subject, takedown, deactivated } = input;
      if (takedown) {
        if (subject.$type === 'com.atproto.admin.defs#repoRef') {
          await ctx.accountManager.takedownAccount(subject.did, takedown);
        } else if (subject.$type === 'com.atproto.repo.strongRef') {
          const uri = new AtUri(subject.uri);
          await ctx.actorStore.transact(uri.hostname, async (store) => {
            await store.record.updateRecordTakedownStatus(uri, takedown);
          });
        } else if (subject.$type === 'com.atproto.admin.defs#repoBlobRef') {
          await ctx.actorStore.transact(subject.did, async (store) => {
            await store.repo.blob.updateBlobTakedownStatus(
              parseCid(subject.cid),
              takedown,
            );
          });
        } else {
          throw new InvalidRequestError({
            message: `Invalid subject (${(subject as { $type: string }).$type})`,
          });
        }
      }

      if (deactivated) {
        if (subject.$type === 'com.atproto.admin.defs#repoRef') {
          if (deactivated.applied) {
            await ctx.accountManager.deactivateAccount(subject.did, null);
          } else {
            await ctx.accountManager.activateAccount(subject.did);
          }
        }
      }

      if (subject.$type === 'com.atproto.admin.defs#repoRef') {
        const status = await ctx.accountManager.getAccountStatus(subject.did);
        await ctx.sequencer.sequenceAccountEvt(subject.did, status);
      }

      return json({ subject, takedown }, { headers: responseHeaders });
    },
  };
}
