#include <unistd.h>
#include <atomic>
#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers.hpp>
#include <filesystem>
#include <fstream>
#include <map>
#include <random>
#include <psibase/CpuAccounting.hpp>
#include <psibase/Socket.hpp>
#include <psibase/api.hpp>
#include <psibase/db.hpp>
#include <psibase/nativeTables.hpp>
#include <psio/to_key.hpp>
#include <thread>
using namespace psibase;
namespace
{
   const psibase::storage::database_config config{1 << 27, 1 << 27, 1 << 27, 1 << 27};
   std::filesystem::path           directory(std::string_view name)
   {
      static std::atomic<unsigned> count = 0;
      auto                         path =
          std::filesystem::path(PSIBASE_STORAGE_TEST_ROOT) /
          (std::string(name) + "-" + std::to_string(::getpid()) + "-" + std::to_string(count++));
      if (std::filesystem::exists(path))
         throw std::runtime_error("test directory already exists");
      return path;
   }
   std::span<const char> span(std::string_view s)
   {
      return {s.data(), s.size()};
   }
   std::string value(Database& db, DbId id, std::string_view key = "contract")
   {
      auto v = db.kvGetRaw(id, span(key));
      return v ? std::string(v->pos, v->end) : "<missing>";
   }
   void put(Database& db, DbId id, std::string_view v, std::string_view key = "contract")
   {
      db.kvPutRaw(id, span(key), span(v));
   }
   Checksum256 blockId(std::uint32_t number, unsigned fork = 0)
   {
      Checksum256 id{};
      for (unsigned i = 0; i < 4; ++i)
         id[i] = number >> (24 - 8 * i);
      id.back() = fork;
      return id;
   }
   ConstRevisionPtr revision(SharedDatabase&    shared,
                             WriterPtr          writer,
                             const Checksum256& id,
                             const Checksum256& previous,
                             std::string_view   v)
   {
      Database db(shared, shared.emptyRevision());
      auto     session = db.startWrite(writer);
      put(db, DbId::service, v);
      StatusRow status{};
      status.head                  = BlockInfo{};
      status.head->header.previous = previous;
      db.kvPut(StatusRow::db, statusKey(), status);
      return session.writeRevision(id);
   }
   struct TestSocket : AutoCloseSocket
   {
      unsigned   closedCallbacks = 0;
      void       send(Writer&, std::span<const char>, std::uint32_t) override {}
      SocketInfo info() const override { return HttpSocketInfo{}; }
      void       onClose(const std::optional<std::string>&) noexcept override { ++closedCallbacks; }
   };
}  // namespace

TEST_CASE("psitri native database preserves complete nested root frames", "[storage][psitri]")
{
   auto path = directory("nested");
   {
      SharedDatabase shared(path, config, psibase::storage::open_mode::create_new);
      auto           writer = shared.createWriter();
      Database       db(shared, shared.emptyRevision());
      auto           outer = db.startWrite(writer);
      for (unsigned i = 0; i < numChainDatabases; ++i)
         put(db, DbId(i), "outer");
      {
         auto inner = db.startWrite(writer);
         for (unsigned i = 0; i < numChainDatabases; ++i)
            put(db, DbId(i), "inner");
         inner.commit();
      }
      {
         auto aborted = db.startWrite(writer);
         for (unsigned i = 0; i < numChainDatabases; ++i)
            put(db, DbId(i), "must-abort");
      }
      for (unsigned i = 0; i < numChainDatabases; ++i)
         REQUIRE(value(db, DbId(i)) == "inner");
      auto retained = outer.writeRevision(blockId(1));
      shared.setHead(*writer, retained);
      {
         Database branch(shared, retained);
         auto     aborted = branch.startWrite(writer);
         {
            auto inner = branch.startWrite(writer);
            put(branch, DbId::service, "nested-commit");
            inner.commit();
         }
      }
      Database read(shared, retained);
      auto     session = read.startRead();
      for (unsigned i = 0; i < numChainDatabases; ++i)
         REQUIRE(value(read, DbId(i)) == "inner");
   }
   {
      SharedDatabase reopened(path, config, psibase::storage::open_mode::read_only);
      Database       db(reopened, reopened.getHead());
      auto           session = db.startRead();
      for (unsigned i = 0; i < numChainDatabases; ++i)
         REQUIRE(value(db, DbId(i)) == "inner");
   }
}

