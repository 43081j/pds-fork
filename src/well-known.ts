import { Router } from 'express';
import { HandleString } from '@atproto/syntax';
import { AppContext } from './context.js';

export const createRouter = (ctx: AppContext): Router => {
  const router = Router();

  router.get('/.well-known/atproto-did', async function (req, res) {
    const handle = req.hostname as HandleString;
    const supportedHandle = ctx.cfg.identity.serviceHandleDomains.some(
      (host) => handle.endsWith(host) || handle === host.slice(1),
    );
    if (!supportedHandle) {
      res.status(404).send('User not found');
      return;
    }
    let did: string | undefined;
    try {
      const user = await ctx.accountManager.getAccount(handle);
      did = user?.did;
    } catch (err) {
      res.status(500).send('Internal Server Error');
      return;
    }
    if (!did) {
      res.status(404).send('User not found');
      return;
    }
    res.type('text/plain').send(did);
  });

  return router;
};
