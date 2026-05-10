import { ComAtprotoServerGetSession } from '@atcute/atproto';
import { ok as ensureOk } from '@atcute/client';
import { type XrpcQueryHandlerOptions, json } from '@atcute/xrpc-server';
import { DidString, HandleString, INVALID_HANDLE } from '@atproto/syntax';
import { formatAccountStatus } from '../../../../account-manager/account-manager.js';
import { AccessOutput, OAuthOutput } from '../../../../auth-output.js';
import { AppContext } from '../../../../context.js';
import { didDocForSession } from './util.js';

type SessionBody = ComAtprotoServerGetSession.$output;

export default function (
  ctx: AppContext,
): XrpcQueryHandlerOptions<ComAtprotoServerGetSession.mainSchema> {
  const verifier = ctx.authVerifier.authorization({
    additional: ['com.atproto.signupQueued'],
    authorize: () => {
      // Always allowed. "email" access is checked in the handler.
    },
  });

  return {
    lxm: ComAtprotoServerGetSession.mainSchema,
    handler: async ({ request }) => {
      const responseHeaders = new Headers();
      const auth = await verifier({
        request,
        responseHeaders,
        params: {},
      });

      if (ctx.entrywayClient) {
        const { headers } = await ctx.entrywayAuthHeaders(
          request,
          auth.credentials.did,
          'com.atproto.server.getSession',
        );

        const body = await ensureOk(
          ctx.entrywayClient.get('com.atproto.server.getSession', { headers }),
        );

        return json(output(auth, body as SessionBody), {
          headers: responseHeaders,
        });
      }

      const did = auth.credentials.did;
      const [user, didDoc] = await Promise.all([
        ctx.accountManager.getAccount(did, { includeDeactivated: true }),
        didDocForSession(ctx, did),
      ]);
      if (!user) {
        throw new Error(`Could not find user info for account: ${did}`);
      }

      const { status, active } = formatAccountStatus(user);

      return json(
        output(auth, {
          did: user.did as DidString,
          didDoc,
          handle: (user.handle ?? INVALID_HANDLE) as HandleString,
          email: user.email ?? undefined,
          emailConfirmed: !!user.emailConfirmedAt,
          active,
          status,
        }),
        { headers: responseHeaders },
      );
    },
  };
}

function output(
  { credentials }: OAuthOutput | AccessOutput,
  data: SessionBody,
): SessionBody {
  if (
    credentials.type === 'oauth' &&
    !credentials.permissions.allowsAccount({ attr: 'email', action: 'read' })
  ) {
    const { email, emailAuthFactor, emailConfirmed, ...rest } = data;
    return rest;
  }

  return data;
}
