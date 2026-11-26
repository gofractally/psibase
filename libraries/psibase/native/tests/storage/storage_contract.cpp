#include <signal.h>
#include <sys/wait.h>
#include <unistd.h>
#include <algorithm>
#include <array>
#include <atomic>
#include <cstring>
#include <fstream>
#include <functional>
#include <mutex>
#include <vector>
#include <iostream>
#include <psibase/storage.hpp>
#include <psibase/storageDiagnostics.hpp>
#include <stdexcept>
#include <string>
#include <thread>
using namespace psibase::storage;
const database_config config{1 << 27, 1 << 27, 1 << 27, 1 << 27};
std::span<const char> span(std::string_view s)
{
   return {s.data(), s.size()};
}
void require(bool condition, const char* message)
{
   if (!condition)
      throw std::runtime_error(message);
}
template <class F>
void throws(F f, const char* message)
{
   bool caught = false;
   try
   {
      f();
   }
   catch (const std::exception&)
   {
      caught = true;
   }
   require(caught, message);
}
std::string get(read_session& reader, const shared_root& root, std::string_view key)
{
   auto value = reader.get(root, span(key));
   return value ? std::string(value->begin(), value->end()) : "<missing>";
}
void put(write_session& writer, shared_root& root, std::string_view key, std::string_view value)
{
   writer.upsert(root, span(key), span(value));
}
std::vector<std::string> digest(const std::filesystem::path& path)
{
   std::vector<std::string> result;
   for (const auto& entry : std::filesystem::recursive_directory_iterator(path))
      if (entry.is_regular_file())
      {
         std::ifstream           file(entry.path(), std::ios::binary);
         std::array<char, 65536> buffer;
         std::uint64_t           hash = 14695981039346656037ull;
         while (file)
         {
            file.read(buffer.data(), buffer.size());
            for (std::streamsize i = 0; i < file.gcount(); ++i)
            {
               hash ^= static_cast<unsigned char>(buffer[i]);
               hash *= 1099511628211ull;
            }
         }
         result.push_back(entry.path().lexically_relative(path).string() + ":" +
                          std::to_string(entry.file_size()) + ":" + std::to_string(hash));
      }
   std::sort(result.begin(), result.end());
   return result;
}
int main(int argc, char** argv)
{
   if (argc != 2)
      return 2;
   if (std::string_view(argv[1]) == "--reject-engine-environment")
   {
      const auto path =
          std::filesystem::path("rejected-engine-environment-" + std::to_string(::getpid()));
      bool rejected = false;
      try
      {
         database db(path, config, open_mode::create_new);
      }
      catch (const std::runtime_error& error)
      {
         rejected = std::string_view(error.what())
                        .starts_with("Unsupported psitri engine environment override ");
      }
      require(rejected, "unsupported cached engine environment was accepted");
      require(!std::filesystem::exists(path),
              "environment rejection touched the database directory");
      std::cout << "Unsupported engine environment rejected before opening a store\n";
      return 0;
   }
   const std::filesystem::path base = std::string(argv[1]) + "-" + std::to_string(::getpid());
   if (std::filesystem::exists(base))
      throw std::runtime_error("test path already exists");
   std::filesystem::create_directories(base);
   unsigned passed = 0;
   auto     test   = [&](const char* name, auto function)
   {
      std::cout << name << "..." << std::flush;
      function();
      ++passed;
      std::cout << "ok\n";
   };
   try
   {
      test("more threads read one database than the engine has session slots",
           [&]
           {
              // gofractally/psibase#2273: the engine has 64 session slots per
              // database and ends the process when asked for a 65th. Every
              // thread that reads counts, also one that has since exited.
              database db(base / "many-readers", config, open_mode::create_new);
              shared_root top;
              {
                 auto w = db.start_write_session();
                 top    = w->get_top_root();
                 put(*w, top, "key", "value");
                 w->set_top_root(top);
              }
              auto read = [&]
              {
                 auto r = db.start_read_session();
                 require(get(*r, top, "key") == "value", "a reader missed the value");
              };
              // 100 threads, one after another: each leaves its reader behind.
              for (unsigned i = 0; i < 100; ++i)
                 std::thread(read).join();
              // 100 threads at once, each reading repeatedly.
              std::vector<std::thread> threads;
              for (unsigned i = 0; i < 100; ++i)
                 threads.emplace_back(
                     [&]
                     {
                        for (unsigned n = 0; n < 50; ++n)
                           read();
                     });
              for (auto& thread : threads)
                 thread.join();
           });
      test("temporary stores never adopt a stale same-process name",
           [&]
           {
              // Reproduce the first legacy pid/serial name deterministically,
              // before this process opens any temporary database.
              const auto stale = base / ("psibase-temporary-" + std::to_string(::getpid()) + "-0");
              {
                 database db(stale, config, open_mode::create_new);
                 auto     w   = db.start_write_session();
                 auto     top = w->get_top_root();
                 put(*w, top, "stale", "must survive");
                 w->set_top_root(top);
              }
              std::filesystem::path temporary;
              {
                 database db(base, config, open_mode::temporary);
                 temporary = db.directory();
                 require(temporary != stale, "temporary adopted a stale database name");
                 auto w = db.start_write_session();
                 require(get(*w, w->get_top_root(), "stale") == "<missing>",
                         "temporary database inherited stale data");
              }
              require(!std::filesystem::exists(temporary), "temporary directory was not removed");
              require(std::filesystem::exists(stale), "temporary cleanup removed another store");
              database db(stale, config, open_mode::read_write);
              auto     w = db.start_write_session();
              require(get(*w, w->get_top_root(), "stale") == "must survive",
                      "stale store data was changed");
           });
      test("diagnostic path boundaries and unavailable pressure",
           [&]
           {
              require(databaseMapping("/var/db/segs", "/var/db"), "database mapping missed");
              require(!databaseMapping("/var/db-other/segs", "/var/db"), "path prefix collision");
              require(!databaseMapping("[anon]", "/var/db"), "anonymous mapping attributed");
              require(databaseMapping("/var/db\\040name/segs (deleted)", "/var/db name"),
                      "escaped/deleted path missed");
              database db(base / "diagnostics", config, open_mode::create_new);
              require(!db.is_slow().has_value(), "fabricated healthy pressure");
           });
      test("owned roots, nested rollback, atomic manifest and reopen",
           [&]
           {
              {
                 database    db(base / "manifest", config, open_mode::create_new);
                 auto        w = db.start_write_session();
                 shared_root a, b;
                 put(*w, a, "a", "before");
                 put(*w, b, "b", "before");
                 std::array<shared_root, 2> frame{a, b};
                 put(*w, a, "a", "outer");
                 auto outerA = a;
                 put(*w, a, "a", "inner");
                 put(*w, b, "b", "inner");
                 a = outerA;
                 b = frame[1];
                 require(get(*w, a, "a") == "outer" && get(*w, b, "b") == "before",
                         "nested root rollback");
                 a = frame[0];
                 require(get(*w, a, "a") == "before", "outer rollback");
                 auto                       top = w->get_top_root();
                 std::array<shared_root, 3> roots{a, b, {}};
                 w->upsert(top, span("revision/one"), roots);
                 w->set_top_root(top);
                 put(*w, a, "a", "unpublished");
                 w->upsert(top, span("revision/two"), roots);
                 require(!w->get(w->get_top_root(), span("revision/two")),
                         "unpublished metadata escaped");
              }
              {
                 database                 db(base / "manifest", config, open_mode::read_write);
                 auto                     w = db.start_write_session();
                 std::vector<shared_root> roots;
                 require(w->get(w->get_top_root(), span("revision/one"), nullptr, &roots),
                         "retained revision missing");
                 require(roots.size() == 3 && !roots[2], "root-list empty entry lost");
                 require(get(*w, roots[0], "a") == "before" && get(*w, roots[1], "b") == "before",
                         "root ownership/reopen");
              }
           });
      test("ordered ranges, binary keys and max prefix",
           [&]
           {
              database    db(base / "ranges", config, open_mode::create_new);
              auto        w = db.start_write_session();
              shared_root r;
              for (auto key : {std::string(""), std::string("a"), std::string("a\0", 2),
                               std::string("a\xff", 2), std::string("b"), std::string("\xff", 1)})
                 put(*w, r, key, key);
              std::vector<char> key, value;
              require(w->get_less_than(r, span("b"), &key, &value) &&
                          std::string(key.begin(), key.end()) == std::string("a\xff", 2),
                      "strict less-than");
              require(!w->get_less_than(r, {}, &key, &value), "empty lower bound");
              require(w->get_max(r, span("a"), &key, &value) &&
                          std::string(key.begin(), key.end()) == std::string("a\xff", 2),
                      "max prefix");
              require(w->get_max(r, span(std::string("\xff", 1)), &key, &value) &&
                          key.size() == 1 && static_cast<unsigned char>(key[0]) == 255,
                      "unbounded prefix max");
              key = {'a'};
              require(w->get_greater_equal(r, key, &key, &value) && key == std::vector<char>{'a'},
                      "aliased key buffers");
              require(w->is_empty(r, span("a"), span("a")), "empty half-open range");
           });
      test("large opaque value and exception cleanup",
           [&]
           {
              const std::string large(16 * 1024 * 1024, 'x');
              {
                 database    db(base / "large", config, open_mode::create_new);
                 auto        w = db.start_write_session();
                 shared_root r;
                 put(*w, r, "large", large);
                 require(get(*w, r, "large") == large, "large value");
                 database    foreign(base / "foreign", config, open_mode::create_new);
                 auto        fw = foreign.start_write_session();
                 shared_root other;
                 put(*fw, other, "other", "value");
                 throws([&] { put(*w, other, "x", "foreign"); }, "foreign mutation accepted");
                 std::vector<char> key, value;
                 throws([&] { w->get_greater_equal(other, {}, &key, &value); },
                        "foreign read accepted");
                 put(*w, r, "after", "ok");
                 require(get(*w, r, "after") == "ok", "executor not usable after exception");
                 auto                       top = w->get_top_root();
                 std::array<shared_root, 1> roots{r};
                 w->upsert(top, span("large-root"), roots);
                 w->set_top_root(top);
              }
              database                 reopened(base / "large", config, open_mode::read_only);
              auto                     reader = reopened.start_write_session();
              std::vector<shared_root> roots;
              require(reader->get(reader->get_top_root(), span("large-root"), nullptr, &roots) &&
                          roots.size() == 1,
                      "large root reopen");
              require(get(*reader, roots[0], "large") == large, "large value read-only reopen");
           });
      test("clone does not publish or observe parent changes",
           [&]
           {
              database parent(base / "clone", config, open_mode::create_new);
              auto     w   = parent.start_write_session();
              auto     top = w->get_top_root();
              put(*w, top, "head", "one");
              w->set_top_root(top);
              auto clone = parent.clone();
              auto cw    = clone->start_write_session();
              auto copy  = cw->get_top_root();
              put(*cw, copy, "head", "clone");
              cw->set_top_root(copy);
              require(get(*w, w->get_top_root(), "head") == "one", "clone published parent root");
              put(*w, top, "head", "two");
              w->set_top_root(top);
              require(get(*cw, cw->get_top_root(), "head") == "clone",
                      "clone observed parent update");
           });
      test("retained roots and clone leases outlive caller, cross-thread teardown",
           [&]
           {
              shared_root                    retained;
              std::shared_ptr<database>      clone;
              std::shared_ptr<write_session> writer;
              {
                 database db(base / "leases", config, open_mode::create_new);
                 writer = db.start_write_session();
                 put(*writer, retained, "retained", "alive");
                 clone = db.clone();
              }
              require(get(*writer, retained, "retained") == "alive",
                      "retained root lost database lifetime");
              std::thread other(
                  [r = std::move(retained), w = std::move(writer), c = std::move(clone)]() mutable
                  {
                     require(get(*w, r, "retained") == "alive", "cross-thread read");
                     r.reset();
                     w.reset();
                     c.reset();
                  });
              other.join();
           });
      test("read-only open and rejected opens leave every file unchanged",
           [&]
           {
              const auto path = base / "readonly";
              {
                 database db(path, config, open_mode::create_new);
                 auto     w   = db.start_write_session();
                 auto     top = w->get_top_root();
                 put(*w, top, "value", "stable");
                 w->set_top_root(top);
              }
              const auto before = digest(path);
              {
                 database db(path, config, open_mode::read_only);
                 auto     reader = db.start_read_session();
                 auto     proxy  = db.start_write_session();
                 auto     top    = proxy->get_top_root();
                 require(get(*reader, top, "value") == "stable", "read-only read");
                 throws([&] { put(*proxy, top, "value", "bad"); }, "read-only mutation");
              }
              require(before == digest(path), "read-only changed file bytes");
              throws([&] { database db(path, config, open_mode::create_new); },
                     "create-only existing store");
              require(before == digest(path), "rejected create changed file bytes");
              throws([&] { database db(base / "missing", config, open_mode::read_write); },
                     "open-existing created missing store");
              require(!std::filesystem::exists(base / "missing"), "missing store created");
              std::filesystem::create_directory(base / "unknown");
              std::ofstream(base / "unknown/foreign") << "must stay";
              throws([&] { database db(base / "unknown", config, open_mode::create); },
                     "unidentified store accepted");
              require(std::filesystem::exists(base / "unknown/foreign"), "unknown store removed");
           });
      test("reads run beside the writer and are never queued behind it",
           [&]
           {
              database db(base / "parallel", config, open_mode::create_new);
              auto     w = db.start_write_session();
              shared_root small, large;
              for (unsigned i = 0; i < 64; ++i)
                 put(*w, small, "key" + std::to_string(i), "value" + std::to_string(i));
              for (unsigned i = 0; i < 20000; ++i)
                 put(*w, large, "bulk" + std::to_string(i), std::string(64, 'x'));
              // A long run of writer operations.
              std::atomic<bool> writing{false}, written{false};
              std::thread       writer(
                  [&]
                  {
                     shared_root copy = large;
                     writing = true;
                     for (unsigned i = 0; i < 20000; ++i)
                        put(*w, copy, "more" + std::to_string(i), std::string(64, 'y'));
                     written = true;
                  });
              while (!writing)
                 std::this_thread::yield();
              auto     reader  = db.start_read_session();
              unsigned during  = 0;
              for (unsigned round = 0; round < 200 && !written; ++round)
              {
                 for (unsigned i = 0; i < 64; ++i)
                    require(get(*reader, small, "key" + std::to_string(i)) ==
                                "value" + std::to_string(i),
                            "read beside the writer");
                 if (!written)
                    ++during;
              }
              writer.join();
              require(during > 0, "reads waited for the writer to finish");
           });
      test("readers on many threads see whole snapshots while roots are published and dropped",
           [&]
           {
              database    db(base / "snapshots", config, open_mode::create_new);
              auto        w = db.start_write_session();
              std::mutex  mutex;
              shared_root latest;
              auto        build = [&](unsigned generation)
              {
                 shared_root next;
                 {
                    std::lock_guard l(mutex);
                    next = latest;
                 }
                 for (unsigned i = 0; i < 100; ++i)
                    put(*w, next, "key" + std::to_string(i), std::to_string(generation));
                 std::lock_guard l(mutex);
                 latest = std::move(next);
              };
              build(1);
              std::atomic<bool>        done{false};
              std::atomic<unsigned>    reads{0};
              std::vector<std::thread> readers;
              for (unsigned r = 0; r < 6; ++r)
                 readers.emplace_back(
                     [&]
                     {
                        auto reader = db.start_read_session();
                        while (!done)
                        {
                           shared_root mine;
                           {
                              std::lock_guard l(mutex);
                              mine = latest;
                           }
                           const auto generation = get(*reader, mine, "key0");
                           for (unsigned i = 1; i < 100; ++i)
                              require(get(*reader, mine, "key" + std::to_string(i)) == generation,
                                      "snapshot mixed two generations");
                           ++reads;
                        }  // `mine` is dropped on this thread, outside any lock
                     });
              for (unsigned generation = 2; generation <= 150; ++generation)
              {
                 build(generation);
                 if (generation % 5 == 0)
                 {
                    auto top = w->get_top_root();
                    std::array<shared_root, 1> roots;
                    {
                       std::lock_guard l(mutex);
                       roots[0] = latest;
                    }
                    w->upsert(top, span("state"), roots);
                    w->set_top_root(top);
                 }
              }
              while (reads < 30)
                 std::this_thread::yield();
              done = true;
              for (auto& t : readers)
                 t.join();
           });
      test("the local root publishes apart from the top root and survives reopen",
           [&]
           {
              const auto path = base / "local";
              {
                 database db(path, config, open_mode::create_new);
                 auto     w = db.start_write_session();
                 require(!w->get_local_root(), "fresh store has a local root");
                 auto top = w->get_top_root();
                 put(*w, top, "head", "one");
                 w->set_top_root(top);
                 shared_root local;
                 put(*w, local, "session", "alice");
                 w->set_local_root(local);
                 require(get(*w, w->get_top_root(), "head") == "one" &&
                             get(*w, w->get_top_root(), "session") == "<missing>",
                         "local publication changed the top root");
                 auto clone = db.clone();
                 auto cw    = clone->start_write_session();
                 auto mine  = cw->get_local_root();
                 put(*cw, mine, "session", "clone");
                 cw->set_local_root(mine);
                 require(get(*w, w->get_local_root(), "session") == "alice",
                         "clone published the local root");
                 require(get(*cw, cw->get_local_root(), "session") == "clone",
                         "clone lost its own local root");
              }
              {
                 database db(path, config, open_mode::read_only);
                 auto     proxy = db.start_write_session();
                 require(get(*proxy, proxy->get_local_root(), "session") == "alice",
                         "local root not visible read-only");
              }
              database db(path, config, open_mode::read_write);
              auto     w = db.start_write_session();
              require(get(*w, w->get_local_root(), "session") == "alice" &&
                          get(*w, w->get_top_root(), "head") == "one",
                      "roots lost across reopen");
              w->set_local_root({});
              require(!w->get_local_root(), "local root not cleared");
           });
      test("flushed durability survives a killed writer as well",
           [&]
           {
              const auto      path = base / "flushed";
              database_config flushed = config;
              flushed.sync            = durability::flush;
              {
                 database db(path, flushed, open_mode::create_new);
                 auto     w   = db.start_write_session();
                 auto     top = w->get_top_root();
                 put(*w, top, "head", "durable");
                 w->set_top_root(top);
              }
              database db(path, flushed, open_mode::read_write);
              auto     w = db.start_write_session();
              require(get(*w, w->get_top_root(), "head") == "durable", "flushed store reopen");
           });
      test("concurrent read-only opens share a store and leave every file unchanged",
           [&]
           {
              const auto path = base / "shared-readers";
              {
                 database db(path, config, open_mode::create_new);
                 auto     w   = db.start_write_session();
                 auto     top = w->get_top_root();
                 put(*w, top, "value", "stable");
                 w->set_top_root(top);
              }
              const auto before = digest(path);
              {
                 database first(path, config, open_mode::read_only);
                 auto     firstReader = first.start_read_session();
                 auto     firstTop    = first.start_write_session()->get_top_root();
                 database second(path, config, open_mode::read_only);
                 auto     secondReader = second.start_read_session();
                 auto     secondTop    = second.start_write_session()->get_top_root();
                 require(get(*firstReader, firstTop, "value") == "stable" &&
                             get(*secondReader, secondTop, "value") == "stable",
                         "concurrent read-only read");
                 require(before == digest(path), "live read-only roots changed file bytes");
                 throws([&] { database writer(path, config, open_mode::read_write); },
                        "writer opened beside read-only openers");
              }
              require(before == digest(path), "read-only openers changed file bytes");
           });
      test("a killed writer is refused read-only, then recovered by the next writer",
           [&]
           {
              const auto path = base / "killed";
              {
                 database db(path, config, open_mode::create_new);
                 auto     w   = db.start_write_session();
                 auto     top = w->get_top_root();
                 put(*w, top, "head", "initial");
                 w->set_top_root(top);
              }
              int ready[2];
              require(::pipe(ready) == 0, "pipe");
              const pid_t child = ::fork();
              require(child >= 0, "fork");
              if (child == 0)
              {
                 // Dies holding the published root, older revisions, and unpublished work.
                 database                 db(path, config, open_mode::read_write);
                 auto                     w = db.start_write_session();
                 std::vector<shared_root> held;
                 for (unsigned revision = 0; revision < 20; ++revision)
                 {
                    auto top = w->get_top_root();
                    for (unsigned i = 0; i < 200; ++i)
                       put(*w, top, "key" + std::to_string(i), std::string(256, char('a' + revision)));
                    put(*w, top, "head", "revision-" + std::to_string(revision));
                    w->set_top_root(top);
                    held.push_back(top);
                 }
                 auto unpublished = w->get_top_root();
                 put(*w, unpublished, "head", "never-published");
                 held.push_back(unpublished);
                 (void)!::write(ready[1], "r", 1);
                 for (;;)
                    ::pause();
              }
              ::close(ready[1]);
              char byte = 0;
              require(::read(ready[0], &byte, 1) == 1, "writer child did not publish");
              ::close(ready[0]);
              ::kill(child, SIGKILL);
              int status = 0;
              ::waitpid(child, &status, 0);
              require(WIFSIGNALED(status), "writer child was not killed");

              const auto before  = digest(path);
              bool       refused = false;
              try
              {
                 database db(path, config, open_mode::read_only);
              }
              catch (const std::exception& error)
              {
                 refused = std::string_view(error.what()).find("not shut down cleanly") !=
                           std::string_view::npos;
              }
              require(refused, "read-only open accepted a store its writer never closed");
              require(before == digest(path), "refused read-only open changed file bytes");
              {
                 database db(path, config, open_mode::read_write);
                 auto     w   = db.start_write_session();
                 auto     top = w->get_top_root();
                 require(get(*w, top, "head") == "revision-19", "recovered head is not the last publication");
                 for (unsigned i = 0; i < 200; ++i)
                    require(get(*w, top, "key" + std::to_string(i)) == std::string(256, char('a' + 19)),
                            "recovered state is not the last publication");
                 put(*w, top, "head", "after-recovery");
                 w->set_top_root(top);
              }
              database db(path, config, open_mode::read_only);
              auto     reader = db.start_read_session();
              require(get(*reader, db.start_write_session()->get_top_root(), "head") == "after-recovery",
                      "store was not usable after recovery");
           });
      std::cout << "{\"passed\":true,\"contract_groups\":" << passed << "}\n";
   }
   catch (const std::exception& e)
   {
      std::cerr << "FAILED: " << e.what() << '\n';
      return 1;
   }
}
