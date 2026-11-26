#include <thread>
#include <condition_variable>
#include <atomic>
#include <cstdio>
#include <cstdlib>
#include <psibase/db.hpp>

#include <boost/filesystem/operations.hpp>
#include <psibase/CpuAccounting.hpp>
#include <psibase/Socket.hpp>
#include <psibase/nativeTables.hpp>
#include <psibase/storage.hpp>

namespace psibase
{
   static constexpr uint8_t revisionHeadPrefix = 0;
   static constexpr uint8_t revisionByIdPrefix = 1;
   static constexpr uint8_t subjectivePrefix   = 2;

   static const char revisionHeadKey[] = {revisionHeadPrefix};
   static const char subjectiveKey[]   = {subjectivePrefix};

   // TODO: should this be defined in a header or even loaded from the db?
   // It is not consensus, so it's somewhat safe to change it.
   static constexpr std::size_t maxSubjectiveTransactionDepth = 8;

   static auto revisionById(const Checksum256& blockId)
   {
      std::array<char, std::tuple_size<Checksum256>() + 1> result;
      result[0] = revisionByIdPrefix;
      memcpy(result.data() + 1, blockId.data(), blockId.size());
      return result;
   }

   namespace
   {
      bool isIndependent(DbId db)
      {
         return db >= DbId::beginIndependent && db < DbId::endIndependent;
      }
      std::uint32_t independentIndex(DbId db)
      {
         assert(isIndependent(db));
         return static_cast<std::uint32_t>(db) - static_cast<std::uint32_t>(DbId::beginIndependent);
      }

   }  // namespace

      struct Revision
   {
      storage::shared_root roots[numChainDatabases];

      Revision()                           = default;
      Revision(const Revision&)            = delete;
      Revision(Revision&&)                 = default;
      Revision& operator=(const Revision&) = delete;
      Revision& operator=(Revision&&)      = default;

      std::shared_ptr<Revision> clone() const
      {
         std::shared_ptr<Revision> result = std::make_shared<Revision>();

         for (uint32_t i = 0; i < numChainDatabases; ++i)
            result->roots[i] = roots[i];

         return result;
      }
   };  // Revision

   static std::shared_ptr<Revision> loadRevision(storage::write_session&     s,
                                                 const storage::shared_root& topRoot,
                                                 std::span<const char>       key,
                                                 bool                        nullIfNotFound = false)
   {
      auto                              revision = std::make_shared<Revision>();
      std::vector<storage::shared_root> roots;
      if (s.get(topRoot, key, nullptr, &roots))
      {
         check(roots.size() == numChainDatabases, "wrong number of roots in database");
         for (size_t i = 0; i < roots.size(); ++i)
            revision->roots[i] = std::move(roots[i]);
      }
      else if (nullIfNotFound)
         return nullptr;

      return revision;
   }

   struct SharedDatabaseImpl
   {
      std::shared_ptr<storage::database> trie;

      DatabaseCallbacks* callbacks = nullptr;

      mutable std::mutex   topMutex;
      storage::shared_root topRoot;

      mutable std::mutex              headMutex;
      std::shared_ptr<const Revision> head;

      // The write lock of the node-local (subjective) databases
      // (gofractally/psibase#2276). Whoever may change them holds it for as
      // long as it works on them: a section of a service from its start to
      // its commit or abort, native code for the one row it puts or
      // removes. So there is one writer at a time, what it publishes is
      // built on what was published last, nothing is compared or merged,
      // and a section never has to be run a second time. Reading never takes
      // it: a read made outside a section is a read of what was published
      // last, as a query reads the head block.
      //
      // Not a std::mutex: a section runs service code while it holds the
      // lock, and native code reached from that service code on the same
      // thread that tried to write the databases directly would wait for
      // itself for ever. That is refused with an error instead.
      class WriteLock
      {
         std::mutex              mutex;
         std::condition_variable released;
         bool                    held = false;
         std::thread::id         owner;

        public:
         void lock()
         {
            std::unique_lock l{mutex};
            if (held && owner == std::this_thread::get_id())
               throw std::runtime_error(
                   "the node-local database was written directly inside a section that is "
                   "writing it");
            released.wait(l, [&] { return !held; });
            held  = true;
            owner = std::this_thread::get_id();
         }
         bool try_lock()
         {
            std::lock_guard l{mutex};
            if (held)
               return false;
            held  = true;
            owner = std::this_thread::get_id();
            return true;
         }
         void unlock()
         {
            {
               std::lock_guard l{mutex};
               held  = false;
               owner = {};
            }
            released.notify_one();
         }
      };
      mutable WriteLock subjectiveMutex;
      // Guards only the value of `subjective`. A writer
      // holds subjectiveMutex for as long as it is writing;
      // readers that only need the current roots must not wait behind that.
      // Every execution context takes those roots when it is created, and on
      // a producer verifying signatures a sixth of the main thread's time
      // was spent waiting here for the service thread's commits.
      // Lock order: subjectiveMutex, then this.
      mutable std::mutex  subjectiveSnapshotMutex;
      void setSubjective(IndependentRevision&& next)
      {
         std::lock_guard l{subjectiveSnapshotMutex};
         subjective = std::move(next);
      }
      IndependentRevision subjective;

      static constexpr auto numPersistentDatabases =
          static_cast<std::uint32_t>(DbId::endPersistent) -
          static_cast<std::uint32_t>(DbId::beginIndependent);

