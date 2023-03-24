#include <triedent/database.hpp>

#include "temp_directory.hpp"

#include <random>

template <typename S, typename T>
S& operator<<(S& stream, const std::optional<T>& obj)
{
   if (obj)
      return stream << *obj;
   else
      return stream << "<nullopt>";
}

#define CATCH_CONFIG_MAIN
#include <catch2/catch.hpp>

using namespace triedent;
using namespace std::literals::string_literals;

std::optional<std::string_view> osv(const std::optional<std::vector<char>>& v)
{
   if (v)
      return {{v->data(), v->size()}};
   else
      return std::nullopt;
}

std::optional<std::string_view> osv(std::string_view s)
{
   return std::optional{s};
}

auto createDb(const database::config& cfg = database::config{
                  .hot_bytes  = 1ull << 30,
                  .warm_bytes = 1ull << 30,
                  .cool_bytes = 1ull << 30,
                  .cold_bytes = 1ull << 30,
              })
{
   temp_directory dir("triedent-test");
   database::create(dir.path, cfg);
   return std::make_shared<database>(dir.path, cfg, access_mode::read_write);
}

bool next_key(std::string& buf, std::size_t max_len)
{
   if (buf.size() == max_len)
   {
      while (!buf.empty())
      {
         if (static_cast<unsigned char>(buf.back()) == 0xFF)
         {
            buf.pop_back();
         }
         else
         {
            ++buf.back();
            return true;
         }
      }
      return false;
   }
   else
   {
      buf.push_back(0);
      return true;
   }
}

TEST_CASE("key round trip")
{
   std::string buf;
   std::string key;
   do
   {
      auto k6 = to_key6(buf, key);
      auto k8 = from_key6(k6);
      REQUIRE(k8 == key);
   } while (next_key(key, 3));
}

TEST_CASE("key order")
{
   std::string buf;
   std::string key;
   std::string prev;
   std::string prev_k6;
   while (next_key(key, 3))
   {
      auto k6 = to_key6(buf, key);
      REQUIRE(prev < key);
      REQUIRE(prev_k6 < k6);
      prev    = key;
      prev_k6 = k6;
   }
}

TEST_CASE("insert")
{
   static std::vector<std::vector<std::string_view>> key_groups =  //
       {{"abc", "abcd"},
        {"abcd", "abc"},
        {"abcde", "abcfg"},
        {"abcde", "abcfgh"},
        {"abcdef", "abcgh"},
        // inner node combinations
        {"abc\x20", "abc\x30", "abc"},
        {"abcdefg", "abcdefh", "abc"},
        {"abcdefg", "abcdefh", "abcijk"},
        {"abcdef", "abcghi", "abcghj"}};
   //
   auto allow_unique = GENERATE(false, true);
   auto keys         = GENERATE(from_range(key_groups));
   auto db           = createDb();
   auto session      = db->start_write_session();
   auto root         = session->get_top_root();
   int  i            = 0;
   for (auto key : keys)
   {
      session->upsert(root, key, std::to_string(i++));
      if (!allow_unique)
      {
         session->set_top_root(root);
      }
   }
   i = 0;
   for (auto key : keys)
   {
      CHECK(osv(session->get(root, key)) == osv(std::to_string(i++)));
   }
}

TEST_CASE("erase")
{
   static std::vector<std::pair<std::vector<std::string_view>, std::string_view>> key_groups = {
       {{"abc"}, "abc"},
       {{"abcd", "abce"}, "abcd"},
       {{"abc", "abcd"}, "abc"},
       {{"abc", "abcd"}, "abcd"},
       {{"abc", "abcd", "abce"}, "abc"},
       {{"abc", "abcd", "abce"}, "abcd"},
       {{"abcd", "abce", "abcf"}, "abcd"},
       // not present
       {{"abc"}, ""},
       {{"abcd", "abce"}, "abc"},
       {{"\0\1\2", "\0\1\3"}, "\0\0\2"},
   };
   auto allow_unique = GENERATE(false, true);
   auto [keys, keyx] = GENERATE(from_range(key_groups));
   auto db           = createDb();
   auto session      = db->start_write_session();
   auto root         = session->get_top_root();
   int  i            = 0;
   for (auto key : keys)
   {
      session->upsert(root, key, std::to_string(i++));
   }
   if (!allow_unique)
   {
      session->set_top_root(root);
   }
   session->remove(root, keyx);
   i = 0;
   for (auto key : keys)
   {
      if (key == keyx)
         CHECK(!session->get(root, key));
      else
         CHECK(osv(session->get(root, key)) == osv(std::to_string(i)));
      ++i;
   }
}

