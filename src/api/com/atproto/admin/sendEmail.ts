import { ComAtprotoAdminSendEmail } from '@atcute/atproto';
import { ok as ensureOk } from '@atcute/client';
import {
  type XrpcProcedureHandlerOptions,
  InvalidRequestError,
  json,
} from '@atcute/xrpc-server';
import { AppContext } from '../../../../context.js';

export default function (
  ctx: AppContext,
): XrpcProcedureHandlerOptions<ComAtprotoAdminSendEmail.mainSchema> {
  const verifier = ctx.authVerifier.moderator;

  return {
    lxm: ComAtprotoAdminSendEmail.mainSchema,
    handler: async ({ request, input }) => {
      const responseHeaders = new Headers();
      await verifier({ request, responseHeaders, params: {} });

      const { content, recipientDid, subject = 'Message via your PDS' } = input;

      const account = await ctx.accountManager.getAccount(recipientDid, {
        includeDeactivated: true,
        includeTakenDown: true,
      });
      if (!account) {
        throw new InvalidRequestError({ message: 'Recipient not found' });
      }

      if (ctx.entrywayClient) {
        const { headers } = await ctx.entrywayAuthHeaders(
          request,
          recipientDid,
          'com.atproto.admin.sendEmail',
        );

        const body = await ensureOk(
          ctx.entrywayClient.post('com.atproto.admin.sendEmail', {
            headers,
            input,
          }),
        );
        return json(body, { headers: responseHeaders });
      }

      if (!account.email) {
        throw new InvalidRequestError({
          message: 'account does not have an email address',
        });
      }

      await ctx.moderationMailer.send(
        { content },
        { subject, to: account.email },
      );

      return json({ sent: true }, { headers: responseHeaders });
    },
  };
}