      SharedDatabaseImpl(const std::filesystem::path&    dir,
                         const storage::database_config& config,
                         storage::open_mode              targetMode)
      {
         // The largest object is 16 MiB
         // Each file must be at least double this
         constexpr std::uint64_t min_size = 32 * 1024 * 1024;
         if (config.hot_bytes < min_size || config.warm_bytes < min_size ||
             config.cool_bytes < min_size || config.cold_bytes < min_size)
         {
            throw std::runtime_error("Requested database size is too small");
         }
         auto nativeDirectory = dir;
         if (targetMode != storage::open_mode::temporary)
         {
            // The node directory also owns configuration, logs and secrets.
            // Keep the strictly identified native store in its own namespace.
            // Never silently start a fresh chain over a prior storage layout.
            for (const char* marker : {"db", "psibase-storage-format", "roots", "segs"})
               if (std::filesystem::exists(dir / marker))
                  throw std::runtime_error(
                      "Database uses a previous storage layout; use a fresh chain directory");
            nativeDirectory /= "state";
         }
         trie = std::make_shared<storage::database>(nativeDirectory, config, targetMode);
         auto s  = trie->start_write_session();
         topRoot = s->get_top_root();
         head    = loadRevision(*s, topRoot, revisionHeadKey);

         // Persistent subjective state lives under the store's local root: it is
         // published without flushing and without touching the consensus manifest.
         // (A store written before the local root existed kept it in the top root.)
         std::vector<storage::shared_root> roots;
         if (s->get(s->get_local_root(), subjectiveKey, nullptr, &roots) ||
             s->get(topRoot, subjectiveKey, nullptr, &roots))
         {
            check(roots.size() == numPersistentDatabases, "Wrong number of subjective databases");
            for (std::size_t i = 0; i < numPersistentDatabases; ++i)
               subjective[i] = roots[i];
         }
      }

      SharedDatabaseImpl(const SharedDatabaseImpl& other)
      {
         std::scoped_lock lock(other.topMutex, other.headMutex, other.subjectiveMutex);
         trie       = other.trie->clone();
         topRoot    = other.topRoot;
         head       = other.head;
         subjective = other.subjective;
      }

      auto getTopRoot()
      {
         std::lock_guard lock{topMutex};
         return topRoot;
      }

      auto getNativeSubjective(DbId db = DbId::nativeSubjective)
      {
         std::lock_guard l{subjectiveSnapshotMutex};
         return subjective[independentIndex(db)];
      }

      auto getHead()
      {
         std::lock_guard<std::mutex> lock(headMutex);
         return head;
      }

      void setHead(storage::write_session& session, std::shared_ptr<const Revision> r)
      {
         check(trie->owns(session), "writer belongs to another database view");
         std::optional<accounting::Publication> publication;
         {
            std::lock_guard lock{topMutex};
            auto            proposed = topRoot;
            session.upsert(proposed, revisionHeadKey, r->roots);
            publication.emplace();
            session.set_top_root(proposed);
            topRoot = std::move(proposed);
         }
         {
            std::lock_guard<std::mutex> lock(headMutex);
            head = std::move(r);
         }
         publication->finish();
      }

      void writeRevision(storage::write_session& session,
                         const Checksum256&      blockId,
                         const Revision&         r)
      {
         check(trie->owns(session), "writer belongs to another database view");
         std::lock_guard lock{topMutex};
         auto            proposed = topRoot;
         session.upsert(proposed, revisionById(blockId), r.roots);
         accounting::Publication publication;
         session.set_top_root(proposed);
         topRoot = std::move(proposed);
         publication.finish();
      }

      // Publish the persistent subjective databases. Caller holds subjectiveMutex.
      // Independent of topMutex: block publication and subjective commits only
      // meet at the engine's single-writer step, never across a flush.
      void publishSubjective(storage::write_session& session, const IndependentRevision& proposed)
      {
         auto local = session.get_local_root();
         session.upsert(local, subjectiveKey, std::span(proposed).first(numPersistentDatabases));
         session.set_local_root(std::move(local));
      }

      std::span<DbPtr> persistent()
      {
         return std::span{subjective}.subspan(0, numPersistentDatabases);
      }
      std::span<DbPtr> session() { return std::span{subjective}.subspan(numPersistentDatabases); }
   };  // SharedDatabaseImpl

   SharedDatabase::SharedDatabase(const std::filesystem::path&    dir,
                                  const storage::database_config& config,
                                  storage::open_mode              mode)
       : impl{std::make_shared<SharedDatabaseImpl>(dir, config, mode)}
   {
   }

   SharedDatabase SharedDatabase::clone() const
   {
      SharedDatabase result{*this};
      result.impl = std::make_shared<SharedDatabaseImpl>(*impl);
      for (auto& sessionRoot : result.impl->session())
      {
         sessionRoot.reset();
      }
      return result;
   }

   storage::cache_root SharedDatabase::cacheRoot() const
   {
      return impl->trie->get_cache_root();
   }

   ConstRevisionPtr SharedDatabase::getHead()
   {
      return impl->getHead();
   }

   ConstRevisionPtr SharedDatabase::emptyRevision()
   {
      return std::make_shared<Revision>();
   }

   WriterPtr SharedDatabase::createWriter()
   {
      return impl->trie->start_write_session();
   }

