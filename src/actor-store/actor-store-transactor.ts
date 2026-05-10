import { Keypair } from '@atproto/crypto'
import { ActorStoreResources } from './actor-store-resources.js'
import { ActorDb } from './db/index.js'
import { PreferenceTransactor } from './preference/transactor.js'
import { RecordTransactor } from './record/transactor.js'
import { RepoTransactor } from './repo/transactor.js'

export class ActorStoreTransactor {
  public readonly record: RecordTransactor
  public readonly repo: RepoTransactor
  public readonly pref: PreferenceTransactor
  public readonly did: string
  protected readonly db: ActorDb
  protected readonly keypair: Keypair
  protected readonly resources: ActorStoreResources

  constructor(
    did: string,
    db: ActorDb,
    keypair: Keypair,
    resources: ActorStoreResources,
  ) {
    this.did = did
    this.db = db
    this.keypair = keypair
    this.resources = resources

    const blobstore = resources.blobstore(did)

    this.record = new RecordTransactor(db, blobstore)
    this.pref = new PreferenceTransactor(db)
    this.repo = new RepoTransactor(
      db,
      blobstore,
      did,
      keypair,
      resources.backgroundQueue,
    )
  }
}
