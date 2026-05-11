import assert from 'node:assert';
import { ComAtprotoSyncSubscribeRepos } from '@atcute/atproto';
import { CidLinkWrapper, encode as cborEncode, toBytes } from '@atcute/cbor';
import { DatetimeString, DidString, HandleString } from '@atproto/lex';
import { BlockMap, blocksToCarFile } from '@atproto/repo';
import { AccountStatus } from '../account-manager/account-manager.js';
import { CommitDataWithOps, SyncEvtData } from '../repo/index.js';
import { RepoSeqInsert } from './db/index.js';

export type CommitEvtOp = Omit<ComAtprotoSyncSubscribeRepos.RepoOp, '$type'>;
export type CommitEvt = Omit<
  ComAtprotoSyncSubscribeRepos.Commit,
  '$type' | 'seq' | 'time'
>;
export type SyncEvt = Omit<
  ComAtprotoSyncSubscribeRepos.Sync,
  '$type' | 'seq' | 'time'
>;
export type IdentityEvt = Omit<
  ComAtprotoSyncSubscribeRepos.Identity,
  '$type' | 'seq' | 'time'
>;
export type AccountEvt = Omit<
  ComAtprotoSyncSubscribeRepos.Account,
  '$type' | 'seq' | 'time'
>;

const cidToLink = (cid: { bytes: Uint8Array }) => new CidLinkWrapper(cid.bytes);

export const formatSeqCommit = async (
  did: string,
  commitData: CommitDataWithOps,
): Promise<RepoSeqInsert> => {
  const blocksToSend = new BlockMap();
  blocksToSend.addMap(commitData.newBlocks);
  blocksToSend.addMap(commitData.relevantBlocks);

  const evt: CommitEvt = {
    repo: did as CommitEvt['repo'],
    commit: cidToLink(commitData.cid),
    rev: commitData.rev,
    since: commitData.since,
    blocks: toBytes(await blocksToCarFile(commitData.cid, blocksToSend)),
    ops: commitData.ops.map(
      (op): CommitEvtOp => ({
        action: op.action,
        path: op.path,
        cid: op.cid ? cidToLink(op.cid) : null,
        prev: op.prev ? cidToLink(op.prev) : undefined,
      }),
    ),
    prevData: commitData.prevData ? cidToLink(commitData.prevData) : undefined,
    // deprecated (but still required) fields
    rebase: false,
    tooBig: false,
    blobs: [],
  };

  return {
    did,
    eventType: 'append' as const,
    event: cborEncode(evt),
    sequencedAt: new Date().toISOString(),
  };
};

export const formatSeqSyncEvt = async (
  did: DidString,
  data: SyncEvtData,
): Promise<RepoSeqInsert> => {
  const blocks = await blocksToCarFile(data.cid, data.blocks);
  const evt: SyncEvt = {
    did,
    rev: data.rev,
    blocks: toBytes(blocks),
  };
  return {
    did,
    eventType: 'sync',
    event: cborEncode(evt),
    sequencedAt: new Date().toISOString(),
  };
};

export const syncEvtDataFromCommit = (
  commitData: CommitDataWithOps,
): SyncEvtData => {
  const { blocks, missing } = commitData.relevantBlocks.getMany([
    commitData.cid,
  ]);
  assert(
    !missing.length,
    'commit block was not found, could not build sync event',
  );
  return {
    rev: commitData.rev,
    cid: commitData.cid,
    blocks,
  };
};

export const formatSeqIdentityEvt = async (
  did: DidString,
  handle?: HandleString,
): Promise<RepoSeqInsert> => {
  const evt: IdentityEvt = {
    did,
  };
  if (handle) {
    evt.handle = handle;
  }
  return {
    did,
    eventType: 'identity',
    event: cborEncode(evt),
    sequencedAt: new Date().toISOString(),
  };
};

export const formatSeqAccountEvt = async (
  did: DidString,
  status: AccountStatus,
): Promise<RepoSeqInsert> => {
  const evt: AccountEvt = {
    did,
    active: status === 'active',
  };
  if (status !== 'active') {
    evt.status = status;
  }

  return {
    did,
    eventType: 'account',
    event: cborEncode(evt),
    sequencedAt: new Date().toISOString(),
  };
};

type TypedCommitEvt = {
  type: 'commit';
  seq: number;
  time: DatetimeString;
  evt: CommitEvt;
};
type TypedSyncEvt = {
  type: 'sync';
  seq: number;
  time: DatetimeString;
  evt: SyncEvt;
};
type TypedIdentityEvt = {
  type: 'identity';
  seq: number;
  time: DatetimeString;
  evt: IdentityEvt;
};
type TypedAccountEvt = {
  type: 'account';
  seq: number;
  time: DatetimeString;
  evt: AccountEvt;
};
export type SeqEvt =
  | TypedCommitEvt
  | TypedSyncEvt
  | TypedIdentityEvt
  | TypedAccountEvt;
