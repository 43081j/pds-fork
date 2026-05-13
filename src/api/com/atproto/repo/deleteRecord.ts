import { ComAtprotoRepoDeleteRecord } from '@atcute/atproto';
import {
  type XrpcProcedureHandlerOptions,
  AuthRequiredError,
  InvalidRequestError,
  json,
} from '@atcute/xrpc-server';
import { parseCid } from '@atproto/lex-data';
import { AppContext } from '../../../../context.js';
import { dbLogger } from '../../../../logger.js';
import {
  BadCommitSwapError,
  BadRecordSwapError,
  prepareDelete,
} from '../../../../repo/index.js';

export default function (
  ctx: AppContext,
): XrpcProcedureHandlerOptions<ComAtprotoRepoDeleteRecord.mainSchema> {
  const verifier = ctx.authVerifier.authorization({
    authorize: () => {
      // Performed in the handler as it requires the request body
    },
  });

  // TODO: re-add repo-write-hour / repo-write-day rate limits as router-level
  // middleware once XRPCRouter is wired up. calcPoints: 1.

  return {
    lxm: ComAtprotoRepoDeleteRecord.mainSchema,
    handler: async ({ request, input }) => {
      const responseHeaders = new Headers();
      const auth = await verifier({
        request,
        responseHeaders,
        params: {},
      });

      const { repo, collection, rkey, swapCommit, swapRecord } = input;

      const account = await ctx.authVerifier.findAccount(repo, {
        checkDeactivated: true,
        checkTakedown: true,
      });

      const did = account.did;
      if (did !== auth.credentials.did) {
        throw new AuthRequiredError();
      }

      if (auth.credentials.type === 'oauth') {
        auth.credentials.permissions.assertRepo({
          action: 'delete',
          collection,
        });
      }

      const swapCommitCid = swapCommit ? parseCid(swapCommit) : undefined;
      const swapRecordCid = swapRecord ? parseCid(swapRecord) : undefined;

      const write = prepareDelete({
        did,
        collection,
        rkey,
        swapCid: swapRecordCid,
      });
      const commit = await ctx.actorStore.transact(did, async (actorTxn) => {
        const record = await actorTxn.record.getRecord(write.uri, null, true);
        if (!record) {
          return null; // No-op if record already doesn't exist
        }

        const commit = await actorTxn.repo
          .processWrites([write], swapCommitCid)
          .catch((err) => {
            if (
              err instanceof BadCommitSwapError ||
              err instanceof BadRecordSwapError
            ) {
              throw new InvalidRequestError({
                message: err.message,
                error: 'InvalidSwap',
              });
            }
            throw err;
          });

        await ctx.sequencer.sequenceCommit(did, commit);
        return commit;
      });

      if (commit !== null) {
        await ctx.accountManager
          .updateRepoRoot(did, commit.cid, commit.rev)
          .catch((err) => {
            dbLogger.error(
              { err, did, cid: commit.cid, rev: commit.rev },
              'failed to update account root',
            );
          });
      }

      return json(
        {
          commit: commit
            ? {
                cid: commit.cid.toString(),
                rev: commit.rev,
              }
            : undefined,
        },
        { headers: responseHeaders },
      );
    },
  };
}
