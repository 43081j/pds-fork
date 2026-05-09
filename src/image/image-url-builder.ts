import { BskyAppView } from '../bsky-app-view.js'
import { com } from '../lexicons.js'

export class ImageUrlBuilder {
  readonly pdsHostname: string;
  readonly bskyAppView?: BskyAppView;

  constructor(
    pdsHostname: string,
    bskyAppView?: BskyAppView,
  ) {
    this.pdsHostname = pdsHostname
    this.bskyAppView = bskyAppView
  }

  build(pattern: string, did: string, cid: string): string {
    return (
      this.bskyAppView?.getImageUrl(pattern, did, cid) ??
      `https://${this.pdsHostname}/xrpc/${com.atproto.sync.getBlob.$lxm}?did=${did}&cid=${cid}`
    )
  }
}