TEST_CASE("psitri write sessions read their own pending changes in every direction",
          "[storage][psitri][pending]")
{
   // A write session keeps its changes aside and folds them into the trees
   // only when a revision is asked for. Every read has to see them anyway:
   // point reads, both seek directions and prefix maxima, through nested
   // sessions that commit or are abandoned, and across a fold that happens
   // while nested sessions are still open. A std::map per nesting level is the
   // reference.
   using Model = std::map<std::string, std::string>;
   SharedDatabase shared(directory("pending"), config, psibase::storage::open_mode::create_new);
   auto           writer = shared.createWriter();
   std::mt19937   rng(20261122);
   auto           randomKey = [&]
   {
      // Short keys over a small alphabet, so prefixes and neighbours collide.
      std::string key(1 + rng() % 3, 'a');
      for (auto& c : key)
         c = char('a' + rng() % 4);
      return key;
   };
   auto check = [&](Database& db, DbId id, const Model& model)
   {
      for (int i = 0; i < 12; ++i)
      {
         const auto key = randomKey();
         {
            auto it = model.find(key);
            REQUIRE(value(db, id, key) == (it == model.end() ? "<missing>" : it->second));
            REQUIRE(db.kvContains(id, span(key)) == (it != model.end()));
         }
         {
            auto found = db.kvGreaterEqualRaw(id, span(key), 0);
            auto it    = model.lower_bound(key);
            REQUIRE(bool(found) == (it != model.end()));
            if (found)
            {
               REQUIRE(std::string(found->key.pos, found->key.end) == it->first);
               REQUIRE(std::string(found->value.pos, found->value.end) == it->second);
            }
         }
         {
            auto found = db.kvLessThanRaw(id, span(key), 0);
            auto it    = model.lower_bound(key);
            REQUIRE(bool(found) == (it != model.begin()));
            if (found)
            {
               --it;
               REQUIRE(std::string(found->key.pos, found->key.end) == it->first);
               REQUIRE(std::string(found->value.pos, found->value.end) == it->second);
            }
         }
         {
            const auto prefix = key.substr(0, 1);
            auto       found  = db.kvMaxRaw(id, span(prefix));
            auto       it     = model.lower_bound(std::string(1, char(prefix[0] + 1)));
            const bool expect = it != model.begin() && std::prev(it)->first.starts_with(prefix);
            REQUIRE(bool(found) == expect);
            if (found)
               REQUIRE(std::string(found->key.pos, found->key.end) == std::prev(it)->first);
         }
      }
   };
   const DbId       ids[] = {DbId::service, DbId::native, DbId::writeOnly};
   ConstRevisionPtr base  = shared.emptyRevision();
   std::array<Model, 3> committed;
   for (unsigned block = 1; block <= 12; ++block)
   {
      Database                          db(shared, base);
      std::vector<Database::Session>    sessions;
      std::vector<std::array<Model, 3>> levels{committed};
      sessions.push_back(db.startWrite(writer));
      // A revision taken while sessions are open, and what it has to hold.
      std::vector<std::pair<ConstRevisionPtr, std::array<Model, 3>>> taken;
      for (int step = 0; step < 400; ++step)
      {
         const auto which = rng() % 3;
         const auto roll  = rng() % 100;
         auto&      model = levels.back()[which];
         if (roll < 55)
         {
            const auto key = randomKey();
            const auto v   = "b" + std::to_string(block) + "s" + std::to_string(step);
            put(db, ids[which], v, key);
            model[key] = v;
         }
         else if (roll < 75)
         {
            const auto key = randomKey();
            db.kvRemoveRaw(ids[which], span(key));
            model.erase(key);
         }
         else if (roll < 83 && levels.size() < 5)
         {
            sessions.push_back(db.startWrite(writer));
            levels.push_back(levels.back());
         }
         else if (roll < 88 && levels.size() > 1)
         {
            // Commit the innermost session into the one around it.
            sessions.back().commit();
            sessions.pop_back();
            levels[levels.size() - 2] = std::move(levels.back());
            levels.pop_back();
         }
         else if (roll < 93 && levels.size() > 1)
         {
            sessions.pop_back();  // abandoned
            levels.pop_back();
         }
         else if (roll < 96)
            taken.emplace_back(db.getModifiedRevision(), levels.back());
         check(db, ids[which], levels.back()[which]);
      }
      while (levels.size() > 1)
      {
         sessions.pop_back();
         levels.pop_back();
      }
      for (unsigned i = 0; i < 3; ++i)
         check(db, ids[i], levels.back()[i]);
      // Revisions taken part-way are trees of their own: later writes and
      // rollbacks of the session they came from do not show in them.
      for (auto& [revision, models] : taken)
      {
         Database snapshot(shared, revision);
         auto     reading = snapshot.startRead();
         for (unsigned i = 0; i < 3; ++i)
            check(snapshot, ids[i], models[i]);
      }
      if (block % 3 == 0)
      {
         sessions.clear();  // an abandoned block leaves nothing behind
         Database again(shared, base);
         auto     reading = again.startRead();
         for (unsigned i = 0; i < 3; ++i)
            check(again, ids[i], committed[i]);
      }
      else
      {
         base      = sessions.back().writeRevision(blockId(block));
         committed = levels.back();
         sessions.clear();
         Database again(shared, base);
         auto     reading = again.startRead();
         for (unsigned i = 0; i < 3; ++i)
            check(again, ids[i], committed[i]);
      }
   }
}

