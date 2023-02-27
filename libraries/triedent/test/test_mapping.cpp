#include <triedent/mapping.hpp>

#include "temp_directory.hpp"

#include <catch2/catch.hpp>

using namespace triedent;

TEST_CASE("test_mapping")
{
   temp_directory dir("triedent-test");
   mapping        m{dir.path, read_write};
   m.resize(4096);
   auto p1 = (char*)m.data();
   *p1     = 42;
   m.resize(8192);
   CHECK(*p1 == 42);
   auto p2 = (char*)m.data();
   CHECK(*p2 == 42);
   m.gc();
   CHECK(*p2 == 42);
   p2[8191] = 5;
}