   void SharedDatabase::setHead(Writer& writer, ConstRevisionPtr revision)
   {
      return impl->setHead(writer, revision);
   }

   ConstRevisionPtr SharedDatabase::getRevision(Writer& writer, const Checksum256& blockId)
   {
      check(impl->trie->owns(writer), "writer belongs to another database view");
      return loadRevision(writer, impl->getTopRoot(), revisionById(blockId), true);
   }

      void SharedDatabase::removeRevisions(Writer& writer, const Checksum256& irreversible)
   {
      check(impl->trie->owns(writer), "writer belongs to another database view");
      auto nativeSubjective = impl->getNativeSubjective();
      std::lock_guard lock{impl->topMutex};
      auto proposed         = impl->topRoot;
      std::vector<char> key{revisionByIdPrefix};
      std::vector<char> tmpKey;
      bool              hasIrreversible = false;

      // Remove everything with a blockNum <= irreversible's, except irreversible
      // and saved snapshots.
      while (writer.get_greater_equal(proposed, key, &key, nullptr, nullptr))
      {
         if (key.size() != 1 + irreversible.size() || key[0] != revisionByIdPrefix ||
             memcmp(key.data() + 1, irreversible.data(), sizeof(BlockNum)) > 0)
            break;
         Checksum256 id;
         std::memcpy(id.data(), key.data() + 1, id.size());
         if (id == irreversible)
         {
            hasIrreversible = true;
         }
         else
         {
            tmpKey.clear();
            psio::to_key(snapshotKey(id), tmpKey);
            if (!writer.get(nativeSubjective, tmpKey))
               writer.remove(proposed, key);
         }
         key.push_back(0);
      }

      if (hasIrreversible)
      {
         // Remove everything with a blockNum > irreversible's which builds on a block
         // no longer present.
         std::vector<storage::shared_root> roots;
         std::vector<char>                 statusBytes;
         auto                              sk = psio::to_key(statusKey());
         while (writer.get_greater_equal(proposed, key, &key, nullptr, &roots))
         {
            if (key.size() != 1 + irreversible.size() || key[0] != revisionByIdPrefix)
               break;
            check(roots.size() == numChainDatabases, "wrong number of roots in fork");
            if (!writer.get(roots[(int)StatusRow::db], sk, &statusBytes, nullptr))
               throw std::runtime_error("Status row missing in fork");
            auto status = psio::from_pssz<StatusRow>(psio::trusted{statusBytes});
            if (!status.head)
               throw std::runtime_error("Status row is missing head information in fork");
            if (!writer.get(proposed, revisionById(status.head->header.previous), nullptr, nullptr))
               writer.remove(proposed, key);
            key.push_back(0);
         }
      }

      accounting::Publication publication;
      writer.set_top_root(proposed);
      impl->topRoot = std::move(proposed);
      publication.finish();
   }  // removeRevisions

   void SharedDatabase::kvPutSubjective(Writer&               writer,
                                        DbId                  db,
                                        std::span<const char> key,
                                        std::span<const char> value)
   {
      check(impl->trie->owns(writer), "writer belongs to another database view");
      std::lock_guard l{impl->subjectiveMutex};
      auto            proposedSubjective = impl->subjective;
      writer.upsert(proposedSubjective[independentIndex(db)], key, value);
      accounting::Publication publication;
      impl->publishSubjective(writer, proposedSubjective);
      impl->setSubjective(std::move(proposedSubjective));
      publication.finish();
   }

   void SharedDatabase::kvRemoveSubjective(Writer& writer, DbId db, std::span<const char> key)
   {
      check(impl->trie->owns(writer), "writer belongs to another database view");
      std::lock_guard l{impl->subjectiveMutex};
      auto            proposedSubjective = impl->subjective;
      writer.remove(proposedSubjective[independentIndex(db)], key);
      accounting::Publication publication;
      impl->publishSubjective(writer, proposedSubjective);
      impl->setSubjective(std::move(proposedSubjective));
      publication.finish();
   }

   std::optional<std::vector<char>> SharedDatabase::kvGetSubjective(Writer&               reader,
                                                                    DbId                  db,
                                                                    std::span<const char> key)
   {
      check(impl->trie->owns(reader), "writer belongs to another database view");
      auto root = impl->getNativeSubjective(db);
      return reader.get(root, key);
   }

   IndependentRevision SharedDatabase::getSubjective()
   {
      std::lock_guard l{impl->subjectiveSnapshotMutex};
      return impl->subjective;
   }

   void SharedDatabase::lockSubjective()
   {
      impl->subjectiveMutex.lock();
   }

   void SharedDatabase::unlockSubjective()
   {
      impl->subjectiveMutex.unlock();
   }

   // The caller holds the write lock and built `updated` on what was
   // published last, so publishing is replacing the roots. Nothing the
   // caller's callbacks need is called from here: no lock of these
   // databases may be held when they run.
   bool SharedDatabase::publishSubjective(Writer&              writer,
                                          IndependentRevision  updated,
                                          SocketChangeSet&&    socketChanges,
                                          Sockets&             sockets,
                                          SocketAutoCloseSet&  closing)
   {
      check(impl->trie->owns(writer), "writer belongs to another database view");
      // Only the irreversible effects are accepted/uncancellable.
      accounting::Publication publication;
      // Applying socket changes can start delivery on a socket (the recv
      // flag), and the action that handles the first message runs on
      // another thread and takes the current subjective roots. It must
      // see the rows this commit writes for that socket, so when there
      // are socket changes readers of the roots are held from the moment
      // the changes apply until the new roots are in place. A proxy lost
      // the first message of a connection through that window. Commits
      // without socket changes, the common case, do not hold readers.
      std::unique_lock snapshot{impl->subjectiveSnapshotMutex, std::defer_lock};
      if (!socketChanges.empty())
         snapshot.lock();
      if (!sockets.applyChanges(std::move(socketChanges), &closing, impl->callbacks))
      {
         publication.finish();
         return false;
      }
      impl->publishSubjective(writer, updated);
      if (snapshot.owns_lock())
         impl->subjective = std::move(updated);
      else
         impl->setSubjective(std::move(updated));
      publication.finish();
      return true;
   }