TEST_CASE("psitri subjective OCC retries preserve callbacks and independent writes",
          "[storage][psitri]")
{
   SharedDatabase    shared(directory("occ"), config, psibase::storage::open_mode::create_new);
   auto              writer = shared.createWriter();
   DatabaseCallbacks callbacks;
   unsigned          called  = 0;
   callbacks.nextTransaction = [&] { ++called; };
   shared.setCallbacks(&callbacks);
   Sockets            sockets(shared);
   SocketAutoCloseSet closing;
   Database           first(shared, shared.emptyRevision()), second(shared, shared.emptyRevision());
   auto               s1 = first.startWrite(writer);
   auto               s2 = second.startWrite(writer);
   first.checkoutSubjective();
   second.checkoutSubjective();
   REQUIRE(value(first, DbId::subjective, "a") == "<missing>");
   put(first, DbId::subjective, "first", "b");
   first.setCallbackFlags(DatabaseCallbacks::nextTransactionFlag);
   put(second, DbId::subjective, "second", "a");
   REQUIRE(second.commitSubjective(sockets, closing));
   REQUIRE_FALSE(first.commitSubjective(sockets, closing));
   REQUIRE(called == 0);
   REQUIRE(value(first, DbId::subjective, "a") == "second");
   put(first, DbId::subjective, "retry", "b");
   REQUIRE(first.commitSubjective(sockets, closing));
   REQUIRE(called == 1);
   shared.setCallbacks(nullptr);
   auto a = shared.kvGetSubjective(*writer, DbId::subjective, span("a"));
   auto b = shared.kvGetSubjective(*writer, DbId::subjective, span("b"));
   REQUIRE(a);
   REQUIRE(b);
   REQUIRE(std::string(a->begin(), a->end()) == "second");
   REQUIRE(std::string(b->begin(), b->end()) == "retry");
}

