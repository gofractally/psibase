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

   static const char revisionHeadKey[] = {revisionHeadPrefix};

   static auto revisionById(const Checksum256& blockId)
   {
      std::array<char, std::tuple_size<Checksum256>() + 1> result;
      result[0] = revisionByIdPrefix;
      memcpy(result.data() + 1, blockId.data(), blockId.size());
      return result;
   }

   // TODO: move triedent::root destruction to a gc thread
   struct Revision
   {
      std::shared_ptr<triedent::root> roots[numDatabases];

#ifdef SANITY_CHECK
      std::map<std::vector<char>, std::vector<char>, blob_less> _sanity[numDatabases];

      auto& sanity()
      {
         return _sanity;
      }

      auto& sanity() const
      {
         return _sanity;
      }
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

      std::mutex                      headMutex;
      std::shared_ptr<const Revision> head;

      SharedDatabaseImpl(const std::filesystem::path& dir,
                         bool                         allowSlow,
                         uint64_t                     max_objects,
                         uint64_t                     hot_addr_bits,
                         uint64_t                     warm_addr_bits,
                         uint64_t                     cool_addr_bits,
                         uint64_t                     cold_addr_bits)
      {
         if (!std::filesystem::exists(dir))
         {
            // std::cout << "Creating " << dir << "\n";
            triedent::database::create(  //
                dir,                     //
                triedent::database::config{
                    .max_objects = max_objects,
                    .hot_pages   = hot_addr_bits,
                    .warm_pages  = warm_addr_bits,
                    .cool_pages  = cool_addr_bits,
                    .cold_pages  = cold_addr_bits,
                });
         }
         else
         {
            // std::cout << "Open existing " << dir << "\n";
         }
         trie   = std::make_shared<triedent::database>(dir.c_str(), triedent::database::read_write,
                                                     allowSlow);
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
         auto topRoot = session.get_top_root();
         session.upsert(topRoot, revisionHeadKey, r->roots);
         session.set_top_root(topRoot);

         std::lock_guard<std::mutex> lock(headMutex);
         head = std::move(r);
      }

      void writeRevision(triedent::write_session& session,
                         const Checksum256&       blockId,
                         const Revision&          r)
      {
         auto topRoot = session.get_top_root();
         session.upsert(topRoot, revisionById(blockId), r.roots);
         session.set_top_root(topRoot);
      }
   };  // SharedDatabaseImpl

   SharedDatabase::SharedDatabase(const boost::filesystem::path& dir,
                                  bool                           allowSlow,
                                  uint64_t                       max_objects,
                                  uint64_t                       hot_addr_bits,
                                  uint64_t                       warm_addr_bits,
                                  uint64_t                       cool_addr_bits,
                                  uint64_t                       cold_addr_bits)
       : impl{std::make_shared<SharedDatabaseImpl>(dir.c_str(),
                                                   allowSlow,
                                                   max_objects,
                                                   hot_addr_bits,
                                                   warm_addr_bits,
                                                   cool_addr_bits,
                                                   cold_addr_bits)}
   {
   }

   ConstRevisionPtr SharedDatabase::getHead()
   {
      return impl->getHead();
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
         auto status = psio::convert_from_frac<StatusRow>(statusBytes);
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
      auto              topRoot = writer.get_top_root();
      std::vector<char> fullKey;
      fullKey.reserve(1 + blockId.size() + key.size());
      fullKey.push_back(blockDataPrefix);
      fullKey.insert(fullKey.end(), blockId.begin(), blockId.end());
      fullKey.insert(fullKey.end(), key.begin(), key.end());
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

   bool SharedDatabase::isSlow() const
   {
      return impl->trie->is_slow();
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

   void Database::kvPutRaw(DbId db, psio::input_stream key, psio::input_stream value)
   {
      impl->write(
          [&](auto& session, auto& revision)
          {
             session.upsert(revision.roots[(int)db], key.string_view(), value.string_view());
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
             session.remove(revision.roots[(int)db], key.string_view());
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
             if (!session.get(revision.roots[(int)db], key.string_view(), &impl->valueBuffer,
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
             auto found = session.get_greater_equal(revision.roots[(int)db], key.string_view(),
                                                    &impl->keyBuffer, &impl->valueBuffer, nullptr);
             if (found && (impl->keyBuffer.size() < matchKeySize ||
                           memcmp(impl->keyBuffer.data(), key.pos, matchKeySize)))
                found = false;

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
             auto found = session.get_less_than(revision.roots[(int)db], key.string_view(),
                                                &impl->keyBuffer, &impl->valueBuffer, nullptr);
             if (found && (impl->keyBuffer.size() < matchKeySize ||
                           memcmp(impl->keyBuffer.data(), key.pos, matchKeySize)))
                found = false;

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
             if (!session.get_max(revision.roots[(int)db], key.string_view(), &impl->keyBuffer,
                                  &impl->valueBuffer, nullptr))
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