   std::optional<bool> SharedDatabase::isSlow() const
   {
      return impl->trie->is_slow();
   }

   std::filesystem::path SharedDatabase::directory() const
   {
      return impl->trie->directory();
   }

   void SharedDatabase::setCallbacks(DatabaseCallbacks* callbacks)
   {
      impl->callbacks = callbacks;
   }

   DatabaseCallbacks* SharedDatabase::getCallbacks() const
   {
      return impl->callbacks;
   }

   struct SubjectiveRevision
   {
      std::size_t                                      socketChangePos;
      IndependentRevision                              db;
      DbPtr                                            temporaryDb;
   };


   // Prints the per-database write counts and returns their sum.
   std::uint64_t psibaseWriteCountsHook();
   struct DatabaseImpl
   {
      SharedDatabase                          shared;
      std::shared_ptr<const Revision>         baseRevision;
      std::shared_ptr<storage::write_session> writeSession;
      std::shared_ptr<storage::read_session>  readSession;
      std::shared_ptr<const Revision>         readOnlyRevision;

      // The open write session. Writes to the chain databases are not made to
      // the trees: they are kept aside, one set of changes per database, and
      // reads see them merged over the tree. They become trees only when a
      // revision is asked for (the end of a block, normally), in one ordered
      // edit per database. A session that is abandoned, which is every
      // speculative execution, never writes to the store at all and so never
      // waits for, or holds up, the store's writer.
      //
      // `work` holds the trees the changes sit on. A nested session is a mark
      // in each set of changes plus the trees as they were, so abandoning it
      // is a rollback to the mark.
      struct Frame
      {
         storage::shared_root  roots[numChainDatabases];
         storage::delta::mark  marks[numChainDatabases];
      };
      bool                                           writing = false;
      Revision                                       work;
      std::array<storage::delta, numChainDatabases>  pending;
      std::vector<Frame>                             frames;
      // The changes of one database are folded into its tree early once they
      // hold this much; their memory is one region of at most 4 GiB. The most
      // a session can hold aside is therefore this plus one value (16 MiB at
      // most) for each chain database. The region is given back to the
      // allocator, not kept on the thread, once it has grown past 8 MiB.
      static constexpr std::uint64_t foldBytes = std::uint64_t(256) << 20;
      std::vector<char>                       keyBuffer;
      std::vector<char>                       valueBuffer;

      DbPtr                           temporaryDb;
      // A section's hold on the write lock of the node-local databases
      // (SharedDatabaseImpl::subjectiveMutex). A section is how these
      // databases are written: it takes the lock when it starts and keeps
      // it until it has committed or is abandoned, so it works on the
      // published state, nobody else can publish meanwhile, and it is never
      // run a second time because of another writer. Reading needs no
      // section: outside one, every read is of what was published last
      // and takes no lock. (Reads inside a section see the section's own
      // changes.)
      //
      // The lock is held while the section's service code runs. If that
      // code has to wait for another service to be compiled, the other
      // writers wait with it. Giving the lock up and running the section
      // again in that case is possible, but it is rare and was judged not
      // worth the complexity.
      bool subjectiveLocked   = false;
      // The published roots, for reads outside a section.
      IndependentRevision subjectiveHead;
      // Something was written, so there is something to publish.
      bool subjectiveDirty    = false;
      // checkoutEmptySubjective: a section on empty databases that is never
      // published (a speculative run). It takes no lock.
      bool subjectiveIsolated = false;
      void subjectiveWrite()
      {
         check(!subjectiveRevisions.empty(),
               "subjectiveCheckout is required to write the subjective database");
         subjectiveDirty = true;
      }
      void releaseSubjective()
      {
         if (subjectiveLocked)
            shared.unlockSubjective();
         subjectiveLocked   = false;
         subjectiveDirty    = false;
         subjectiveIsolated = false;
      }
      std::vector<SocketChange>       socketChanges;
      std::vector<SubjectiveRevision> subjectiveRevisions;
      std::size_t                     subjectiveLimit;
      DatabaseCallbacks::Flags        callbackFlags = {};

      auto db(auto& revision, DbId db) -> decltype((revision.roots[(int)db]))
      {
         if (isIndependent(db))
         {
            if (subjectiveRevisions.empty())
            {
               // Not in a section: what is published now. (A write is
               // refused before it gets here, see subjectiveWrite.)
               subjectiveHead = shared.getSubjective();
               return subjectiveHead[independentIndex(db)];
            }
            return subjectiveRevisions.back().db[independentIndex(db)];
         }
         else if (db == DbId::temporary)
         {
            if (!subjectiveRevisions.empty())
            {
               return subjectiveRevisions.back().temporaryDb;
            }
            else
            {
               return temporaryDb;
            }
         }
         else
         {
            return revision.roots[(int)db];
         }
      }

