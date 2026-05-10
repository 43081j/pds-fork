import { LexMap, UriString } from '@atproto/lex';
import {
  AtUri,
  DidString,
  HandleString,
  INVALID_HANDLE,
} from '@atproto/syntax';
import { createServiceAuthHeaders } from '@atproto/xrpc-server';
import { AccountManager } from '../account-manager/account-manager.js';
import { ActorStoreReader } from '../actor-store/actor-store-reader.js';
import { BskyAppView } from '../bsky-app-view.js';
import { ImageUrlBuilder } from '../image/image-url-builder.js';
import {
  AppBskyActorDefs,
  AppBskyEmbedImages,
  AppBskyFeedDefs,
  AppBskyFeedPost,
  AppBskyEmbedExternal,
  AppBskyEmbedRecord,
  AppBskyEmbedRecordWithMedia,
  AppBskyFeedGetPosts,
  AppBskyActorProfile,
  AppBskyFeedGetFeedGenerator,
  AppBskyGraphGetList,
} from '@atcute/bluesky';
import { LocalRecords, RecordDescript } from './types.js';
import { is, LegacyBlob } from '@atcute/lexicons';
import { isBlob, isLegacyBlob } from '@atcute/lexicons/interfaces';

type CommonSignedUris =
  | 'avatar'
  | 'banner'
  | 'feed_thumbnail'
  | 'feed_fullsize';

export type LocalViewerCreator = (
  actorStoreReader: ActorStoreReader,
) => LocalViewer;

function getBlobCidString(blob: Blob | LegacyBlob): string {
  if (isBlob(blob)) {
    return blob.ref.toString();
  }
  return (blob as LegacyBlob).cid;
}

export class LocalViewer {
  public readonly actorStoreReader: ActorStoreReader;
  public readonly accountManager: AccountManager;
  public readonly imageUrlBuilder: ImageUrlBuilder;
  public readonly bskyAppView?: BskyAppView;

  constructor(
    actorStoreReader: ActorStoreReader,
    accountManager: AccountManager,
    imageUrlBuilder: ImageUrlBuilder,
    bskyAppView?: BskyAppView,
  ) {
    this.actorStoreReader = actorStoreReader;
    this.accountManager = accountManager;
    this.imageUrlBuilder = imageUrlBuilder;
    if (bskyAppView) {
      this.bskyAppView = bskyAppView;
    }
  }

  get did() {
    return this.actorStoreReader.did as DidString;
  }

  static creator(
    accountManager: AccountManager,
    imageUrlBuilder: ImageUrlBuilder,
    bskyAppView?: BskyAppView,
  ): LocalViewerCreator {
    return (actorStore) =>
      new LocalViewer(actorStore, accountManager, imageUrlBuilder, bskyAppView);
  }

  getImageUrl(pattern: CommonSignedUris, cid: string) {
    return this.imageUrlBuilder.build(pattern, this.did, cid) as UriString;
  }

  async serviceAuthHeaders(did: string, lxm: string) {
    if (!this.bskyAppView) {
      throw new Error('Could not find bsky appview did');
    }
    const keypair = await this.actorStoreReader.keypair();

    return createServiceAuthHeaders({
      iss: did,
      aud: this.bskyAppView.did,
      lxm,
      keypair,
    });
  }

  async getRecordsSinceRev(rev: string): Promise<LocalRecords> {
    return this.actorStoreReader.record.getRecordsSinceRev(rev);
  }

  async getProfileBasic(): Promise<AppBskyActorDefs.ProfileViewBasic | null> {
    const [profileRes, accountRes] = await Promise.all([
      this.actorStoreReader.record.getProfileRecord(),
      this.accountManager.getAccount(this.did),
    ]);

    if (!accountRes) return null;

    return {
      did: this.did,
      handle: (accountRes.handle ?? INVALID_HANDLE) as HandleString,
      displayName: profileRes?.displayName,
      avatar: profileRes?.avatar
        ? this.getImageUrl('avatar', getBlobCidString(profileRes.avatar))
        : undefined,
    };
  }

  async formatAndInsertPostsInFeed(
    feed: AppBskyFeedDefs.FeedViewPost[],
    posts: RecordDescript<AppBskyFeedPost.Main>[],
  ): Promise<AppBskyFeedDefs.FeedViewPost[]> {
    if (posts.length === 0) {
      return feed;
    }
    const lastTime = feed.at(-1)?.post.indexedAt ?? new Date(0).toISOString();
    const inFeed = posts.filter((p) => p.indexedAt > lastTime);
    const newestToOldest = inFeed.reverse();
    const maybeFormatted = await Promise.all(
      newestToOldest.map((p) => this.getPost(p)),
    );
    const formatted = maybeFormatted.filter(
      (p) => p !== null,
    ) as AppBskyFeedDefs.PostView[];
    for (const post of formatted) {
      const idx = feed.findIndex((fi) => fi.post.indexedAt < post.indexedAt);
      if (idx >= 0) {
        feed.splice(idx, 0, { post });
      } else {
        feed.push({ post });
      }
    }
    return feed;
  }

  async getPost(
    descript: RecordDescript<AppBskyFeedPost.Main>,
  ): Promise<AppBskyFeedDefs.PostView | null> {
    const { uri, cid, indexedAt, record } = descript;
    const author = await this.getProfileBasic();
    if (!author) return null;
    const embed = record.embed ? await this.formatPostEmbed(record) : undefined;
    return {
      uri: uri.toString(),
      cid: cid.toString(),
      likeCount: 0, // counts presumed to be 0 directly after post creation
      replyCount: 0,
      repostCount: 0,
      quoteCount: 0,
      author,
      record: record as LexMap,
      embed,
      indexedAt,
    };
  }

