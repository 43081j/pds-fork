import { ComAtprotoRepoApplyWrites } from '@atcute/atproto';
import {
  type XrpcProcedureHandlerOptions,
  AuthRequiredError,
  InvalidRequestError,
  json,
} from '@atcute/xrpc-server';
import { parseCid } from '@atproto/lex-data';
import { WriteOpAction } from '@atproto/repo';
import { AppContext } from '../../../../context.js';
import { dbLogger } from '../../../../logger.js';
import {
  BadCommitSwapError,
  InvalidRecordError,
  PreparedWrite,
  prepareCreate,
  prepareDelete,
  prepareUpdate,
} from '../../../../repo/index.js';

type ApplyWritesInput = ComAtprotoRepoApplyWrites.$input;
type WriteOp = ApplyWritesInput['writes'][number];

const isCreate = (
  op: WriteOp,
): op is Extract<WriteOp, { $type?: 'com.atproto.repo.applyWrites#create' }> =>
  op.$type === 'com.atproto.repo.applyWrites#create';
const isUpdate = (
  op: WriteOp,
): op is Extract<WriteOp, { $type?: 'com.atproto.repo.applyWrites#update' }> =>
  op.$type === 'com.atproto.repo.applyWrites#update';
const isDelete = (
  op: WriteOp,
): op is Extract<WriteOp, { $type?: 'com.atproto.repo.applyWrites#delete' }> =>
  op.$type === 'com.atproto.repo.applyWrites#delete';

export default function (
  ctx: AppContext,
): XrpcProcedureHandlerOptions<ComAtprotoRepoApplyWrites.mainSchema> {
  const verifier = ctx.authVerifier.authorization({
    authorize: () => {
      // Performed in the handler as it is based on the request body
    },
  });

  // TODO: re-add repo-write-hour / repo-write-day rate limits as router-level
  // middleware once XRPCRouter is wired up. calcPoints depends on op kind
  // (create=3, update=2, delete=1).

  return {
    lxm: ComAtprotoRepoApplyWrites.mainSchema,
    handler: async ({ request, input }) => {
      const responseHeaders = new Headers();
      const auth = await verifier({
        request,
        responseHeaders,
        params: {},
      });

      const { repo, validate, swapCommit, writes } = input;

      const account = await ctx.authVerifier.findAccount(repo, {
        checkDeactivated: true,
        checkTakedown: true,
      });

      const did = account.did;
      if (did !== auth.credentials.did) {
        throw new AuthRequiredError();
      }

      if (writes.length > 200) {
        throw new InvalidRequestError({ message: 'Too many writes. Max: 200' });
      }

      // Verify permission of every unique "action" / "collection" pair
      if (auth.credentials.type === 'oauth') {
        // @NOTE Unlike "importRepo", we do not require "action" = "*" here.
        for (const [action, collections] of [
          ['create', new Set(writes.filter(isCreate).map((w) => w.collection))],
          ['update', new Set(writes.filter(isUpdate).map((w) => w.collection))],
          ['delete', new Set(writes.filter(isDelete).map((w) => w.collection))],
        ] as const) {
          for (const collection of collections) {
            auth.credentials.permissions.assertRepo({ action, collection });
          }
        }
      }

      // @NOTE should preserve order of ts.writes for final use in response
      let preparedWrites: PreparedWrite[];
      try {
        preparedWrites = await Promise.all(
          writes.map(async (write, i) => {
            if (isCreate(write)) {
              return prepareCreate({
                did,
                collection: write.collection,
                record: write.value,
                rkey: write.rkey,
                validate,
                validationPath: ['writes', i, 'record'],
              });
            } else if (isUpdate(write)) {
              return prepareUpdate({
                did,
                collection: write.collection,
                record: write.value,
                rkey: write.rkey,
                validate,
                validationPath: ['writes', i, 'record'],
              });
            } else if (isDelete(write)) {
              return prepareDelete({
                did,
                collection: write.collection,
                rkey: write.rkey,
              });
            } else {
              throw new InvalidRequestError({
                message: `Action not supported: ${(write as { $type?: string })['$type']}`,
              });
            }
          }),
        );
      } catch (err) {
        if (err instanceof InvalidRecordError) {
          throw new InvalidRequestError({ message: err.message });
        }
        throw err;
      }

      const swapCommitCid = swapCommit ? parseCid(swapCommit) : undefined;

      const commit = await ctx.actorStore.transact(did, async (actorTxn) => {
        const commit = await actorTxn.repo
          .processWrites(preparedWrites, swapCommitCid)
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
          commit: {
            cid: commit.cid.toString(),
            rev: commit.rev,
          },
          results: preparedWrites.map(writeToOutputResult),
        },
        { headers: responseHeaders },
      );
    },
  };
}

type WriteResult =
  | ComAtprotoRepoApplyWrites.CreateResult
  | ComAtprotoRepoApplyWrites.UpdateResult
  | ComAtprotoRepoApplyWrites.DeleteResult;

const writeToOutputResult = (write: PreparedWrite): WriteResult => {
  switch (write.action) {
    case WriteOpAction.Create:
      return {
        $type: 'com.atproto.repo.applyWrites#createResult',
        cid: write.cid.toString(),
        uri: write.uri.toString(),
        validationStatus: write.validationStatus,
      };
    case WriteOpAction.Update:
      return {
        $type: 'com.atproto.repo.applyWrites#updateResult',
        cid: write.cid.toString(),
        uri: write.uri.toString(),
        validationStatus: write.validationStatus,
      };
    case WriteOpAction.Delete:
      return {
        $type: 'com.atproto.repo.applyWrites#deleteResult',
      };
    default:
      throw new Error(`Unrecognized action: ${write}`);
  }
};