      // Chain databases keep their changes aside; node-local ones are edited as trees.
      static bool keptAside(DbId db) { return !isIndependent(db) && db != DbId::temporary; }
      const storage::delta* pendingFor(DbId db) const
      {
         if (!writing || !keptAside(db))
            return nullptr;
         const auto& changes = pending[(int)db];
         return changes.empty() ? nullptr : &changes;
      }
      void put(storage::write_session& session,
               DbId                    db,
               std::span<const char>   key,
               std::span<const char>   value)
      {
         session.require_writable();
         // No store work happens here, but every storage call is a point
         // where an exhausted budget stops the caller.
         accounting::check();
         auto& changes = pending[(int)db];
         changes.put(key, value);
         if (changes.bytes() > foldBytes)
            fold();
      }
      void erase(storage::write_session& session, DbId db, std::span<const char> key)
      {
         session.require_writable();
         accounting::check();
         pending[(int)db].erase(key);
      }
      // Make the trees current: apply every database's changes to its tree and
      // drop them. Each open nested session's saved trees are brought up to its
      // own mark first, so rolling back to it still gives what it saw.
      //
      // The order of the steps is what makes this safe to interrupt. apply()
      // replaces a root only once its whole edit has succeeded, and it can
      // throw part-way (the caller's budget is checked for every key). Each
      // frame's tree is brought up to its mark and the mark reset together,
      // and the session's own tree is brought up before the changes are
      // cleared; whichever step an exception leaves from, every frame's tree
      // plus its mark, and the session's tree plus the changes, still describe
      // the same contents as before. Do not reorder.
      //
      // Cost: one edit per database for the session and one more per open
      // nested session. Meant for once per block (or per snapshot batch), not
      // once per transaction.
      //
      // When reached from put(), it runs under the budget of whatever
      // transaction made the write, and a cancellation there fails that
      // transaction like any other storage call it makes. The fold that ends
      // a block runs from writeRevision(), outside any transaction.
      void fold()
      {
         check((bool)writeSession, "writeSession is missing");
         for (std::size_t i = 0; i < numChainDatabases; ++i)
         {
            auto& changes = pending[i];
            if (changes.empty())
               continue;
            for (auto& frame : frames)
            {
               writeSession->apply(frame.roots[i], changes, &frame.marks[i]);
               frame.marks[i] = {};
            }
            writeSession->apply(work.roots[i], changes);
            changes.clear();
         }
      }
      void endWrite()
      {
         writing = false;
         frames.clear();
         for (auto& changes : pending)
            changes.clear();
         for (auto& root : work.roots)
            root.reset();
      }


      template <typename F>
      auto read(F f)
      {
         const auto& revision = [this]() -> const Revision&
         {
            if (readOnlyRevision)
               return *readOnlyRevision;
            check(writing, "no database sessions active");
            return work;
         }();

         if (readSession)
            return f(*readSession, revision);
         else if (writeSession)
            return f(*writeSession, revision);
         else
            throw std::runtime_error("no database sessions active");
      }

      template <typename F>
      auto write(F f)
      {
         check(writeSession && writing, "no database write sessions active");
         return f(*writeSession, work);
      }

      // TODO: release old revision roots in GC thread
      void setRevision(ConstRevisionPtr revision)
      {
         check(!writing && !readOnlyRevision, "setRevision: database session is active");
         check(revision != nullptr, "null revision");
         baseRevision = std::move(revision);
      }

      void startRead()
      {
         check(!writing && !readOnlyRevision, "startRead: database session already active");
         if (!readSession && !writeSession)
            readSession = shared.impl->trie->start_read_session();
         readOnlyRevision = baseRevision;
      }

      void startWrite(WriterPtr writer)
      {
         check(!readOnlyRevision, "startWrite: can't mix read and write revisions");
         check(writer != nullptr, "startWrite: writer is null");
         check(shared.impl->trie->owns(*writer), "writer belongs to another database view");
         writeSession = std::move(writer);
         readSession  = nullptr;
         if (!writing)
         {
            for (std::size_t i = 0; i < numChainDatabases; ++i)
               work.roots[i] = baseRevision->roots[i];
            writing = true;
         }
         else
         {
            auto& frame = frames.emplace_back();
            for (std::size_t i = 0; i < numChainDatabases; ++i)
            {
               frame.roots[i] = work.roots[i];
               frame.marks[i] = pending[i].save();
            }
         }
      }

      void commit()
      {
         if (readOnlyRevision)
            readOnlyRevision = nullptr;
         else if (writing && frames.empty())
            throw std::runtime_error("final commit needs writeRevision()");
         else if (writing)
            frames.pop_back();  // the nested session's changes stay
         else
            throw std::runtime_error("mismatched commit");
      }

      ConstRevisionPtr writeRevision(const Checksum256& blockId)
      {
         check((bool)writeSession, "writeSession is missing");
         check(writing && frames.empty(), "not final commit");
         fold();
         auto rev = work.clone();
         shared.impl->writeRevision(*writeSession, blockId, *rev);
         baseRevision = std::move(rev);
         endWrite();
         return baseRevision;
      }

