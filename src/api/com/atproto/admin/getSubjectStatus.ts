import { ComAtprotoAdminGetSubjectStatus } from '@atcute/atproto';
import {
  type XrpcQueryHandlerOptions,
  InvalidRequestError,
  json,
} from '@atcute/xrpc-server';
import { parseCid } from '@atproto/lex-data';
import { AtUri } from '@atproto/syntax';
import { AppContext } from '../../../../context.js';

type OutputBody = ComAtprotoAdminGetSubjectStatus.$output;

export default function (
  ctx: AppContext,
): XrpcQueryHandlerOptions<ComAtprotoAdminGetSubjectStatus.mainSchema> {
  const verifier = ctx.authVerifier.moderator;

  return {
    lxm: ComAtprotoAdminGetSubjectStatus.mainSchema,
    handler: async ({ request, params }) => {
      const responseHeaders = new Headers();
      await verifier({ request, responseHeaders, params });

      const { did, uri, blob } = params;
      let body: OutputBody | null = null;
      if (blob) {
        if (!did) {
          throw new InvalidRequestError({
            message: 'Must provide a did to request blob state',
          });
        }
        const takedown = await ctx.actorStore.read(did, (store) =>
          store.repo.blob.getBlobTakedownStatus(parseCid(blob)),
        );
        if (takedown) {
          body = {
            subject: {
              $type: 'com.atproto.admin.defs#repoBlobRef',
              did,
              cid: blob,
            },
            takedown,
          };
        }
      } else if (uri) {
        const parsedUri = new AtUri(uri);
        const [takedown, cid] = await ctx.actorStore.read(
          parsedUri.hostname,
          (store) =>
            Promise.all([
              store.record.getRecordTakedownStatus(parsedUri),
              store.record.getCurrentRecordCid(parsedUri),
            ]),
        );
        if (cid && takedown) {
          body = {
            subject: {
              $type: 'com.atproto.repo.strongRef',
              uri: parsedUri.toString(),
              cid: cid.toString(),
            },
            takedown,
          };
        }
      } else if (did) {
        const status = await ctx.accountManager.getAccountAdminStatus(did);
        if (status) {
          body = {
            subject: {
              $type: 'com.atproto.admin.defs#repoRef',
              did,
            },
            takedown: status.takedown,
            deactivated: status.deactivated,
          };
        }
      } else {
        throw new InvalidRequestError({ message: 'No provided subject' });
      }
      if (body === null) {
        throw new InvalidRequestError({
          message: 'Subject not found',
          error: 'NotFound',
        });
      }
      return json(body, { headers: responseHeaders });
    },
  };
}
