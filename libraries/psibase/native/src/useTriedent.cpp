#include <psibase/db.hpp>

#include <boost/filesystem/operations.hpp>
#include <triedent/database.hpp>

// #define SANITY_CHECK

#ifdef SANITY_CHECK
inline constexpr bool sanityCheck = true;
#else
inline constexpr bool sanityCheck = false;
#endif

namespace psibase
{
   static constexpr uint8_t revisionHeadPrefix = 0;
   static constexpr uint8_t revisionByIdPrefix = 1;
   static constexpr uint8_t blockDataPrefix    = 2;
   static constexpr uint8_t subjectivePrefix   = 3;

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
      std::shared_ptr<triedent::root> roots[numDatabases];

#ifdef SANITY_CHECK
      std::map<std::vector<char>, std::vector<char>, blob_less> _sanity[numDatabases];

      auto& sanity() { return _sanity; }

      auto& sanity() const { return _sanity; }
#else
      std::map<std::vector<char>, std::vector<char>, blob_less> (&sanity())[];
      const std::map<std::vector<char>, std::vector<char>, blob_less> (&sanity() const)[];
#endif

      Revision()                           = default;
      Revision(const Revision&)            = delete;
      Revision(Revision&&)                 = default;
      Revision& operator=(const Revision&) = delete;
      Revision& operator=(Revision&&)      = default;

      std::shared_ptr<Revision> clone() const
      {
         std::shared_ptr<Revision> result = std::make_shared<Revision>();

         for (uint32_t i = 0; i < numDatabases; ++i)
            result->roots[i] = roots[i];

#ifdef SANITY_CHECK
         for (uint32_t i = 0; i < numDatabases; ++i)
            result->_sanity[i] = _sanity[i];
#endif

         return result;
      }

      // Simulate kvMaxRaw. Won't be accurate if max key size grows too much.
      auto approx_max(DbId db, psio::input_stream prefix) const
      {
         auto& m = sanity()[(int)db];
         auto  k = prefix.vector();
         k.insert(k.end(), 255, 0xff);
         auto it = m.lower_bound(k);
         if (it != m.begin())
            --it;
         if (it != m.end() && it->first.size() >= prefix.remaining() &&
             !memcmp(it->first.data(), prefix.pos, prefix.remaining()))
            return it;
         return m.end();
      }

      void dumpExpectedKeys(DbId db)
      {
         if constexpr (sanityCheck)
         {
            auto& m = sanity()[(int)db];
            printf("expected keys:\n");
            for (auto& [k, v] : m)
               printf("  %s\n", psio::convert_to_json(k).c_str());
         }
      }

      void checkContent(const char* f, DbId db, triedent::write_session& s)
      {
         if constexpr (sanityCheck)
         {
            auto&             r = roots[(int)db];
            auto&             m = sanity()[(int)db];
            std::vector<char> k, v;
            auto              it = m.begin();
            while (true)
            {
               static int i    = 0;
               bool       have = s.get_greater_equal(r, {k.data(), k.size()}, &k, &v, nullptr);
               if (!have && it == m.end())
               {
                  // printf("%s: content ok\n", f);
                  break;
               }
               if (!have)
                  printf("sanity check failure (%d): %s: key missing\n", i, f);
               else if (it == m.end())
                  printf("sanity check failure (%d): %s: extra key\n", i, f);
               else if (it->first != k)
               {
                  printf(
                      "sanity check failure (%d): %s: different key\n  expected: %s\n  got:      "
                      "%s\n",
                      i, f, psio::convert_to_json(it->first).c_str(),
                      psio::convert_to_json(k).c_str());
                  dumpExpectedKeys(db);
               }
               else if (it->second != v)
                  printf("sanity check failure (%d): %s: different value\n", i, f);
               else
               {
                  // printf("... %s\n", f);
                  k.push_back(0);
                  ++it;
                  ++i;
                  continue;
               }
               break;
            }
         }
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
         check(roots.size() == numDatabases, "wrong number of roots in database");
         for (size_t i = 0; i < roots.size(); ++i)
            revision->roots[i] = std::move(roots[i]);
      }
      else if (nullIfNotFound)
         return nullptr;