      void abort()
      {
         if (readOnlyRevision)
            readOnlyRevision = nullptr;
         else if (writing && frames.empty())
            endWrite();
         else if (writing)
         {
            auto& frame = frames.back();
            for (std::size_t i = 0; i < numChainDatabases; ++i)
            {
               work.roots[i] = std::move(frame.roots[i]);
               pending[i].restore(frame.marks[i]);
            }
            frames.pop_back();
         }
      }

      // The state of the open write session as trees.
      ConstRevisionPtr modifiedRevision()
      {
         if (!writing)
            return baseRevision;
         fold();
         return work.clone();
      }

      void checkoutEmptySubjective()
      {
         check(subjectiveRevisions.empty(),
               "Checking out specific subjective content is only possible at the top level");
         subjectiveRevisions.resize(2);
         subjectiveIsolated = true;
         callbackFlags      = 0;
      }

      void checkoutSubjective()
      {
         check(subjectiveRevisions.size() <= maxSubjectiveTransactionDepth,
               "checkoutSubjective nesting exceeded limit");
         if (subjectiveRevisions.empty())
         {
            // Without a write session nothing can be published.
            if (writeSession)
            {
               shared.lockSubjective();
               subjectiveLocked = true;
            }
            subjectiveRevisions.push_back({0, shared.getSubjective(), temporaryDb});
            callbackFlags = 0;
         }
         subjectiveRevisions.push_back({socketChanges.size(), subjectiveRevisions.back().db,
                                        subjectiveRevisions.back().temporaryDb});
      }

      bool commitSubjective(Sockets& sockets, SocketAutoCloseSet& closing)
      {
         check(subjectiveRevisions.size() > subjectiveLimit,
               "commitSubjective requires checkoutSubjective");
         if (subjectiveRevisions.size() > 2)
         {
            subjectiveRevisions[subjectiveRevisions.size() - 2].db =
                std::move(subjectiveRevisions.back().db);
            subjectiveRevisions[subjectiveRevisions.size() - 2].temporaryDb =
                std::move(subjectiveRevisions.back().temporaryDb);
            subjectiveRevisions.pop_back();
            return true;
         }
         assert(subjectiveRevisions.size() == 2);
         DatabaseCallbacks::Flags flags = {};
         if (writeSession && !subjectiveIsolated)
         {
            if (subjectiveLocked && (subjectiveDirty || !socketChanges.empty()))
            {
               if (!shared.publishSubjective(*writeSession, subjectiveRevisions.back().db,
                                             std::move(socketChanges), sockets, closing))
               {
                  // The socket changes could not be applied (a socket went
                  // away meanwhile). Nothing was published; the caller runs
                  // the section again on what is published, which is what
                  // it started from: the lock is still held.
                  subjectiveRevisions[1].db              = subjectiveRevisions[0].db;
                  subjectiveRevisions[1].temporaryDb     = subjectiveRevisions[0].temporaryDb;
                  subjectiveRevisions[0].socketChangePos = 0;
                  subjectiveRevisions[1].socketChangePos = 0;
                  socketChanges.clear();
                  return false;
               }
            }
            temporaryDb = std::move(subjectiveRevisions.back().temporaryDb);
            flags       = callbackFlags;
         }
         subjectiveRevisions.clear();
         socketChanges.clear();
         releaseSubjective();
         // After the lock is released: a callback takes locks of its own
         // (the run queue's), and a thread that holds one of those may be
         // starting a section.
         if (flags && shared.impl->callbacks)
         {
            accounting::Publication publication;
            shared.impl->callbacks->run(flags);
            publication.finish();
         }
         return true;
      }
      void abortSubjective()
      {
         check(subjectiveRevisions.size() > subjectiveLimit,
               "abortSubjective requires checkoutSubjective");
         if (subjectiveRevisions.size() > 2)
         {
            assert(subjectiveRevisions.back().socketChangePos <= socketChanges.size());
            socketChanges.resize(subjectiveRevisions.back().socketChangePos);
            subjectiveRevisions.pop_back();
         }
         else
         {
            assert(subjectiveRevisions.size() == 2);
            subjectiveRevisions.clear();
            socketChanges.clear();
            releaseSubjective();
         }
      }
      std::int32_t socketSetFlags(std::int32_t        socket,
                                  std::uint32_t       mask,
                                  std::uint32_t       value,
                                  Sockets&            sockets,
                                  SocketAutoCloseSet& closing)
      {
         return sockets.setFlags(socket, mask, value, &closing,
                                 subjectiveRevisions.empty() ? nullptr : &socketChanges);
      }
      std::int32_t socketEnableP2P(std::int32_t        socket,
                                   Sockets&            sockets,
                                   SocketAutoCloseSet& closing)
      {
         const auto* callbacks = shared.getCallbacks();
         if (!callbacks || !callbacks->socketP2P)
            abortMessage("P2P not supported");
         return sockets.enableP2P(socket, &closing,
                                  subjectiveRevisions.empty() ? nullptr : &socketChanges,
                                  callbacks->socketP2P);
      }
      std::size_t saveSubjective()
      {
         auto result     = subjectiveLimit;
         subjectiveLimit = subjectiveRevisions.size();
         return result;
      }
      void restoreSubjective(std::size_t depth)
      {
         check(depth <= subjectiveLimit, "Wrong subjective depth");
         if (subjectiveLimit == 0)
         {
            subjectiveRevisions.clear();
            socketChanges.clear();
            releaseSubjective();
         }
         else if (subjectiveLimit < subjectiveRevisions.size())
         {
            socketChanges.resize(subjectiveRevisions[subjectiveLimit].socketChangePos);
            subjectiveRevisions.resize(subjectiveLimit);
         }
         subjectiveLimit = depth;
      }

