#include <random>
#include <triedent/database.hpp>

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

auto createDb()
{
   std::filesystem::remove_all("testdb");
   database::create("testdb", database::config{
                                  .max_objects = 10000ull,
                                  .hot_pages   = 30,
                                  .warm_pages  = 30,
                                  .cool_pages  = 30,
                                  .cold_pages  = 30,
                              });
   return std::make_shared<database>(  //
       "testdb", database::read_write);
}

TEST_CASE("key round trip")
{
   static std::mt19937  gen(0);
   std::vector<uint8_t> data;
   data.resize(4096);
   for (auto& b : data)
      b = gen();

   session_base sb;
   for (uint32_t i = 0; i < 10000; ++i)
   {
      auto offset = gen() % 2096;
      auto size   = gen() % 255;
      auto in_key = std::string_view((char*)data.data() + offset, size);
      auto k6     = sb.to_key6(in_key);
      auto k8     = from_key6(k6);
      REQUIRE(k8 == in_key);
   }
}

TEST_CASE("accidental inner removal")
{
   // regression check: a missing compare caused a non-matching key to be removed
   auto db      = createDb();
   auto session = db->start_write_session();
   session->upsert({"\x00\x01\x02", 3}, {"value 1"});
   session->upsert({"\x00\x01\x03", 3}, {"value 2"});
   REQUIRE(session->get({"\x00\x01\x02", 3}) == std::optional{std::string_view{"value 1"}});
   REQUIRE(session->get({"\x00\x01\x03", 3}) == std::optional{std::string_view{"value 2"}});
   session->remove({"\x00\x00\x02", 3});
   REQUIRE(session->get({"\x00\x01\x02", 3}) == std::optional{std::string_view{"value 1"}});
   REQUIRE(session->get({"\x00\x01\x03", 3}) == std::optional{std::string_view{"value 2"}});
}
