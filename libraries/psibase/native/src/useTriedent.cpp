#include <psibase/db.hpp>

#include <boost/filesystem/operations.hpp>
#include <triedent/database.hpp>

namespace psibase
{
   // TODO: move triedent::root destruction to a gc thread
   struct Revision
   {
      std::shared_ptr<triedent::root> topRoot;
      std::shared_ptr<triedent::root> roots[numDatabases];
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
         const auto& revision = [this]
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
            writeRevisions.push_back(std::make_shared<Revision>(*shared.impl->getHead()));
         else
            writeRevisions.push_back(writeRevisions.back());
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
             session.upsert(revision.roots[(int)db], {key.pos, key.remaining()},
                            {value.pos, value.remaining()});
          });
   }

   void Database::kvRemoveRaw(DbId db, psio::input_stream key)
   {
      impl->write(
          [&](auto& session, auto& revision) {
             session.remove(revision.roots[(int)db], {key.pos, key.remaining()});
          });
   }

   std::optional<psio::input_stream> Database::kvGetRaw(DbId db, psio::input_stream key)
   {
      return impl->read(
          [&](auto& session, auto& revision) -> std::optional<psio::input_stream>
          {
             if (!session.get(revision.roots[(int)db], {key.pos, key.remaining()},
                              &impl->valueBuffer, nullptr))
                return {};
             return {{impl->valueBuffer.data(), impl->valueBuffer.size()}};
          });
   }

   std::optional<Database::KVResult> Database::kvGreaterEqualRaw(DbId               db,
                                                                 psio::input_stream key,
                                                                 size_t             matchKeySize)
   {
      return impl->read(
          [&](auto& session, auto& revision) -> std::optional<Database::KVResult>
          {
             if (!session.get_greater_equal(revision.roots[(int)db], {key.pos, key.remaining()},
                                            &impl->keyBuffer, &impl->valueBuffer, nullptr))
                return {};
             return {{{impl->keyBuffer.data(), impl->keyBuffer.size()},
                      {impl->valueBuffer.data(), impl->valueBuffer.size()}}};
          });
   }

   std::optional<Database::KVResult> Database::kvLessThanRaw(DbId               db,
                                                             psio::input_stream key,
                                                             size_t             matchKeySize)
   {
      return impl->read(
          [&](auto& session, auto& revision) -> std::optional<Database::KVResult>
          {
             if (!session.get_less_than(revision.roots[(int)db], {key.pos, key.remaining()},
                                        &impl->keyBuffer, &impl->valueBuffer, nullptr))
                return {};
             return {{{impl->keyBuffer.data(), impl->keyBuffer.size()},
                      {impl->valueBuffer.data(), impl->valueBuffer.size()}}};
          });
   }

   std::optional<Database::KVResult> Database::kvMaxRaw(DbId db, psio::input_stream key)
   {
      return impl->read(
          [&](auto& session, auto& revision) -> std::optional<Database::KVResult>
          {
             if (!session.get_max(revision.roots[(int)db], {key.pos, key.remaining()},
                                  &impl->keyBuffer, &impl->valueBuffer, nullptr))
                return {};
             return {{{impl->keyBuffer.data(), impl->keyBuffer.size()},
                      {impl->valueBuffer.data(), impl->valueBuffer.size()}}};
          });
   }

}  // namespace psibase
