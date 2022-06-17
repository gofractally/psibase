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
   return std::make_unique<database>(  //
       "testdb",
       database::config{
           .max_objects = 10000ull,
           .hot_pages   = 30,
           .warm_pages  = 30,
           .cool_pages  = 30,
           .cold_pages  = 30,
       },
       database::read_write);
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

TEST_CASE("key conversions")
{
   // regression check: accidental sign extension
   REQUIRE(database::session_base{}.to_key6(from_key6({"\x00\x80", 2})) ==
           std::string_view{"\x00\x80", 2});
}