      if constexpr (sanityCheck)
      {
         for (int db = 0; db < (int)numDatabases; ++db)
         {
            auto&             r = revision->roots[db];
            auto&             m = revision->sanity()[db];
            std::vector<char> k, v;
            while (s.get_greater_equal(r, {k.data(), k.size()}, &k, &v, nullptr))
            {
               m[k] = v;
               k.push_back(0);
            }
         }
      }

      return revision;
   }

   struct SharedDatabaseImpl
   {
      std::shared_ptr<triedent::database> trie;

      std::mutex topMutex;

      std::mutex                      headMutex;
      std::shared_ptr<const Revision> head;

      std::mutex                      subjectiveMutex;
      std::shared_ptr<triedent::root> subjective;

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
         trie   = std::make_shared<triedent::database>(dir.c_str(), config, mode);
         auto s = trie->start_write_session();
         head   = loadRevision(*s, s->get_top_root(), revisionHeadKey);
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
            auto            topRoot = session.get_top_root();
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
         auto            topRoot = session.get_top_root();
         session.upsert(topRoot, revisionById(blockId), r.roots);
         session.set_top_root(topRoot);
      }
   };  // SharedDatabaseImpl

   SharedDatabase::SharedDatabase(const boost::filesystem::path&   dir,
                                  const triedent::database_config& config,
                                  triedent::open_mode              mode)
       : impl{std::make_shared<SharedDatabaseImpl>(dir.c_str(), config, mode)}
   {
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
      return loadRevision(writer, writer.get_top_root(), revisionById(blockId), true);
   }

   // TODO: move triedent::root destruction to a gc thread
   void SharedDatabase::removeRevisions(Writer& writer, const Checksum256& irreversible)
   {
      // TODO: Reduce critical section
      std::lock_guard   lock{impl->topMutex};
      auto              topRoot = writer.get_top_root();
      std::vector<char> key{revisionByIdPrefix};

      // Remove everything with a blockNum <= irreversible's, except irreversible.
      while (writer.get_greater_equal(topRoot, key, &key, nullptr, nullptr))
      {
         if (key.size() != 1 + irreversible.size() || key[0] != revisionByIdPrefix ||
             memcmp(key.data() + 1, irreversible.data(), sizeof(BlockNum)) > 0)
            break;
         if (memcmp(key.data() + 1, irreversible.data(), irreversible.size()))
            writer.remove(topRoot, key);
         key.push_back(0);
      }

      // Remove everything with a blockNum > irreversible's which builds on a block
      // no longer present.
      std::vector<std::shared_ptr<triedent::root>> roots;
      std::vector<char>                            statusBytes;
      auto                                         sk = psio::convert_to_key(statusKey());
      while (writer.get_greater_equal(topRoot, key, &key, nullptr, &roots))
      {
         if (key.size() != 1 + irreversible.size() || key[0] != revisionByIdPrefix)
            break;
         check(roots.size() == numDatabases, "wrong number of roots in fork");
         if (!writer.get(roots[(int)StatusRow::db], sk, &statusBytes, nullptr))
            throw std::runtime_error("Status row missing in fork");
         auto status = psio::from_frac<StatusRow>(psio::prevalidated{statusBytes});
         if (!status.head)
            throw std::runtime_error("Status row is missing head information in fork");
         if (!writer.get(topRoot, revisionById(status.head->header.previous), nullptr, nullptr))
            writer.remove(topRoot, key);
         key.push_back(0);
      }

      writer.set_top_root(topRoot);
   }  // removeRevisions

   void SharedDatabase::setBlockData(Writer&               writer,
                                     const Checksum256&    blockId,
                                     std::span<const char> key,
                                     std::span<const char> value)
   {
      std::vector<char> fullKey;
      fullKey.reserve(1 + blockId.size() + key.size());
      fullKey.push_back(blockDataPrefix);
      fullKey.insert(fullKey.end(), blockId.begin(), blockId.end());
      fullKey.insert(fullKey.end(), key.begin(), key.end());
      std::lock_guard lock{impl->topMutex};
      auto            topRoot = writer.get_top_root();
      writer.upsert(topRoot, fullKey, value);
      writer.set_top_root(topRoot);
   }

   std::optional<std::vector<char>> SharedDatabase::getBlockData(Writer&               reader,
                                                                 const Checksum256&    blockId,
                                                                 std::span<const char> key)
   {
      auto              topRoot = reader.get_top_root();
      std::vector<char> fullKey;
      fullKey.reserve(1 + blockId.size() + key.size());
      fullKey.push_back(blockDataPrefix);
      fullKey.insert(fullKey.end(), blockId.begin(), blockId.end());
      fullKey.insert(fullKey.end(), key.begin(), key.end());
      return reader.get(topRoot, fullKey);
   }

   DbPtr SharedDatabase::getSubjective()
   {
      std::lock_guard l{impl->subjectiveMutex};
      return impl->subjective;
   }

   bool SharedDatabase::commitSubjective(Writer&             writer,
                                         DbPtr&              original,
                                         DbPtr               updated,
                                         DbChangeSet&&       changes,
                                         SocketChangeSet&&   socketChanges,
                                         Sockets&            sockets,
                                         SocketAutoCloseSet& closing)
   {
      prepare(changes);
      if (std::ranges::any_of(changes.ranges, [](auto& r) { return r.write; }))
      {
         std::lock_guard l{impl->subjectiveMutex};
         for (const auto& r : changes.ranges)
         {
            if (!writer.is_equal_weak(original, impl->subjective, dbKey(r.lower), dbKey(r.upper)))
            {
               original = impl->subjective;
               return false;
            }
         }
         if (!sockets.applyChanges(socketChanges, &closing))
            return false;
         for (const auto& r : changes.ranges)
         {
            if (r.write)
               writer.splice(impl->subjective, updated, dbKey(r.lower), dbKey(r.upper));
         }
         std::lock_guard lock{impl->topMutex};
         auto            r = writer.get_top_root();
         writer.upsert(r, subjectiveKey, {&impl->subjective, 1});
         writer.set_top_root(std::move(r));
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

   struct SubjectiveRevision
   {
      std::size_t                     changeSetPos;
      std::size_t                     socketChangePos;
      std::shared_ptr<triedent::root> db;
   };

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

      DbChangeSet                     subjectiveChanges;
      std::vector<SocketChange>       socketChanges;
      std::vector<SubjectiveRevision> subjectiveRevisions;
      std::size_t                     subjectiveLimit;

      auto db(auto& revision, DbId db) -> decltype((revision.roots[(int)db]))
      {
         if (db == DbId::subjective)
         {
            check(!subjectiveRevisions.empty(),
                  "subjectiveCheckout is required to access the subjective database");
            return subjectiveRevisions.back().db;
         }
         else
         {
            return revision.roots[(int)db];
         }
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
            subjectiveRevisions.push_back({0, 0, shared.getSubjective()});
         }
         subjectiveRevisions.push_back({subjectiveChanges.ranges.size(), socketChanges.size(),
                                        subjectiveRevisions.back().db});
      }

      bool commitSubjective(Sockets& sockets, SocketAutoCloseSet& closing)
      {
         check(subjectiveRevisions.size() > subjectiveLimit,
               "commitSubjective requires checkoutSubjective");
         if (subjectiveRevisions.size() > 2)
         {
            subjectiveRevisions[subjectiveRevisions.size() - 2].db =
                std::move(subjectiveRevisions.back().db);
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
                  subjectiveRevisions[0].changeSetPos    = 0;
                  subjectiveRevisions[0].socketChangePos = 0;
                  subjectiveRevisions[1].changeSetPos    = 0;
                  subjectiveRevisions[1].socketChangePos = 0;
                  subjectiveChanges.ranges.clear();
                  socketChanges.clear();
                  return false;
               }
            }
            subjectiveRevisions.clear();
            subjectiveChanges.ranges.clear();
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
            assert(subjectiveRevisions.back().changeSetPos <= subjectiveChanges.ranges.size());
            assert(subjectiveRevisions.back().socketChangePos <= socketChanges.size());
            subjectiveChanges.ranges.resize(subjectiveRevisions.back().changeSetPos);
            socketChanges.resize(subjectiveRevisions.back().socketChangePos);
            subjectiveRevisions.pop_back();
         }
         else
         {
            assert(subjectiveRevisions.size() == 2);
            subjectiveRevisions.clear();
            subjectiveChanges.ranges.clear();
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
            subjectiveChanges.ranges.clear();
            socketChanges.clear();
         }
         else if (subjectiveLimit < subjectiveRevisions.size())
         {
            subjectiveChanges.ranges.resize(subjectiveRevisions[subjectiveLimit].changeSetPos);
            socketChanges.resize(subjectiveRevisions[subjectiveLimit].socketChangePos);
            subjectiveRevisions.resize(subjectiveLimit);
         }
         subjectiveLimit = depth;
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

   void Database::kvPutRaw(DbId db, psio::input_stream key, psio::input_stream value)
   {
      impl->write(
          [&](auto& session, auto& revision)
          {
             if (db == DbId::subjective)
             {
                impl->subjectiveChanges.onWrite(key.string_view());
             }
             session.upsert(impl->db(revision, db), key.string_view(), value.string_view());
             if constexpr (sanityCheck)
             {
                revision.sanity()[(int)db][key.vector()] = value.vector();
                revision.checkContent("kvPutRaw", db, session);
             }
          });
   }

   void Database::kvRemoveRaw(DbId db, psio::input_stream key)
   {
      impl->write(
          [&](auto& session, auto& revision)
          {
             if (db == DbId::subjective)
             {
                impl->subjectiveChanges.onWrite(key.string_view());
             }
             session.remove(impl->db(revision, db), key.string_view());
             if constexpr (sanityCheck)
             {
                revision.sanity()[(int)db].erase(key.vector());
                revision.checkContent("kvRemoveRaw", db, session);
             }
          });
   }

   std::optional<psio::input_stream> Database::kvGetRaw(DbId db, psio::input_stream key)
   {
      return impl->read(
          [&](auto& session, auto& revision) -> std::optional<psio::input_stream>
          {
             if (db == DbId::subjective)
             {
                impl->subjectiveChanges.onRead(key.string_view());
             }

             if (!session.get(impl->db(revision, db), key.string_view(), &impl->valueBuffer,
                              nullptr))
             {
                if constexpr (sanityCheck)
                {
                   auto it = revision.sanity()[(int)db].find(key.vector());
                   if (it != revision.sanity()[(int)db].end())
                      printf("sanity check failure: kvGetRaw: data missing\n");
                }
                return {};
             }

             if constexpr (sanityCheck)
             {
                auto it = revision.sanity()[(int)db].find(key.vector());
                if (it == revision.sanity()[(int)db].end())
                   printf("sanity check failure: kvGetRaw: data exists\n");
                else if (it->second != impl->valueBuffer)
                   printf("sanity check failure: kvGetRaw: data is different\n");
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

             if (db == DbId::subjective)
             {
                impl->subjectiveChanges.onGreaterEqual(key.string_view(), matchKeySize, found,
                                                       impl->keyBuffer);
             }

             if (!found)
             {
                if constexpr (sanityCheck)
                {
                   auto& m  = revision.sanity()[(int)db];
                   auto  it = m.lower_bound(key.vector());
                   if (it != m.end() && (it->first.size() < matchKeySize ||
                                         memcmp(it->first.data(), key.pos, matchKeySize)))
                      it = m.end();
                   if (it != m.end())
                      printf("sanity check failure: kvGreaterEqualRaw: data missing\n");
                }
                return {};
             }

             if constexpr (sanityCheck)
             {
                auto& m  = revision.sanity()[(int)db];
                auto  it = m.lower_bound(key.vector());
                if (it != m.end() && (it->first.size() < matchKeySize ||
                                      memcmp(it->first.data(), key.pos, matchKeySize)))
                   it = m.end();
                if (it == m.end())
                   printf("sanity check failure: kvGreaterEqualRaw: data exists\n");
                else if (it->first != impl->keyBuffer)
                   printf("sanity check failure: kvGreaterEqualRaw: key is different\n");
                else if (it->second != impl->valueBuffer)
                   printf("sanity check failure: kvGreaterEqualRaw: data is different\n");
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

             if (db == DbId::subjective)
             {
                impl->subjectiveChanges.onLessThan(key.string_view(), matchKeySize, found,
                                                   impl->keyBuffer);
             }

             if (!found)
             {
                if constexpr (sanityCheck)
                {
                   auto& m  = revision.sanity()[(int)db];
                   auto  it = m.lower_bound(key.vector());
                   if (it != m.begin())
                      --it;
                   else
                      it = m.end();
                   if (it != m.end() && (it->first.size() < matchKeySize ||
                                         memcmp(it->first.data(), key.pos, matchKeySize)))
                      it = m.end();
                   if (it != m.end())
                   {
                      printf("sanity check failure: kvLessThanRaw: data missing\n");
                      printf("  key:   %s\n", psio::convert_to_json(key).c_str());
                      printf("  mks:   %d\n", int(matchKeySize));
                      printf("  needs: %s\n", psio::convert_to_json(it->first).c_str());
                   }
                }
                return {};
             }

             if constexpr (sanityCheck)
             {
                auto& m  = revision.sanity()[(int)db];
                auto  it = m.lower_bound(key.vector());
                if (it != m.begin())
                   --it;
                else
                   it = m.end();
                if (it != m.end() && (it->first.size() < matchKeySize ||
                                      memcmp(it->first.data(), key.pos, matchKeySize)))
                   it = m.end();
                if (it == m.end())
                   printf("sanity check failure: kvLessThanRaw: data exists\n");
                else if (it->first != impl->keyBuffer)
                   printf("sanity check failure: kvLessThanRaw: key is different\n");
                else if (it->second != impl->valueBuffer)
                   printf("sanity check failure: kvLessThanRaw: data is different\n");
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

             if (db == DbId::subjective)
             {
                impl->subjectiveChanges.onMax(key.string_view(), found, impl->keyBuffer);
             }

             if (!found)
             {
                if constexpr (sanityCheck)
                {
                   auto it = revision.approx_max(db, key.vector());
                   if (it != revision.sanity()[(int)db].end())
                      printf("sanity check failure: kvMaxRaw: data missing\n");
                }
                return {};
             }

             if constexpr (sanityCheck)
             {
                auto it = revision.approx_max(db, key.vector());
                if (it == revision.sanity()[(int)db].end())
                   printf("sanity check failure: kvMaxRaw: data exists\n");
                else if (it->first != impl->keyBuffer)
                   printf("sanity check failure: kvMaxRaw: key is different\n");
                else if (it->second != impl->valueBuffer)
                   printf("sanity check failure: kvMaxRaw: data is different\n");
             }
             return {{{impl->keyBuffer}, {impl->valueBuffer}}};
          });
   }  // Database::kvMaxRaw

}  // namespace psibase