TEST_CASE("recover")
{
   temp_directory dir("triedent-test");
   database::create(dir.path, database::config{1ull << 27, 1ull << 27, 1ull << 27, 1ull << 27});
   {
      auto db = std::make_shared<database>(dir.path, access_mode::read_write);
      std::shared_ptr<triedent::root> root;
      auto                            session = db->start_write_session();
      session->upsert(root, "abc"s, "v0"s);
      session->upsert(root, "abcd"s, "v1"s);
      session->upsert(root, "abce"s, "v2"s);
      std::shared_ptr<triedent::root> top_root;
      session->upsert(top_root, ""s, std::span{&root, 1});
      session->set_top_root(top_root);
   }
   {
      auto db      = std::make_shared<database>(dir.path, access_mode::read_write, true);
      auto session = db->start_write_session();
      session->start_collect_garbage();
   }
   // An interrupted gc may leave reference counts too low.
   // Access MUST be forbidden until gc is finished to prevent
   // corruption.
   CHECK_THROWS(std::make_shared<database>(dir.path, access_mode::read_write));
   {
      auto db      = std::make_shared<database>(dir.path, access_mode::read_write, true);
      auto session = db->start_write_session();
      session->start_collect_garbage();
      session->recursive_retain();
      session->end_collect_garbage();
   }
   {
      auto db      = std::make_shared<database>(dir.path, access_mode::read_write);
      auto session = db->start_write_session();
      auto root    = session->get_top_root();
      std::vector<std::shared_ptr<triedent::root>> roots;
      REQUIRE(session->get(root, ""s, nullptr, &roots));
      REQUIRE(roots.size() == 1);
      root = roots.front();
      CHECK(osv(session->get(root, "abc"s)) == osv("v0"));
      CHECK(osv(session->get(root, "abcd"s)) == osv("v1"));
      CHECK(osv(session->get(root, "abce"s)) == osv("v2"));
      // clear all objects: This should trigger an assert
      // if any reference counts were too low.
      roots.clear();
      root.reset();
      session->set_top_root(nullptr);
   }
}

TEST_CASE("many refs")
{
   // This should be larger than the maximum node refcount
   constexpr int count   = 32768 + 1;
   auto          db      = createDb(database::config{
                     .hot_bytes  = 1ull << 27,
                     .warm_bytes = 1ull << 27,
                     .cool_bytes = 1ull << 27,
                     .cold_bytes = 1ull << 27,
   });
   auto          session = db->start_write_session();
   auto          root    = session->get_top_root();
   auto          child   = root;
   session->upsert(child, {"k", 1}, {"v", 1});
   for (int i = 0; i < count; ++i)
   {
      char key[sizeof(i)];
      std::memcpy(&key, &i, sizeof(i));
      session->upsert(root, {key, sizeof(key)}, {&child, 1});
   }
   session->set_top_root(root);
   for (int i = 0; i < count; ++i)
   {
      char key[sizeof(i)];
      std::memcpy(&key, &i, sizeof(i));
      std::vector<std::shared_ptr<triedent::root>> r;
      session->get(root, {key, sizeof(key)}, nullptr, &r);
      REQUIRE(r.size() == 1);
      REQUIRE(osv(session->get(r.front(), {"k", 1})) == std::optional{std::string_view{"v", 1}});
   }
}