TEST_CASE("psitri subjective writes and queries run beside block publication",
          "[storage][psitri]")
{
   auto path = directory("parallel");
   {
      // Flushed publication is the slow case: subjective work must not queue behind it.
      auto flushed = config;
      flushed.sync = psibase::storage::durability::flush;
      SharedDatabase shared(path, flushed, psibase::storage::open_mode::create_new);
      auto           writer = shared.createWriter();
      auto           first  = revision(shared, writer, blockId(1), blockId(0), "block-1");
      shared.setHead(*writer, first);

      std::atomic<bool>        failed{false};
      std::atomic<unsigned>    queries{0};
      std::atomic<bool>        done{false};
      std::vector<std::thread> threads;
      for (unsigned t = 0; t < 4; ++t)
         threads.emplace_back(
             [&, t]
             {
                // Session-style writers: each keeps its own key in node-local state.
                auto              mine = shared.createWriter();
                const std::string key  = "session-" + std::to_string(t);
                for (unsigned i = 0; i < 150; ++i)
                {
                   const auto text = std::to_string(i);
                   shared.kvPutSubjective(*mine, DbId::nativeSubjective, span(key), span(text));
                   auto got = shared.kvGetSubjective(*mine, DbId::nativeSubjective, span(key));
                   if (!got || std::string(got->begin(), got->end()) != text)
                      failed = true;
                }
             });
      for (unsigned t = 0; t < 4; ++t)
         threads.emplace_back(
             [&]
             {
                // Queries: read consensus state from whatever head is current.
                while (!done)
                {
                   Database db(shared, shared.getHead());
                   auto     session = db.startRead();
                   if (!value(db, DbId::service).starts_with("block-"))
                      failed = true;
                   ++queries;
                }
             });
      for (std::uint32_t block = 2; block <= 40; ++block)
         shared.setHead(*writer, revision(shared, writer, blockId(block), blockId(block - 1),
                                          "block-" + std::to_string(block)));
      for (unsigned t = 0; t < 4; ++t)
         threads[t].join();
      while (queries < 20)
         std::this_thread::yield();
      done = true;
      for (unsigned t = 4; t < 8; ++t)
         threads[t].join();
      REQUIRE_FALSE(failed);
   }
   SharedDatabase reopened(path, config, psibase::storage::open_mode::read_only);
   auto           writer = reopened.createWriter();
   for (unsigned t = 0; t < 4; ++t)
   {
      auto got = reopened.kvGetSubjective(*writer, DbId::nativeSubjective,
                                          span("session-" + std::to_string(t)));
      REQUIRE(got);
      REQUIRE(std::string(got->begin(), got->end()) == "149");
   }
   Database db(reopened, reopened.getHead());
   auto     session = db.startRead();
   REQUIRE(value(db, DbId::service) == "block-40");
}

TEST_CASE("psitri persistent subjective survives while session databases reset",
          "[storage][psitri]")
{
   auto path = directory("subjective");
   {
      SharedDatabase     shared(path, config, psibase::storage::open_mode::create_new);
      auto               writer = shared.createWriter();
      Sockets            sockets(shared);
      SocketAutoCloseSet closing;
      Database           db(shared, shared.emptyRevision());
      auto               session = db.startWrite(writer);
      db.checkoutSubjective();
      for (unsigned i = unsigned(DbId::beginIndependent); i < unsigned(DbId::endIndependent); ++i)
         put(db, DbId(i), "committed");
      {
         db.checkoutSubjective();
         put(db, DbId::subjective, "must-abort");
         db.abortSubjective();
      }
      REQUIRE(value(db, DbId::subjective) == "committed");
      REQUIRE(db.commitSubjective(sockets, closing));
   }
   {
      SharedDatabase shared(path, config, psibase::storage::open_mode::read_only);
      Database       db(shared, shared.getHead());
      auto           session = db.startRead();
      db.checkoutSubjective();
      REQUIRE(value(db, DbId::subjective) == "committed");
      REQUIRE(value(db, DbId::nativeSubjective) == "committed");
      REQUIRE(value(db, DbId::session) == "<missing>");
      REQUIRE(value(db, DbId::nativeSession) == "<missing>");
      db.abortSubjective();
   }
}

TEST_CASE("psitri clones isolate metadata, head, subjective and writer ownership",
          "[storage][psitri]")
{
   SharedDatabase shared(directory("clone"), config, psibase::storage::open_mode::create_new);
   auto           writer = shared.createWriter();
   auto           parent = revision(shared, writer, blockId(1), {}, "parent");
   shared.setHead(*writer, parent);
   shared.kvPutSubjective(*writer, DbId::subjective, span("key"), span("parent"));
   auto clone = shared.clone();
   auto cw    = clone.createWriter();
   auto fork  = revision(clone, cw, blockId(2), blockId(1), "clone");
   clone.setHead(*cw, fork);
   clone.kvPutSubjective(*cw, DbId::subjective, span("key"), span("clone"));
   REQUIRE_FALSE(shared.getRevision(*writer, blockId(2)));
   auto parentValue = shared.kvGetSubjective(*writer, DbId::subjective, span("key"));
   REQUIRE(parentValue);
   REQUIRE(std::string(parentValue->begin(), parentValue->end()) == "parent");
   REQUIRE_THROWS(clone.setHead(*writer, parent));
   Database invalid(clone, clone.getHead());
   REQUIRE_THROWS(invalid.startWrite(writer));
   auto next = revision(shared, writer, blockId(3), blockId(1), "new-parent");
   shared.setHead(*writer, next);
   Database cloneRead(clone, clone.getHead());
   auto     read = cloneRead.startRead();
   REQUIRE(value(cloneRead, DbId::service) == "clone");
}

