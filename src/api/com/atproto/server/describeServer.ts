import { ComAtprotoServerDescribeServer } from '@atcute/atproto';
import { type XrpcQueryHandlerOptions, json } from '@atcute/xrpc-server';
import { AppContext } from '../../../../context.js';

export default function (
  ctx: AppContext,
): XrpcQueryHandlerOptions<ComAtprotoServerDescribeServer.mainSchema> {
  return {
    lxm: ComAtprotoServerDescribeServer.mainSchema,
    handler: () => {
      const { cfg } = ctx;
      return json({
        did: cfg.service.did,
        availableUserDomains: cfg.identity.serviceHandleDomains,
        inviteCodeRequired: cfg.invites.required,
        links: {
          privacyPolicy: cfg.service.privacyPolicyUrl,
          termsOfService: cfg.service.termsOfServiceUrl,
        },
        contact: {
          email: cfg.service.contactEmailAddress,
        },
      });
    },
  };
}
