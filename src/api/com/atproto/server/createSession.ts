import { ComAtprotoServerCreateSession } from '@atcute/atproto';
import { ok as ensureOk } from '@atcute/client';
import {
  type XrpcProcedureHandlerOptions,
  AuthRequiredError,
  json,
} from '@atcute/xrpc-server';
import { DidString, HandleString, INVALID_HANDLE } from '@atproto/syntax';
import { formatAccountStatus } from '../../../../account-manager/account-manager.js';
import { OLD_PASSWORD_MAX_LENGTH } from '../../../../account-manager/helpers/scrypt.js';
import { AppContext } from '../../../../context.js';
import { didDocForSession } from './util.js';

// TODO: rate limiting (was 300/day + 30/5min, keyed by `${identifier}-${ip}`)
// - needs router-level middleware.

export default function (
  ctx: AppContext,
): XrpcProcedureHandlerOptions<ComAtprotoServerCreateSession.mainSchema> {
  return {
    lxm: ComAtprotoServerCreateSession.mainSchema,
    handler: async ({ request, input }) => {
      const responseHeaders = new Headers();

      if (ctx.entrywayClient) {
        const { headers } = ctx.entrywayPassthruHeaders(request);
        const body = await ensureOk(
          ctx.entrywayClient.post('com.atproto.server.createSession', {
            headers,
            input,
          }),
        );
        return json(body, { headers: responseHeaders });
      }

      if (input.password.length > OLD_PASSWORD_MAX_LENGTH) {
        throw new AuthRequiredError({
          message: 'Password too long. Consider resetting your password.',
        });
      }

      const { user, isSoftDeleted, appPassword } =
        await ctx.accountManager.login(input);

      if (!input.allowTakendown && isSoftDeleted) {
        throw new AuthRequiredError({
          message: 'Account has been taken down',
          error: 'AccountTakedown',
        });
      }

      const [{ accessJwt, refreshJwt }, didDoc] = await Promise.all([
        ctx.accountManager.createSession(user.did, appPassword, isSoftDeleted),
        didDocForSession(ctx, user.did),
      ]);

      const { status, active } = formatAccountStatus(user);

      return json(
        {
          accessJwt,
          refreshJwt,
          did: user.did as DidString,
          didDoc,
          handle: (user.handle ?? INVALID_HANDLE) as HandleString,
          email: user.email ?? undefined,
          emailConfirmed: !!user.emailConfirmedAt,
          active,
          status,
        },
        { headers: responseHeaders },
      );
    },
  };
}
