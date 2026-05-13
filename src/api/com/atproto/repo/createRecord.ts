import { ComAtprotoRepoCreateRecord } from '@atcute/atproto';
import {
  type XrpcProcedureHandlerOptions,
  AuthRequiredError,
  InvalidRequestError,
  json,
} from '@atcute/xrpc-server';
import { parseCid } from '@atproto/lex-data';
import { InvalidRecordKeyError } from '@atproto/syntax';
import { AppContext } from '../../../../context.js';
import { dbLogger } from '../../../../logger.js';
import {
  BadCommitSwapError,
  InvalidRecordError,
  PreparedCreate,
  prepareCreate,
  prepareDelete,
} from '../../../../repo/index.js';

export default function (
  ctx: AppContext,
): XrpcProcedureHandlerOptions<ComAtprotoRepoCreateRecord.mainSchema> {
  // @NOTE the "checkTakedown" and "checkDeactivated" checks are typically
  // performed during auth. However, since this method's "repo" parameter
  // can be a handle, we will need to fetch the account again to ensure that
  // the handle matches the DID from the request's credentials. In order to
  // avoid fetching the account twice (during auth, and then again in the
  // controller), the checks are disabled here.
  const verifier = ctx.authVerifier.authorization({
    authorize: () => {
      // Performed in the handler as it requires the request body
    },
  });

  // TODO: re-add repo-write-hour / repo-write-day rate limits as router-level
  // middleware once XRPCRouter is wired up. calcPoints: 3.

  return {
    lxm: ComAtprotoRepoCreateRecord.mainSchema,
    handler: async ({ request, input }) => {
      const responseHeaders = new Headers();
      const auth = await verifier({
        request,
        responseHeaders,
        params: {},
      });

      const { repo, collection, rkey, record, swapCommit, validate } = input;

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
          action: 'create',
          collection,
        });
      }

      const swapCommitCid = swapCommit ? parseCid(swapCommit) : undefined;

      let write: PreparedCreate;
      try {
        write = await prepareCreate({
          did,
          collection,
          record,
          rkey,
          validate,
        });
      } catch (err) {
        if (err instanceof InvalidRecordError) {
          throw new InvalidRequestError({ message: err.message });
        }
        if (err instanceof InvalidRecordKeyError) {
          throw new InvalidRequestError({ message: err.message });
        }
        throw err;
      }

      const commit = await ctx.actorStore.transact(did, async (actorTxn) => {
        const backlinkConflicts =
          validate !== false
            ? await actorTxn.record.getBacklinkConflicts(
                write.uri,
                write.record,
              )
            : [];
        const backlinkDeletions = backlinkConflicts.map((uri) =>
          prepareDelete({
            did: uri.did,
            collection: uri.collectionSafe,
            rkey: uri.rkeySafe,
          }),
        );
        const writes = [...backlinkDeletions, write];
        const commit = await actorTxn.repo
          .processWrites(writes, swapCommitCid)
          .catch((err) => {
            if (err instanceof BadCommitSwapError) {
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

      await ctx.accountManager
        .updateRepoRoot(did, commit.cid, commit.rev)
        .catch((err) => {
          dbLogger.error(
            { err, did, cid: commit.cid, rev: commit.rev },
            'failed to update account root',
          );
        });

      return json(
        {
          uri: write.uri.toString(),
          cid: write.cid.toString(),
          commit: {
            cid: commit.cid.toString(),
            rev: commit.rev,
          },
          validationStatus: write.validationStatus,
        },
        { headers: responseHeaders },
      );
    },
  };
}
