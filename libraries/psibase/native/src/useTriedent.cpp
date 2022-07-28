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
   // TODO: move triedent::root destruction to a gc thread
   struct Revision
   {
      std::shared_ptr<triedent::root> topRoot;
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

         result->topRoot = topRoot;
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
   };

   // TODO: fork database
   std::shared_ptr<Revision> loadRevision(triedent::write_session&        s,
                                          std::shared_ptr<triedent::root> topRoot)
   {
      auto revision     = std::make_shared<Revision>();
      revision->topRoot = std::move(topRoot);
      std::vector<std::shared_ptr<triedent::root>> roots;
      if (s.get(revision->topRoot, {}, nullptr, &roots))
      {
         check(roots.size() == numDatabases, "wrong number of roots in database");
         for (size_t i = 0; i < roots.size(); ++i)
            revision->roots[i] = std::move(roots[i]);
      }
      return revision;
   }

   // TODO: fork database
   void writeRevision(triedent::write_session& s, Revision& r)
   {
      s.upsert(r.topRoot, {}, r.roots);
   }

   struct SharedDatabaseImpl
   {
      std::shared_ptr<triedent::database> trie;

      std::mutex                      headMutex;
      std::shared_ptr<const Revision> head;

      SharedDatabaseImpl(const std::filesystem::path& dir, bool allowSlow)
      {
         if (!std::filesystem::exists(dir))
         {
            std::cout << "Creating " << dir << "\n";
            triedent::database::create(  //
                dir,                     //
                triedent::database::config{.max_objects = 1'000'000'000,
                                           .hot_pages   = 32,
                                           .warm_pages  = 32,
                                           .cool_pages  = 32,
                                           .cold_pages  = 38});
         }
         else
         {
            std::cout << "Open existing " << dir << "\n";
         }
         trie   = std::make_shared<triedent::database>(dir.c_str(), triedent::database::read_write,
                                                     allowSlow);
         auto s = trie->start_write_session();
         head   = loadRevision(*s, s->get_top_root());
      }

      auto getHead()
      {
         std::lock_guard<std::mutex> lock(headMutex);
         return head;
      }

      void setHead(std::shared_ptr<const Revision> h)
      {
         std::lock_guard<std::mutex> lock(headMutex);
         head = std::move(h);
      }
   };

   SharedDatabase::SharedDatabase(const boost::filesystem::path& dir, bool allowSlow)
       : impl{std::make_shared<SharedDatabaseImpl>(dir.c_str(), allowSlow)}
   {
   }

   struct DatabaseImpl
   {
      SharedDatabase                           shared;
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

      void startRead()
      {
         check(writeRevisions.empty() && !readOnlyRevision, "database session already active");
         if (!readSession && !writeSession)
            readSession = shared.impl->trie->start_read_session();
         readOnlyRevision = shared.impl->getHead();
      }

      void startWrite()
      {
         check(!readOnlyRevision, "can't mix read and write revisions");
         if (!writeSession)
         {
            writeSession = shared.impl->trie->start_write_session();
            readSession  = nullptr;
         }
         if (writeRevisions.empty())
            writeRevisions.push_back(shared.impl->getHead()->clone());
         else
            writeRevisions.push_back(writeRevisions.back()->clone());
      }

      void commit()
      {
         if (readOnlyRevision)
            readOnlyRevision = nullptr;
         else if (writeRevisions.size() == 1)
         {
            // TODO: fork db
            check((bool)writeSession, "writeSession is missing");
            auto& rev = writeRevisions.back();
            writeRevision(*writeSession, *rev);
            writeSession->set_top_root(rev->topRoot);
            shared.impl->setHead(rev);
            writeRevisions.pop_back();
         }
         else if (writeRevisions.size() > 1)
            writeRevisions.erase(writeRevisions.end() - 2);
         else
            throw std::runtime_error("mismatched commit");
      }

      void abort()
      {
         if (readOnlyRevision)
            readOnlyRevision = nullptr;
         else if (!writeRevisions.empty())
            writeRevisions.pop_back();
      }
   };  // DatabaseImpl

   Database::Database(SharedDatabase shared)
       : impl{std::make_unique<DatabaseImpl>(DatabaseImpl{std::move(shared)})}
   {
   }

   Database::~Database() {}

   Database::Session Database::startRead()
   {
      impl->startRead();
      return {this};
   }

   Database::Session Database::startWrite()
   {
      impl->startWrite();
      return {this};
   }

   void Database::commit(Database::Session&)
   {
      impl->commit();
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