      void clearTemporary()
      {
         check(subjectiveRevisions.empty(),
               "Cannot clear subjective db while a subjective transaction is pending");
         temporaryDb.reset();
      }
   };  // DatabaseImpl

   Database::Database(SharedDatabase shared, ConstRevisionPtr revision)
   {
      check(shared.impl != nullptr, "SharedDatabase is null");
      check(revision != nullptr, "Revision is null");
      impl = std::make_unique<DatabaseImpl>(DatabaseImpl{std::move(shared), std::move(revision)});
   }

   Database::~Database()
   {
      if (impl)
         impl->releaseSubjective();
   }

   void Database::setRevision(ConstRevisionPtr revision)
   {
      impl->setRevision(std::move(revision));
   }

   ConstRevisionPtr Database::getBaseRevision()
   {
      return impl->baseRevision;
   }

   ConstRevisionPtr Database::getModifiedRevision()
   {
      return impl->modifiedRevision();
   }

   Database::Session Database::startRead()
   {
      impl->startRead();
      return {this};
   }

   Database::Session Database::startWrite(WriterPtr writer)
   {
      impl->startWrite(writer);
      return {this};
   }

   void Database::commit(Database::Session&)
   {
      impl->commit();
   }

   ConstRevisionPtr Database::writeRevision(Database::Session& session, const Checksum256& blockId)
   {
      return impl->writeRevision(blockId);
   }

   void Database::abort(Database::Session&)
   {
      impl->abort();
   }

   ConstRevisionPtr Database::getPrevAuthServices()
   {
      return impl->read(
          [&](auto& session, auto& revision) -> ConstRevisionPtr
          {
             auto        index  = static_cast<std::uint32_t>(DbId::prevAuthServices);
             auto        native = static_cast<std::uint32_t>(DbId::native);
             const auto& root   = revision.roots[index];
             // Only ever replaced whole (setPrevAuthServices); a write kept
             // aside for it would not be seen here.
             check(impl->pending[index].empty(), "prevAuthServices has pending changes");
             if (!session.is_empty(root, {}, {}))
             {
                auto result           = std::make_shared<Revision>();
                result->roots[native] = root;
                return result;
             }
             else
             {
                return nullptr;
             }
          });
   }

   void Database::setPrevAuthServices(ConstRevisionPtr revision)
   {
      impl->write(
          [&](auto& session, auto& writeRevision)
          {
             auto index  = static_cast<std::uint32_t>(DbId::prevAuthServices);
             auto native = static_cast<std::uint32_t>(DbId::native);
             check(impl->pending[index].empty(), "prevAuthServices has pending changes");
             if (revision)
             {
                writeRevision.roots[index] = revision->roots[native];
             }
             else
             {
                writeRevision.roots[index] = nullptr;
             }
          });
   }

   void Database::checkoutEmptySubjective()
   {
      impl->checkoutEmptySubjective();
   }
   void Database::checkoutSubjective()
   {
      impl->checkoutSubjective();
   }
   bool Database::commitSubjective(Sockets& sockets, SocketAutoCloseSet& closing)
   {
      return impl->commitSubjective(sockets, closing);
   }
   void Database::abortSubjective()
   {
      impl->abortSubjective();
   }
   std::int32_t Database::socketSetFlags(std::int32_t        socket,
                                         std::uint32_t       mask,
                                         std::uint32_t       value,
                                         Sockets&            sockets,
                                         SocketAutoCloseSet& closing)
   {
      return impl->socketSetFlags(socket, mask, value, sockets, closing);
   }
   std::int32_t Database::socketEnableP2P(std::int32_t        socket,
                                          Sockets&            sockets,
                                          SocketAutoCloseSet& closing)
   {
      return impl->socketEnableP2P(socket, sockets, closing);
   }
   std::size_t Database::saveSubjective()
   {
      return impl->saveSubjective();
   }
   void Database::restoreSubjective(std::size_t depth)
   {
      impl->restoreSubjective(depth);
   }

   void Database::clearTemporary()
   {
      impl->clearTemporary();
   }


   // With PSIBASE_CALL_PROFILE set: writes per logical database, printed with
   // the subjective commit counts.
   namespace
   {
      std::atomic<std::uint64_t> writeCounts[8];
      const bool countWrites = std::getenv("PSIBASE_CALL_PROFILE") != nullptr;
      std::size_t writeSlot(DbId db)
      {
         switch (db)
         {
            case DbId::service:          return 0;
            case DbId::writeOnly:        return 1;
            case DbId::native:           return 2;
            case DbId::subjective:       return 3;
            case DbId::nativeSubjective: return 4;
            case DbId::session:          return 5;
            case DbId::nativeSession:    return 6;
            default:                     return 7;
         }
      }
   }  // namespace

