#include <unistd.h>
#include <algorithm>
#include <array>
#include <atomic>
#include <cstring>
#include <fstream>
#include <functional>
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
      test("optimistic range comparison and splice",
           [&]
           {
              database    db(base / "occ", config, open_mode::create_new);
              auto        w = db.start_write_session();
              shared_root original;
              put(*w, original, "a", "1");
              put(*w, original, "z", "1");
              auto current = original, updated = original;
              put(*w, current, "z", "2");
              put(*w, updated, "a", "2");
              require(w->is_equal_weak(original, current, span("a"), span("b")),
                      "unrelated write conflicts");
              require(!w->is_equal_weak(original, current, span("z"), {}), "overlap not detected");
              w->splice(current, updated, span("a"), span("b"));
              require(get(*w, current, "a") == "2" && get(*w, current, "z") == "2",
                      "splice overwrote unrelated keys");
              require(get(*w, original, "a") == "1", "splice changed owned base");
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
      std::cout << "{\"passed\":true,\"contract_groups\":" << passed << "}\n";
   }
   catch (const std::exception& e)
   {
      std::cerr << "FAILED: " << e.what() << '\n';
      return 1;
   }
}
