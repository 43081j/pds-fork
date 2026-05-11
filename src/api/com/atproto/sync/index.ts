import type { AppContext } from '../../../../context.js';
import getCheckout from './deprecated/getCheckout.js';
import getHead from './deprecated/getHead.js';
import getBlob from './getBlob.js';
import getBlocks from './getBlocks.js';
import getLatestCommit from './getLatestCommit.js';
import getRecord from './getRecord.js';
import getRepo from './getRepo.js';
import getRepoStatus from './getRepoStatus.js';
import listBlobs from './listBlobs.js';
import listRepos from './listRepos.js';
import subscribeRepos from './subscribeRepos.js';

export default function (ctx: AppContext) {
  return [
    getBlob(ctx),
    getBlocks(ctx),
    getLatestCommit(ctx),
    getRepoStatus(ctx),
    getRecord(ctx),
    getRepo(ctx),
    subscribeRepos(ctx),
    listBlobs(ctx),
    listRepos(ctx),
    getCheckout(ctx),
    getHead(ctx),
  ];
}