   std::uint64_t psibaseWriteCountsHook()
   {
      static const char* names[8] = {"service", "writeOnly", "native", "subjective",
                                     "nativeSubjective", "session", "nativeSession", "other"};
      std::uint64_t total = 0;
      std::fprintf(stderr, "WRITES");
      for (int i = 0; i < 8; ++i)
      {
         auto v = writeCounts[i].load();
         total += v;
         std::fprintf(stderr, " %s=%llu", names[i], (unsigned long long)v);
      }
      std::fprintf(stderr, "\n");
      return total;
   }
   void Database::kvPutRaw(DbId db, std::span<const char> key, std::span<const char> value)
   {
      if (countWrites)
         ++writeCounts[writeSlot(db)];
      impl->write(
          [&](auto& session, auto& revision)
          {
             if (isIndependent(db))
                impl->subjectiveWrite();
             if (impl->keptAside(db))
                impl->put(session, db, std::string_view{key.data(), key.size()}, std::string_view{value.data(), value.size()});
             else
                session.upsert(impl->db(revision, db), std::string_view{key.data(), key.size()}, std::string_view{value.data(), value.size()});
          });
   }

   void Database::kvRemoveRaw(DbId db, std::span<const char> key)
   {
      if (countWrites)
         ++writeCounts[writeSlot(db)];
      impl->write(
          [&](auto& session, auto& revision)
          {
             if (isIndependent(db))
                impl->subjectiveWrite();
             if (impl->keptAside(db))
                impl->erase(session, db, std::string_view{key.data(), key.size()});
             else
                session.remove(impl->db(revision, db), std::string_view{key.data(), key.size()});
          });
   }

   std::optional<std::span<const char>> Database::kvGetRaw(DbId db, std::span<const char> key)
   {
      return impl->read(
          [&](auto& session, auto& revision) -> std::optional<std::span<const char>>
          {
             const auto* pending = impl->pendingFor(db);
             if (!(pending ? session.get(impl->db(revision, db), *pending, std::string_view{key.data(), key.size()},
                                         &impl->valueBuffer)
                           : session.get(impl->db(revision, db), std::string_view{key.data(), key.size()},
                                         &impl->valueBuffer, nullptr)))
             {
                return {};
             }

             return {{impl->valueBuffer}};
          });
   }  // Database::kvGetRaw

   bool Database::kvContains(DbId db, std::span<const char> key)
   {
      return impl->read(
          [&](auto& session, auto& revision) -> bool
          {
             if (const auto* pending = impl->pendingFor(db))
                return session.get(impl->db(revision, db), *pending, std::string_view{key.data(), key.size()}, nullptr);
             return session.get(impl->db(revision, db), std::string_view{key.data(), key.size()}, nullptr, nullptr);
          });
   }

   std::optional<Database::KVResult> Database::kvGreaterEqualRaw(DbId               db,
                                                                 std::span<const char> key,
                                                                 size_t             matchKeySize)
   {
      return impl->read(
          [&](auto& session, auto& revision) -> std::optional<Database::KVResult>
          {
             const auto* pending = impl->pendingFor(db);
             auto        found =
                 pending ? session.get_greater_equal(impl->db(revision, db), *pending, std::string_view{key.data(), key.size()},
                                      &impl->keyBuffer, &impl->valueBuffer)
                         : session.get_greater_equal(impl->db(revision, db), std::string_view{key.data(), key.size()},
                                      &impl->keyBuffer, &impl->valueBuffer, nullptr);
             if (found && (impl->keyBuffer.size() < matchKeySize ||
                           (matchKeySize && memcmp(impl->keyBuffer.data(), key.data(), matchKeySize))))
                found = false;

             if (!found)
             {
                return {};
             }

             return {{{impl->keyBuffer}, {impl->valueBuffer}}};
          });
   }  // Database::kvGreaterEqualRaw

   std::optional<Database::KVResult> Database::kvLessThanRaw(DbId               db,
                                                             std::span<const char> key,
                                                             size_t             matchKeySize)
   {
      return impl->read(
          [&](auto& session, auto& revision) -> std::optional<Database::KVResult>
          {
             const auto* pending = impl->pendingFor(db);
             auto        found =
                 pending ? session.get_less_than(impl->db(revision, db), *pending, std::string_view{key.data(), key.size()},
                                      &impl->keyBuffer, &impl->valueBuffer)
                         : session.get_less_than(impl->db(revision, db), std::string_view{key.data(), key.size()},
                                      &impl->keyBuffer, &impl->valueBuffer, nullptr);
             if (found && (impl->keyBuffer.size() < matchKeySize ||
                           (matchKeySize && memcmp(impl->keyBuffer.data(), key.data(), matchKeySize))))
                found = false;

             if (!found)
             {
                return {};
             }

             return {{{impl->keyBuffer}, {impl->valueBuffer}}};
          });
   }  // Database::kvLessThanRaw

   std::optional<Database::KVResult> Database::kvMaxRaw(DbId db, std::span<const char> key)
   {
      return impl->read(
          [&](auto& session, auto& revision) -> std::optional<Database::KVResult>
          {
             const auto* pending = impl->pendingFor(db);
             auto        found =
                 pending ? session.get_max(impl->db(revision, db), *pending, std::string_view{key.data(), key.size()},
                                           &impl->keyBuffer, &impl->valueBuffer)
                         : session.get_max(impl->db(revision, db), std::string_view{key.data(), key.size()},
                                           &impl->keyBuffer, &impl->valueBuffer, nullptr);

             if (!found)
             {
                return {};
             }

             return {{{impl->keyBuffer}, {impl->valueBuffer}}};
          });
   }  // Database::kvMaxRaw

   void Database::setCallbackFlags(DatabaseCallbacks::Flags flags)
   {
      impl->callbackFlags |= flags;
   }

}  // namespace psibase
