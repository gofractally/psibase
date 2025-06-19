#include <psibase/db.hpp>

#include <boost/filesystem/operations.hpp>
#include <psibase/Socket.hpp>
#include <triedent/database.hpp>

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
      void prepare(DbChangeSet& changes)
      {
         std::ranges::sort(changes.ranges, {}, &DbChangeSet::Range::lower);
         // merge adjacent and overlapping ranges
         auto pos = changes.ranges.begin();
         auto end = changes.ranges.end();
         if (pos != end)
         {
            auto out = pos;
            ++pos;
            for (; pos != end; ++pos)
            {
               if (out->upper.empty())
               {
                  out->write = out->write || std::any_of(pos, end, [](auto& r) { return r.write; });
                  break;
               }
               else if (pos->lower <= out->upper)
               {
                  out->write |= pos->write;
                  if (out->upper < pos->upper || pos->upper.empty())
                     out->upper = std::move(pos->upper);
               }
               else
               {
                  ++out;
                  *out = std::move(*pos);
               }
            }
            ++out;
            changes.ranges.erase(out, changes.ranges.end());
         }
      }
      std::vector<unsigned char> keyExact(std::span<const char> key)
      {
         return {key.begin(), key.end()};
      }
      std::vector<unsigned char> keyNext(std::span<const char> key)
      {
         std::vector<unsigned char> result;
         result.reserve(key.size() + 1);
         result.insert(result.end(), key.begin(), key.end());
         result.push_back(0);
         return result;
      }
      std::vector<unsigned char> keyNextPrefix(std::span<const char> key)
      {
         auto result = keyExact(key);
         while (!result.empty() && result.back() == 0xffu)
            result.pop_back();
         if (!result.empty())
            ++result.back();
         return result;
      }
      std::span<const char> dbKey(const std::vector<unsigned char>& v)
      {
         return {reinterpret_cast<const char*>(v.data()), v.size()};
      }

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
   void DbChangeSet::onRead(std::span<const char> key)
   {
      ranges.push_back({.lower = keyExact(key), .upper = keyNext(key)});
   }
   void DbChangeSet::onGreaterEqual(std::span<const char> key,
                                    std::size_t           prefixLen,
                                    bool                  found,
                                    std::span<const char> result)
   {
      ranges.push_back(
          {keyExact(key), found ? keyNext(result) : keyNextPrefix(key.subspan(0, prefixLen))});
   }
   void DbChangeSet::onLessThan(std::span<const char> key,
                                std::size_t           prefixLen,
                                bool                  found,
                                std::span<const char> result)
   {
      ranges.push_back(
          {found ? keyExact(result) : keyExact(key.subspan(0, prefixLen)), keyExact(key)});
   }
   void DbChangeSet::onMax(std::span<const char> key, bool found, std::span<const char> result)
   {
      ranges.push_back({found ? keyExact(result) : keyExact(key), keyNextPrefix(key)});
   }
   void DbChangeSet::onWrite(std::span<const char> key)
   {
      ranges.push_back({.lower = keyExact(key), .upper = keyNext(key), .write = true});
   }

   // TODO: move triedent::root destruction to a gc thread
   struct Revision
   {
      std::shared_ptr<triedent::root> roots[numChainDatabases];

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

   static std::shared_ptr<Revision> loadRevision(triedent::write_session&               s,
                                                 const std::shared_ptr<triedent::root>& topRoot,
                                                 std::span<const char>                  key,
                                                 bool nullIfNotFound = false)
   {
      auto                                         revision = std::make_shared<Revision>();
      std::vector<std::shared_ptr<triedent::root>> roots;
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
      std::shared_ptr<triedent::database> trie;

      DatabaseCallbacks* callbacks = nullptr;

      std::mutex                      topMutex;
      std::shared_ptr<triedent::root> topRoot;

      std::mutex                      headMutex;
      std::shared_ptr<const Revision> head;

      std::mutex          subjectiveMutex;
      IndependentRevision subjective;

      SharedDatabaseImpl(const std::filesystem::path&     dir,
                         const triedent::database_config& config,
                         triedent::open_mode              mode)
      {
         // The largest object is 16 MiB
         // Each file must be at least double this
         constexpr std::uint64_t min_size = 32 * 1024 * 1024;
         if (config.hot_bytes < min_size || config.warm_bytes < min_size ||
             config.cool_bytes < min_size || config.cold_bytes < min_size)
         {
            throw std::runtime_error("Requested database size is too small");
         }
         trie    = std::make_shared<triedent::database>(dir.c_str(), config, mode);
         auto s  = trie->start_write_session();
         topRoot = s->get_top_root();
         head    = loadRevision(*s, topRoot, revisionHeadKey);

         std::vector<std::shared_ptr<triedent::root>> roots;
         if (s->get(topRoot, subjectiveKey, nullptr, &roots))
         {
            check(roots.size() == numIndependentDatabases, "Wrong number of subjective databases");
            for (std::size_t i = 0; i < numIndependentDatabases; ++i)
               subjective[i] = roots[i];
         }
      }

      SharedDatabaseImpl(const SharedDatabaseImpl& other)
          : trie(other.trie), topRoot(other.topRoot), head(other.head), subjective(other.subjective)
      {
      }

      auto getTopRoot()
      {
         std::lock_guard lock{topMutex};
         return topRoot;
      }

      auto getNativeSubjective()
      {
         std::lock_guard l{subjectiveMutex};
         return subjective[independentIndex(DbId::nativeSubjective)];
      }

      auto getHead()
      {
         std::lock_guard<std::mutex> lock(headMutex);
         return head;
      }

      void setHead(triedent::write_session& session, std::shared_ptr<const Revision> r)
      {
         {
            std::lock_guard lock{topMutex};
            session.upsert(topRoot, revisionHeadKey, r->roots);
            session.set_top_root(topRoot);
         }

         std::lock_guard<std::mutex> lock(headMutex);
         head = std::move(r);
      }

      void writeRevision(triedent::write_session& session,
                         const Checksum256&       blockId,
                         const Revision&          r)
      {
         std::lock_guard lock{topMutex};
         session.upsert(topRoot, revisionById(blockId), r.roots);
         session.set_top_root(topRoot);
      }
   };  // SharedDatabaseImpl

   SharedDatabase::SharedDatabase(const std::filesystem::path&     dir,
                                  const triedent::database_config& config,
                                  triedent::open_mode              mode)
       : impl{std::make_shared<SharedDatabaseImpl>(dir, config, mode)}
   {
   }

   SharedDatabase SharedDatabase::clone() const
   {
      SharedDatabase result{*this};
      result.impl = std::make_shared<SharedDatabaseImpl>(*impl);
      return result;
   }

   bool SharedDatabase::empty() const
   {
      return impl->getTopRoot() == nullptr;
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
      return loadRevision(writer, impl->getTopRoot(), revisionById(blockId), true);
   }

   // TODO: move triedent::root destruction to a gc thread
   void SharedDatabase::removeRevisions(Writer& writer, const Checksum256& irreversible)
   {
      // TODO: Reduce critical section
      auto              nativeSubjective = impl->getNativeSubjective();
      std::lock_guard   lock{impl->topMutex};
      std::vector<char> key{revisionByIdPrefix};
      std::vector<char> tmpKey;
      bool              hasIrreversible = false;

      // Remove everything with a blockNum <= irreversible's, except irreversible
      // and saved snapshots.
      while (writer.get_greater_equal(impl->topRoot, key, &key, nullptr, nullptr))
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
            psio::vector_stream stream{tmpKey};
            psio::to_key(snapshotKey(id), stream);
            if (!writer.get(nativeSubjective, tmpKey))
               writer.remove(impl->topRoot, key);
         }
         key.push_back(0);
      }

      if (hasIrreversible)
      {
         // Remove everything with a blockNum > irreversible's which builds on a block
         // no longer present.
         std::vector<std::shared_ptr<triedent::root>> roots;
         std::vector<char>                            statusBytes;
         auto                                         sk = psio::convert_to_key(statusKey());
         while (writer.get_greater_equal(impl->topRoot, key, &key, nullptr, &roots))
         {
            if (key.size() != 1 + irreversible.size() || key[0] != revisionByIdPrefix)
               break;
            check(roots.size() == numChainDatabases, "wrong number of roots in fork");
            if (!writer.get(roots[(int)StatusRow::db], sk, &statusBytes, nullptr))
               throw std::runtime_error("Status row missing in fork");
            auto status = psio::from_frac<StatusRow>(psio::prevalidated{statusBytes});
            if (!status.head)
               throw std::runtime_error("Status row is missing head information in fork");
            if (!writer.get(impl->topRoot, revisionById(status.head->header.previous), nullptr,
                            nullptr))
               writer.remove(impl->topRoot, key);
            key.push_back(0);
         }
      }

      writer.set_top_root(impl->topRoot);
   }  // removeRevisions

   void SharedDatabase::kvPutSubjective(Writer&               writer,
                                        std::span<const char> key,
                                        std::span<const char> value)
   {
      std::lock_guard l{impl->subjectiveMutex};
      writer.upsert(impl->subjective[independentIndex(DbId::nativeSubjective)], key, value);
      std::lock_guard lock{impl->topMutex};
      writer.upsert(impl->topRoot, subjectiveKey, impl->subjective);
      writer.set_top_root(impl->topRoot);
   }

   void SharedDatabase::kvRemoveSubjective(Writer& writer, std::span<const char> key)
   {
      std::lock_guard l{impl->subjectiveMutex};
      writer.remove(impl->subjective[independentIndex(DbId::nativeSubjective)], key);
      std::lock_guard lock{impl->topMutex};
      writer.upsert(impl->topRoot, subjectiveKey, impl->subjective);
      writer.set_top_root(impl->topRoot);
   }

   std::optional<std::vector<char>> SharedDatabase::kvGetSubjective(Writer&               reader,
                                                                    std::span<const char> key)
   {
      auto root = impl->getNativeSubjective();
      return reader.get(root, key);
   }

   IndependentRevision SharedDatabase::getSubjective()
   {
      std::lock_guard l{impl->subjectiveMutex};
      return impl->subjective;
   }

   bool SharedDatabase::commitSubjective(Writer&                writer,
                                         IndependentRevision&   original,
                                         IndependentRevision    updated,
                                         IndependentChangeSet&& changes,
                                         SocketChangeSet&&      socketChanges,
                                         Sockets&               sockets,
                                         SocketAutoCloseSet&    closing)
   {
      bool hasChange = !socketChanges.empty();
      for (std::size_t i = 0; i < numIndependentDatabases; ++i)
      {
         prepare(changes[i]);
         hasChange =
             hasChange || std::ranges::any_of(changes[i].ranges, [](auto& r) { return r.write; });
      }
      if (hasChange)
      {
         std::lock_guard l{impl->subjectiveMutex};
         for (std::size_t i = 0; i < numIndependentDatabases; ++i)
         {
            for (const auto& r : changes[i].ranges)
            {
               if (!writer.is_equal_weak(original[i], impl->subjective[i], dbKey(r.lower),
                                         dbKey(r.upper)))
               {
                  original = impl->subjective;
                  return false;
               }
            }
         }
         if (!sockets.applyChanges(socketChanges, &closing))
         {
            original = impl->subjective;
            return false;
         }
         for (std::size_t i = 0; i < numIndependentDatabases; ++i)
         {
            for (const auto& r : changes[i].ranges)
            {
               if (r.write)
                  writer.splice(impl->subjective[i], updated[i], dbKey(r.lower), dbKey(r.upper));
            }
         }
         std::lock_guard lock{impl->topMutex};
         writer.upsert(impl->topRoot, subjectiveKey, impl->subjective);
         writer.set_top_root(impl->topRoot);
      }
      return true;
   }

   bool SharedDatabase::isSlow() const
   {
      return impl->trie->is_slow();
   }

   std::vector<std::span<const char>> SharedDatabase::span() const
   {
      auto result = impl->trie->span();
      return {result.begin(), result.end()};
   }

   void SharedDatabase::setCallbacks(DatabaseCallbacks* callbacks)
   {
      impl->callbacks = callbacks;
   }

   struct SubjectiveRevision
   {
      std::array<std::size_t, numIndependentDatabases> changeSetPos;
      std::size_t                                      socketChangePos;
      IndependentRevision                              db;
      DbPtr                                            temporaryDb;
   };

   std::array<std::size_t, numIndependentDatabases> getChangeSetPos(
       std::span<const DbChangeSet, numIndependentDatabases> changes)
   {
      std::array<std::size_t, numIndependentDatabases> result;
      for (std::size_t i = 0; i < numIndependentDatabases; ++i)
      {
         result[i] = changes[i].ranges.size();
      }
      return result;
   }

   struct DatabaseImpl
   {
      SharedDatabase                           shared;
      std::shared_ptr<const Revision>          baseRevision;
      std::shared_ptr<triedent::write_session> writeSession;
      std::shared_ptr<triedent::read_session>  readSession;
      std::vector<std::shared_ptr<Revision>>   writeRevisions;
      std::shared_ptr<const Revision>          readOnlyRevision;
      std::vector<char>                        keyBuffer;
      std::vector<char>                        valueBuffer;

      DbPtr                           temporaryDb;
      IndependentChangeSet            subjectiveChanges;
      std::vector<SocketChange>       socketChanges;
      std::vector<SubjectiveRevision> subjectiveRevisions;
      std::size_t                     subjectiveLimit;
      DatabaseCallbacks::Flags        callbackFlags = {};

      auto db(auto& revision, DbId db) -> decltype((revision.roots[(int)db]))
      {
         if (isIndependent(db))
         {
            check(!subjectiveRevisions.empty(),
                  "subjectiveCheckout is required to access the subjective database");
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

      DbChangeSet* getChangeSet(DbId db)
      {
         if (isIndependent(db))
            return &subjectiveChanges[independentIndex(db)];
         else
            return nullptr;
      }

      template <typename F>
      auto read(F f)
      {
         const auto& revision = [this]() -> const Revision&
         {
            if (readOnlyRevision)
               return *readOnlyRevision;
            check(!writeRevisions.empty(), "no database sessions active");
            return *writeRevisions.back();
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
         check(writeSession && !writeRevisions.empty(), "no database write sessions active");
         return f(*writeSession, *writeRevisions.back());
      }

      // TODO: release old revision roots in GC thread
      void setRevision(ConstRevisionPtr revision)
      {
         check(writeRevisions.empty() && !readOnlyRevision,
               "setRevision: database session is active");
         check(revision != nullptr, "null revision");
         baseRevision = std::move(revision);
      }

      void startRead()
      {
         check(writeRevisions.empty() && !readOnlyRevision,
               "startRead: database session already active");
         if (!readSession && !writeSession)
            readSession = shared.impl->trie->start_read_session();
         readOnlyRevision = baseRevision;
      }

      void startWrite(WriterPtr writer)
      {
         check(!readOnlyRevision, "startWrite: can't mix read and write revisions");
         check(writer != nullptr, "startWrite: writer is null");
         writeSession = std::move(writer);
         readSession  = nullptr;
         if (writeRevisions.empty())
            writeRevisions.push_back(baseRevision->clone());
         else
            writeRevisions.push_back(writeRevisions.back()->clone());
      }

      void commit()
      {
         if (readOnlyRevision)
            readOnlyRevision = nullptr;
         else if (writeRevisions.size() == 1)
            throw std::runtime_error("final commit needs writeRevision()");
         else if (writeRevisions.size() > 1)
            writeRevisions.erase(writeRevisions.end() - 2);
         else
            throw std::runtime_error("mismatched commit");
      }

      ConstRevisionPtr writeRevision(const Checksum256& blockId)
      {
         check((bool)writeSession, "writeSession is missing");
         check(writeRevisions.size() == 1, "not final commit");
         auto rev = writeRevisions.back();
         shared.impl->writeRevision(*writeSession, blockId, *rev);
         baseRevision = std::move(rev);
         writeRevisions.pop_back();
         return baseRevision;
      }

      void abort()
      {
         if (readOnlyRevision)
            readOnlyRevision = nullptr;
         else if (!writeRevisions.empty())
            writeRevisions.pop_back();
      }

      void checkoutSubjective()
      {
         check(subjectiveRevisions.size() <= maxSubjectiveTransactionDepth,
               "checkoutSubjective nesting exceeded limit");
         if (subjectiveRevisions.empty())
         {
            subjectiveRevisions.push_back({{}, 0, shared.getSubjective(), temporaryDb});
            callbackFlags = 0;
         }
         subjectiveRevisions.push_back({getChangeSetPos(subjectiveChanges), socketChanges.size(),
                                        subjectiveRevisions.back().db,
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
         }
         else
         {
            assert(subjectiveRevisions.size() == 2);
            if (writeSession)
            {
               if (!shared.commitSubjective(
                       *writeSession, subjectiveRevisions.front().db, subjectiveRevisions.back().db,
                       std::move(subjectiveChanges), std::move(socketChanges), sockets, closing))
               {
                  subjectiveRevisions[1].db              = subjectiveRevisions[0].db;
                  subjectiveRevisions[1].temporaryDb     = subjectiveRevisions[0].temporaryDb;
                  subjectiveRevisions[0].changeSetPos    = {};
                  subjectiveRevisions[0].socketChangePos = 0;
                  subjectiveRevisions[1].changeSetPos    = {};
                  subjectiveRevisions[1].socketChangePos = 0;
                  for (auto& change : subjectiveChanges)
                     change.ranges.clear();
                  socketChanges.clear();
                  return false;
               }
               temporaryDb = std::move(subjectiveRevisions.back().temporaryDb);
               if (callbackFlags && shared.impl->callbacks)
               {
                  shared.impl->callbacks->run(callbackFlags);
               }
            }
            subjectiveRevisions.clear();
            for (auto& change : subjectiveChanges)
               change.ranges.clear();
            socketChanges.clear();
         }
         return true;
      }
      void abortSubjective()
      {
         check(subjectiveRevisions.size() > subjectiveLimit,
               "abortSubjective requires checkoutSubjective");
         if (subjectiveRevisions.size() > 2)
         {
            for (std::size_t i = 0; i < numIndependentDatabases; ++i)
               assert(subjectiveRevisions.back().changeSetPos[i] <=
                      subjectiveChanges[i].ranges.size());
            assert(subjectiveRevisions.back().socketChangePos <= socketChanges.size());
            for (std::size_t i = 0; i < numIndependentDatabases; ++i)
               subjectiveChanges[i].ranges.resize(subjectiveRevisions.back().changeSetPos[i]);
            socketChanges.resize(subjectiveRevisions.back().socketChangePos);
            subjectiveRevisions.pop_back();
         }
         else
         {
            assert(subjectiveRevisions.size() == 2);
            subjectiveRevisions.clear();
            for (auto& change : subjectiveChanges)
               change.ranges.clear();
            socketChanges.clear();
         }
      }
      std::int32_t socketAutoClose(std::int32_t        socket,
                                   bool                value,
                                   Sockets&            sockets,
                                   SocketAutoCloseSet& closing)
      {
         return sockets.autoClose(socket, value, &closing,
                                  subjectiveRevisions.empty() ? nullptr : &socketChanges);
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
            for (auto& change : subjectiveChanges)
               change.ranges.clear();
            socketChanges.clear();
         }
         else if (subjectiveLimit < subjectiveRevisions.size())
         {
            for (std::size_t i = 0; i < numIndependentDatabases; ++i)
               subjectiveChanges[i].ranges.resize(
                   subjectiveRevisions[subjectiveLimit].changeSetPos[i]);
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

   Database::~Database() {}

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
      if (!impl->writeRevisions.empty())
         return impl->writeRevisions.back();
      else
         return impl->baseRevision;
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
   std::int32_t Database::socketAutoClose(std::int32_t        socket,
                                          bool                value,
                                          Sockets&            sockets,
                                          SocketAutoCloseSet& closing)
   {
      return impl->socketAutoClose(socket, value, sockets, closing);
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

   void Database::kvPutRaw(DbId db, psio::input_stream key, psio::input_stream value)
   {
      impl->write(
          [&](auto& session, auto& revision)
          {
             if (auto* changes = impl->getChangeSet(db))
             {
                changes->onWrite(key.string_view());
             }
             session.upsert(impl->db(revision, db), key.string_view(), value.string_view());
          });
   }

   void Database::kvRemoveRaw(DbId db, psio::input_stream key)
   {
      impl->write(
          [&](auto& session, auto& revision)
          {
             if (auto* changes = impl->getChangeSet(db))
             {
                changes->onWrite(key.string_view());
             }
             session.remove(impl->db(revision, db), key.string_view());
          });
   }

   std::optional<psio::input_stream> Database::kvGetRaw(DbId db, psio::input_stream key)
   {
      return impl->read(
          [&](auto& session, auto& revision) -> std::optional<psio::input_stream>
          {
             if (auto* changes = impl->getChangeSet(db))
             {
                changes->onRead(key.string_view());
             }

             if (!session.get(impl->db(revision, db), key.string_view(), &impl->valueBuffer,
                              nullptr))
             {
                return {};
             }

             return {{impl->valueBuffer}};
          });
   }  // Database::kvGetRaw

   std::optional<Database::KVResult> Database::kvGreaterEqualRaw(DbId               db,
                                                                 psio::input_stream key,
                                                                 size_t             matchKeySize)
   {
      return impl->read(
          [&](auto& session, auto& revision) -> std::optional<Database::KVResult>
          {
             auto found = session.get_greater_equal(impl->db(revision, db), key.string_view(),
                                                    &impl->keyBuffer, &impl->valueBuffer, nullptr);
             if (found && (impl->keyBuffer.size() < matchKeySize ||
                           memcmp(impl->keyBuffer.data(), key.pos, matchKeySize)))
                found = false;

             if (auto* changes = impl->getChangeSet(db))
             {
                changes->onGreaterEqual(key.string_view(), matchKeySize, found, impl->keyBuffer);
             }

             if (!found)
             {
                return {};
             }

             return {{{impl->keyBuffer}, {impl->valueBuffer}}};
          });
   }  // Database::kvGreaterEqualRaw

   std::optional<Database::KVResult> Database::kvLessThanRaw(DbId               db,
                                                             psio::input_stream key,
                                                             size_t             matchKeySize)
   {
      return impl->read(
          [&](auto& session, auto& revision) -> std::optional<Database::KVResult>
          {
             auto found = session.get_less_than(impl->db(revision, db), key.string_view(),
                                                &impl->keyBuffer, &impl->valueBuffer, nullptr);
             if (found && (impl->keyBuffer.size() < matchKeySize ||
                           memcmp(impl->keyBuffer.data(), key.pos, matchKeySize)))
                found = false;

             if (auto* changes = impl->getChangeSet(db))
             {
                changes->onLessThan(key.string_view(), matchKeySize, found, impl->keyBuffer);
             }

             if (!found)
             {
                return {};
             }

             return {{{impl->keyBuffer}, {impl->valueBuffer}}};
          });
   }  // Database::kvLessThanRaw

   std::optional<Database::KVResult> Database::kvMaxRaw(DbId db, psio::input_stream key)
   {
      return impl->read(
          [&](auto& session, auto& revision) -> std::optional<Database::KVResult>
          {
             auto found = session.get_max(impl->db(revision, db), key.string_view(),
                                          &impl->keyBuffer, &impl->valueBuffer, nullptr);

             if (auto* changes = impl->getChangeSet(db))
             {
                changes->onMax(key.string_view(), found, impl->keyBuffer);
             }

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
