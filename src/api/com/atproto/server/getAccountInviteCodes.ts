import { ComAtprotoServerGetAccountInviteCodes } from '@atcute/atproto';
import { ok as ensureOk } from '@atcute/client';
import {
  type XrpcQueryHandlerOptions,
  ForbiddenError,
  InvalidRequestError,
  json,
} from '@atcute/xrpc-server';
import { CodeDetail } from '../../../../account-manager/helpers/invite.js';
import { ACCESS_FULL } from '../../../../auth-scope.js';
import { AppContext } from '../../../../context.js';
import { genInvCodes } from './util.js';

export default function (
  ctx: AppContext,
): XrpcQueryHandlerOptions<ComAtprotoServerGetAccountInviteCodes.mainSchema> {
  const verifier = ctx.authVerifier.authorization({
    checkTakedown: true,
    scopes: ACCESS_FULL,
    authorize: () => {
      throw new ForbiddenError({
        message: 'OAuth credentials are not supported for this endpoint',
      });
    },
  });

  return {
    lxm: ComAtprotoServerGetAccountInviteCodes.mainSchema,
    handler: async ({ request, params }) => {
      const responseHeaders = new Headers();
      const auth = await verifier({
        request,
        responseHeaders,
        params,
      });

      if (ctx.entrywayClient) {
        const { headers } = await ctx.entrywayAuthHeaders(
          request,
          auth.credentials.did,
          'com.atproto.server.getAccountInviteCodes',
        );
        const body = await ensureOk(
          ctx.entrywayClient.get('com.atproto.server.getAccountInviteCodes', {
            params,
            headers,
          }),
        );
        return json(body, { headers: responseHeaders });
      }

      const requester = auth.credentials.did;
      const { includeUsed, createAvailable } = params;

      const [account, userCodes] = await Promise.all([
        ctx.accountManager.getAccount(requester),
        ctx.accountManager.getAccountInvitesCodes(requester),
      ]);
      if (!account) {
        throw new InvalidRequestError({
          message: 'Account not found',
          error: 'NotFound',
        });
      }

      let created: CodeDetail[] = [];

      if (
        createAvailable &&
        ctx.cfg.invites.required &&
        ctx.cfg.invites.interval !== null
      ) {
        const { toCreate, total } = calculateCodesToCreate({
          did: requester,
          userCreatedAt: new Date(account.createdAt).getTime(),
          codes: userCodes,
          epoch: ctx.cfg.invites.epoch,
          interval: ctx.cfg.invites.interval,
        });
        if (toCreate > 0) {
          const codes = genInvCodes(ctx.cfg, toCreate);
          created = await ctx.accountManager.createAccountInviteCodes(
            requester,
            codes,
            total,
            account.invitesDisabled ?? 0,
          );
        }
      }

      const allCodes = [...userCodes, ...created];

      const filtered = allCodes.filter((code) => {
        if (code.disabled) return false;
        if (!includeUsed && code.uses.length >= code.available) return false;
        return true;
      });

      return json({ codes: filtered }, { headers: responseHeaders });
    },
  };
}

/**
 * WARNING: TRICKY SUBTLE MATH - DONT MESS WITH THIS FUNCTION UNLESS YOUR'RE VERY CONFIDENT
 * if the user wishes to create available codes & the server allows that,
 * we determine the number to create by dividing their account lifetime by the interval at which they can create codes
 * if an invite epoch is provided, we only calculate available invites since that epoch
 * we allow a max of 5 open codes at a given time
 * note: even if a user is disabled from future invites, we still create the invites for bookkeeping, we just immediately disable them as well
 */
const calculateCodesToCreate = (opts: {
  did: string;
  userCreatedAt: number;
  codes: CodeDetail[];
  epoch: number;
  interval: number;
}): { toCreate: number; total: number } => {
  // for the sake of generating routine interval codes, we do not count explicitly gifted admin codes
  const routineCodes = opts.codes.filter((code) => code.createdBy !== 'admin');
  const unusedRoutineCodes = routineCodes.filter(
    (row) => !row.disabled && row.available > row.uses.length,
  );

  const userLifespan = Date.now() - opts.userCreatedAt;

  // how many codes a user could create within the current epoch if they have 0
  let couldCreate: number;

  if (opts.userCreatedAt >= opts.epoch) {
    // if the user was created after the epoch, then they can create a code for each interval since the epoch
    couldCreate = Math.floor(userLifespan / opts.interval);
  } else {
    // if the user was created before the epoch, we:
    // - calculate the total intervals since account creation
    // - calculate the total intervals before the epoch
    // - subtract the two
    const couldCreateTotal = Math.floor(userLifespan / opts.interval);
    const userPreEpochLifespan = opts.epoch - opts.userCreatedAt;
    const couldCreateBeforeEpoch = Math.floor(
      userPreEpochLifespan / opts.interval,
    );
    couldCreate = couldCreateTotal - couldCreateBeforeEpoch;
  }
  // we count the codes that the user has created within the current epoch
  const epochCodes = routineCodes.filter(
    (code) => new Date(code.createdAt).getTime() > opts.epoch,
  );
  // finally we the number of codes they currently have from the number that they could create, and take a max of 5
  const toCreate = Math.min(
    5 - unusedRoutineCodes.length,
    couldCreate - epochCodes.length,
  );
  return {
    toCreate,
    total: routineCodes.length + toCreate,
  };
};