TEST_CASE("psitri retained revision pruning preserves valid descendants", "[storage][psitri]")
{
   SharedDatabase shared(directory("prune"), config, psibase::storage::open_mode::create_new);
   auto           writer = shared.createWriter();
   auto           first  = revision(shared, writer, blockId(1), {}, "first");
   auto           second = revision(shared, writer, blockId(2), blockId(1), "second");
   auto           third  = revision(shared, writer, blockId(3), blockId(2), "third");
   auto           orphan = revision(shared, writer, blockId(3, 1), blockId(1), "orphan");
   shared.setHead(*writer, third);
   shared.removeRevisions(*writer, blockId(2));
   REQUIRE_FALSE(shared.getRevision(*writer, blockId(1)));
   REQUIRE(shared.getRevision(*writer, blockId(2)));
   REQUIRE(shared.getRevision(*writer, blockId(3)));
   REQUIRE_FALSE(shared.getRevision(*writer, blockId(3, 1)));
   Database retained(shared, first);
   auto     read = retained.startRead();
   REQUIRE(value(retained, DbId::service) == "first");
}

TEST_CASE("cancelled requests cannot publish cached roots, sockets or callbacks",
          "[storage][psitri][accounting]")
{
   SharedDatabase shared(directory("cancelled"), config, psibase::storage::open_mode::create_new);
   auto           writer = shared.createWriter();
   auto           parent = revision(shared, writer, blockId(1), {}, "parent");
   shared.setHead(*writer, parent);
   auto pending = revision(shared, writer, blockId(2), blockId(1), "pending");
   auto request = std::make_shared<accounting::Request>([] { return true; });
   {
      accounting::Scope scope(request);
      request->cancel();
      REQUIRE_THROWS_AS(shared.setHead(*writer, pending), accounting::Cancelled);
   }
   {
      Database db(shared, shared.getHead());
      auto     read = db.startRead();
      REQUIRE(value(db, DbId::service) == "parent");
   }
   auto sockets = std::make_shared<Sockets>(shared);
   auto socket  = std::make_shared<TestSocket>();
   sockets->add(*writer, socket);
   SocketAutoCloseSet closing;
   unsigned           callbacks = 0;
   DatabaseCallbacks  functions;
   functions.nextTransaction = [&] { ++callbacks; };
   shared.setCallbacks(&functions);
   Database db(shared, shared.getHead());
   auto     session = db.startWrite(writer);
   db.checkoutSubjective();
   const auto flag = static_cast<std::uint32_t>(SocketFlags::notifyClose);
   REQUIRE(db.socketSetFlags(socket->id, flag, flag, *sockets, closing) == 0);
   db.setCallbackFlags(DatabaseCallbacks::nextTransactionFlag);
   auto cancelled = std::make_shared<accounting::Request>([] { return true; });
   {
      accounting::Scope scope(cancelled);
      cancelled->cancel();
      REQUIRE_THROWS_AS(db.commitSubjective(*sockets, closing), accounting::Cancelled);
   }
   REQUIRE_FALSE(socket->notifyClose);
   REQUIRE(callbacks == 0);
   db.abortSubjective();
   shared.setCallbacks(nullptr);
}

