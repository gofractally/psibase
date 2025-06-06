#include <triedent/object_db.hpp>

#include <bit>
#include <cstdint>
#include <random>

#include <catch2/catch_all.hpp>

using namespace triedent;

TEST_CASE("object_info")
{
   REQUIRE(sizeof(object_info) == sizeof(std::uint64_t));
   std::uniform_int_distribution<std::uint64_t> dist;
   std::default_random_engine                   rng;
   for (int i = 0; i < 100; ++i)
   {
      auto val = dist(rng);
      CHECK(object_info{val}.to_int() == val);
      CHECK(std::bit_cast<std::uint64_t>(object_info{val}) == val);
   }
}
