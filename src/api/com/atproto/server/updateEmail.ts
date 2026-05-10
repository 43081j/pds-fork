import { ComAtprotoServerUpdateEmail } from '@atcute/atproto';
import { ok as ensureOk } from '@atcute/client';
import {
  type XrpcProcedureHandlerOptions,
  ForbiddenError,
  InvalidRequestError,
} from '@atcute/xrpc-server';
import { isEmailValid } from '@hapi/address';
import { isDisposableEmail } from 'disposable-email-domains-js';
import { UserAlreadyExistsError } from '../../../../account-manager/helpers/account.js';
import { ACCESS_FULL } from '../../../../auth-scope.js';
import { AppContext } from '../../../../context.js';

export default function (
  ctx: AppContext,
): XrpcProcedureHandlerOptions<ComAtprotoServerUpdateEmail.mainSchema> {
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
    lxm: ComAtprotoServerUpdateEmail.mainSchema,
    handler: async ({ request, input }) => {
      const responseHeaders = new Headers();
      const auth = await verifier({
        request,
        responseHeaders,
        params: {},
      });

      const did = auth.credentials.did;
      const { token, email } = input;
      if (!isEmailValid(email) || isDisposableEmail(email)) {
        throw new InvalidRequestError({
          message:
            'This email address is not supported, please use a different email.',
        });
      }
      const account = await ctx.accountManager.getAccount(did, {
        includeDeactivated: true,
      });
      if (!account) {
        throw new InvalidRequestError({ message: 'account not found' });
      }

      if (ctx.entrywayClient) {
        const { headers } = await ctx.entrywayAuthHeaders(
          request,
          did,
          'com.atproto.server.updateEmail',
        );
        await ensureOk(
          ctx.entrywayClient.post('com.atproto.server.updateEmail', {
            headers,
            input,
            as: null,
          }),
        );
      } else {
        // require valid token if account email is confirmed
        if (account.emailConfirmedAt) {
          if (!token) {
            throw new InvalidRequestError({
              message: 'confirmation token required',
              error: 'TokenRequired',
            });
          }
          await ctx.accountManager.assertValidEmailToken(
            did,
            'update_email',
            token,
          );
        }

        try {
          await ctx.accountManager.updateEmail({ did, email });
        } catch (err) {
          if (err instanceof UserAlreadyExistsError) {
            throw new InvalidRequestError({
              message:
                'This email address is already in use, please use a different email.',
            });
          } else {
            throw err;
          }
        }
      }

      return new Response(null, { status: 200, headers: responseHeaders });
    },
  };
}
