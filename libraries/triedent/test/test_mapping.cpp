#include <triedent/mapping.hpp>

#include <random>

#include "temp_directory.hpp"

#include <catch2/catch.hpp>

using namespace triedent;

TEST_CASE("mapping access")
{
   temp_directory dir("triedent-test");
   mapping        m{dir.path, read_write};
   m.resize(4096);
   auto p1 = (char*)m.data();
   *p1     = 42;
   auto x  = m.resize(8192);
   // p1 is still valid as long as x exists
   CHECK(*p1 == 42);
   auto p2 = (char*)m.data();
   CHECK(*p2 == 42);
   x.reset();
   CHECK(*p2 == 42);
   p2[8191] = 5;
}

TEST_CASE("extend mapping aligned")
{
   temp_directory dir("triedent-test");
   mapping        m{dir.path, read_write};

   for (std::size_t i = 1; i < 10; ++i)
   {
      m.resize(4096 * i);
      // verify that contents are unchanged and fill new region
      CHECK(m.size() == 4096 * i);
      std::mt19937   rng;
      std::uint32_t* data = reinterpret_cast<std::uint32_t*>(m.data());
      for (std::size_t j = 0; j < (i - 1) * 1024; ++j)
      {
         CHECK(data[j] == rng());
      }
      for (std::size_t j = (i - 1) * 1024; j < i * 1024; ++j)
      {
         CHECK(data[j] == 0);
         data[j] = rng();
      }
   }
}

TEST_CASE("extend mapping unaligned")
{
   temp_directory dir("triedent-test");
   mapping        m{dir.path, read_write};

   std::size_t prev = 0;
   for (std::size_t i :
        {2,   3,    5,    7,    13,   17,   19,   31,   61,   89,    107,   127,  521,
         607, 1279, 2203, 2281, 3217, 4253, 4423, 9689, 9941, 11213, 19937, 21701})
   {
      m.resize(i);
      // verify that contents are unchanged and fill new region
      CHECK(m.size() == i);
      std::mt19937  rng;
      std::uint8_t* data = reinterpret_cast<std::uint8_t*>(m.data());
      for (std::size_t j = 0; j < prev; ++j)
      {
         CHECK(data[j] == static_cast<std::uint8_t>(rng()));
      }
      for (std::size_t j = prev; j < i; ++j)
      {
         CHECK(data[j] == 0);
         data[j] = static_cast<std::uint8_t>(rng());
      }
      prev = i;
   }
}
