import { ComAtprotoRepoPutRecord } from '@atcute/atproto';
import {
  type XrpcProcedureHandlerOptions,
  AuthRequiredError,
  InvalidRequestError,
  json,
} from '@atcute/xrpc-server';
import {
  LegacyBlobRef,
  LexMap,
  TypedBlobRef,
  isLegacyBlobRef,
  parseCid,
} from '@atproto/lex-data';
import { AtUri } from '@atproto/syntax';
import { ActorStoreTransactor } from '../../../../actor-store/actor-store-transactor.js';
import { AppContext } from '../../../../context.js';
import { dbLogger } from '../../../../logger.js';
import {
  BadCommitSwapError,
  BadRecordSwapError,
  InvalidRecordError,
  PreparedCreate,
  PreparedUpdate,
  prepareCreate,
  prepareUpdate,
} from '../../../../repo/index.js';

export default function (
  ctx: AppContext,
): XrpcProcedureHandlerOptions<ComAtprotoRepoPutRecord.mainSchema> {
  const verifier = ctx.authVerifier.authorization({
    authorize: () => {
      // Performed in the handler as it requires the request body
    },
  });

  // TODO: re-add repo-write-hour / repo-write-day rate limits as router-level
  // middleware once XRPCRouter is wired up. calcPoints: 2.

  return {
    lxm: ComAtprotoRepoPutRecord.mainSchema,
    handler: async ({ request, input }) => {
      const responseHeaders = new Headers();
      const auth = await verifier({
        request,
        responseHeaders,
        params: {},
      });

      const {
        repo,
        collection,
        rkey,
        record,
        validate,
        swapCommit,
        swapRecord,
      } = input;

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
        auth.credentials.permissions.assertRepo({
          action: 'update',
          collection,
        });
      }

      const uri = AtUri.make(did, collection, rkey);
      const swapCommitCid = swapCommit ? parseCid(swapCommit) : undefined;
      const swapRecordCid =
        typeof swapRecord === 'string' ? parseCid(swapRecord) : swapRecord;

      const { commit, write } = await ctx.actorStore.transact(
        did,
        async (actorTxn) => {
          const current = await actorTxn.record.getRecord(uri, null, true);
          const isUpdate = current !== null;

          // @TODO temporary hack for legacy blob refs in profiles - remove after migrating legacy blobs
          if (isUpdate && collection === 'app.bsky.actor.profile') {
            await updateProfileLegacyBlobRef(actorTxn, record);
          }

          const writeInfo = {
            did,
            collection,
            rkey,
            record,
            swapCid: swapRecordCid,
            validate,
          };

          let write: PreparedCreate | PreparedUpdate;
          try {
            write = isUpdate
              ? await prepareUpdate(writeInfo)
              : await prepareCreate(writeInfo);
          } catch (err) {
            if (err instanceof InvalidRecordError) {
              throw new InvalidRequestError({ message: err.message });
            }
            throw err;
          }

          // no-op
          if (current && current.cid === write.cid.toString()) {
            return {
              commit: null,
              write,
            };
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

          return { commit, write };
        },
      );

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
          uri: write.uri.toString(),
          cid: write.cid.toString(),
          commit: commit
            ? {
                cid: commit.cid.toString(),
                rev: commit.rev,
              }
            : undefined,
          validationStatus: write.validationStatus,
        },
        { headers: responseHeaders },
      );
    },
  };
}

// WARNING: mutates object
async function updateProfileLegacyBlobRef(
  actorStore: ActorStoreTransactor,
  record: LexMap,
): Promise<void> {
  if (isLegacyBlobRef(record.avatar)) {
    record.avatar = await upgradeLegacyBlob(actorStore, record.avatar);
  }
  if (isLegacyBlobRef(record.banner)) {
    record.banner = await upgradeLegacyBlob(actorStore, record.banner);
  }
}

async function upgradeLegacyBlob(
  actorStore: ActorStoreTransactor,
  legacyBlob: LegacyBlobRef,
): Promise<TypedBlobRef> {
  const ref = parseCid(legacyBlob.cid);
  const blob = await actorStore.repo.blob.getBlobMetadata(ref);
  return {
    $type: 'blob',
    mimeType: legacyBlob.mimeType,
    ref,
    size: blob.size,
  };
}