  async formatPostEmbed(post: AppBskyFeedPost.Main) {
    const embed = post.embed;
    if (!embed) return undefined;
    if (is(AppBskyEmbedImages.mainSchema, embed)) {
      return this.formatImageEmbed(embed);
    } else if (is(AppBskyEmbedExternal.mainSchema, embed)) {
      return this.formatExternalEmbed(embed);
    } else if (is(AppBskyEmbedRecord.mainSchema, embed)) {
      return this.formatRecordEmbed(embed);
    } else if (is(AppBskyEmbedRecordWithMedia.mainSchema, embed)) {
      return this.formatRecordWithMediaEmbed(embed);
    } else {
      return undefined;
    }
  }

  formatImageEmbed(embed: AppBskyEmbedImages.Main) {
    const images = embed.images.map(
      (img): AppBskyEmbedImages.ViewImage => ({
        thumb: this.getImageUrl('feed_thumbnail', getBlobCidString(img.image)),
        fullsize: this.getImageUrl(
          'feed_fullsize',
          getBlobCidString(img.image),
        ),
        aspectRatio: img.aspectRatio,
        alt: img.alt,
      }),
    );
    return {
      $type: 'app.bsky.embed.images#view' as const,
      images,
    };
  }

  formatExternalEmbed(embed: AppBskyEmbedExternal.Main) {
    const { uri, title, description, thumb } = embed.external;
    return {
      $type: 'app.bsky.embed.external#view' as const,
      external: {
        uri,
        title,
        description,
        thumb: thumb
          ? this.getImageUrl('feed_thumbnail', getBlobCidString(thumb))
          : undefined,
      },
    };
  }

  async formatRecordEmbed(embed: AppBskyEmbedRecord.Main) {
    const view = await this.formatRecordEmbedInternal(embed);
    return {
      $type: 'app.bsky.embed.record#view' as const,
      record: view ?? {
        $type: 'app.bsky.embed.record.viewNotFound',
        uri: embed.record.uri,
        notFound: true,
      },
    };
  }

  private async formatRecordEmbedInternal(embed: AppBskyEmbedRecord.Main) {
    if (!this.bskyAppView) {
      return undefined;
    }
    const collection = new AtUri(embed.record.uri).collection;
    if (collection === 'app.bsky.feed.post') {
      const { headers } = await this.serviceAuthHeaders(
        this.did,
        app.bsky.feed.getPosts.$lxm,
      );
      const data = await this.bskyAppView.client.call(
        AppBskyFeedGetPosts.mainSchema,
        {
          uris: [embed.record.uri],
          headers,
        },
      );
      const post = data.posts[0];
      if (!post) return undefined;

      return {
        $type: 'app.bsky.embed.record#viewRecord' as const,
        uri: post.uri,
        cid: post.cid,
        author: post.author,
        value: post.record,
        labels: post.labels,
        embeds: post.embed ? [post.embed] : undefined,
        indexedAt: post.indexedAt,
      };
    } else if (collection === 'app.bsky.feed.generator') {
      const { headers } = await this.serviceAuthHeaders(
        this.did,
        app.bsky.feed.getFeedGenerator.$lxm,
      );
      const data = await this.bskyAppView.client.call(
        AppBskyFeedGetFeedGenerator.mainSchema,
        { feed: embed.record.uri, headers },
      );
      return {
        $type: 'app.bsky.feed.defs.generator#view' as const,
        ...data.view,
      };
    } else if (collection === 'app.bsky.graph.list') {
      const { headers } = await this.serviceAuthHeaders(
        this.did,
        app.bsky.graph.getList.$lxm,
      );
      const data = await this.bskyAppView.client.call(
        AppBskyGraphGetList.mainSchema,
        { list: embed.record.uri, headers },
      );
      return {
        $type: 'app.bsky.graph.defs.list#view' as const,
        ...data.list,
      };
    }
    return undefined;
  }

  async formatRecordWithMediaEmbed(embed: AppBskyEmbedRecordWithMedia.Main) {
    const media = is(AppBskyEmbedImages.mainSchema, embed.media)
      ? this.formatImageEmbed(embed.media)
      : is(AppBskyEmbedExternal.mainSchema, embed.media)
        ? this.formatExternalEmbed(embed.media)
        : null;

    if (!media) return undefined;

    const record = await this.formatRecordEmbed(embed.record);
    return {
      $type: 'app.bsky.embed.recordWithMedia#view' as const,
      record,
      media,
    };
  }

  updateProfileViewBasic<
    T extends
      | AppBskyActorDefs.ProfileViewDetailed
      | AppBskyActorDefs.ProfileViewBasic
      | AppBskyActorDefs.ProfileView,
  >(view: T, record: AppBskyActorProfile.Main): T {
    return {
      ...view,
      displayName: record.displayName,
      avatar: record.avatar
        ? this.getImageUrl('avatar', getBlobCidString(record.avatar))
        : undefined,
    };
  }

  updateProfileView<
    T extends
      | AppBskyActorDefs.ProfileViewDetailed
      | AppBskyActorDefs.ProfileViewBasic
      | AppBskyActorDefs.ProfileView,
  >(view: T, record: AppBskyActorProfile.Main): T {
    return {
      ...this.updateProfileViewBasic(view, record),
      description: record.description,
    };
  }

  updateProfileDetailed<T extends AppBskyActorDefs.ProfileViewDetailed>(
    view: T,
    record: AppBskyActorProfile.Main,
  ): T {
    return {
      ...this.updateProfileView(view, record),
      banner: record.banner
        ? this.getImageUrl('banner', getBlobCidString(record.banner))
        : undefined,
    };
  }
}