TEST_CASE("accepted subjective effects finish before deferred cancellation is reported",
          "[storage][psitri][accounting]")
{
   SharedDatabase shared(directory("accepted"), config, psibase::storage::open_mode::create_new);
   auto           writer  = shared.createWriter();
   auto           sockets = std::make_shared<Sockets>(shared);
   auto           socket  = std::make_shared<TestSocket>();
   sockets->add(*writer, socket);
   SocketAutoCloseSet closing;
   auto               request   = std::make_shared<accounting::Request>([] { return true; });
   unsigned           callbacks = 0;
   DatabaseCallbacks  functions;
   functions.nextTransaction = [&]
   {
      ++callbacks;
      request->cancel();
   };
   shared.setCallbacks(&functions);
   Database db(shared, shared.emptyRevision());
   auto     session = db.startWrite(writer);
   db.checkoutSubjective();
   const auto flag = static_cast<std::uint32_t>(SocketFlags::notifyClose);
   REQUIRE(db.socketSetFlags(socket->id, flag, flag, *sockets, closing) == 0);
   put(db, DbId::subjective, "accepted");
   db.setCallbackFlags(DatabaseCallbacks::nextTransactionFlag);
   {
      accounting::Scope scope(request);
      REQUIRE_THROWS_AS(db.commitSubjective(*sockets, closing), accounting::Cancelled);
   }
   REQUIRE(socket->notifyClose);
   REQUIRE(callbacks == 1);
   auto committed = shared.kvGetSubjective(*writer, DbId::subjective, span("contract"));
   REQUIRE(committed);
   REQUIRE(std::string(committed->begin(), committed->end()) == "accepted");
   db.abortSubjective();
   shared.setCallbacks(nullptr);
}

TEST_CASE("psitri node files remain outside the identified native store", "[storage][psitri]")
{
   auto path = directory("node-layout");
   std::filesystem::create_directories(path);
   {
      std::ofstream file(path / "config");
      file << "database-cache-policy = disabled\n";
   }
   {
      std::ofstream file(path / "node.log");
      file << "existing node log\n";
   }
   {
      SharedDatabase shared(path, config, psibase::storage::open_mode::create_new);
      CHECK(shared.directory() == std::filesystem::absolute(path / "state").lexically_normal());
      CHECK(std::filesystem::exists(path / "state" / "psibase-storage-format"));
      auto writer = shared.createWriter();
      shared.kvPutSubjective(*writer, DbId::subjective, span("layout"), span("preserved"));
   }
   {
      SharedDatabase reopened(path, config, psibase::storage::open_mode::read_only);
      auto           writer = reopened.createWriter();
      REQUIRE(reopened.kvGetSubjective(*writer, DbId::subjective, span("layout")));
   }
   auto read = [](const std::filesystem::path& file)
   {
      std::ifstream input(file);
      return std::string(std::istreambuf_iterator<char>(input), {});
   };
   CHECK(read(path / "config") == "database-cache-policy = disabled\n");
   CHECK(read(path / "node.log") == "existing node log\n");
}

TEST_CASE("psitri refuses prior root-level storage layouts before creating state",
          "[storage][psitri]")
{
   for (const char* marker : {"db", "psibase-storage-format", "roots", "segs"})
   {
      auto path = directory("previous-layout");
      std::filesystem::create_directories(path);
      {
         std::ofstream file(path / marker);
         file << "preserved prior store\n";
      }
      CHECK_THROWS_WITH(SharedDatabase(path, config, psibase::storage::open_mode::create),
                        "Database uses a previous storage layout; use a fresh chain directory");
      CHECK_FALSE(std::filesystem::exists(path / "state"));
      std::ifstream file(path / marker);
      CHECK(std::string(std::istreambuf_iterator<char>(file), {}) == "preserved prior store\n");
   }
}

TEST_CASE("psitri empty temporary paths use and clean up the system temporary directory",
          "[storage][psitri]")
{
   std::filesystem::path temporary;
   {
      SharedDatabase shared({}, config, psibase::storage::open_mode::temporary);
      temporary = shared.directory();
      CHECK(std::filesystem::weakly_canonical(temporary.parent_path()) ==
            std::filesystem::weakly_canonical(std::filesystem::temp_directory_path()));
      CHECK(std::filesystem::exists(temporary / "psibase-storage-format"));
   }
   CHECK_FALSE(std::filesystem::exists(temporary));
}
