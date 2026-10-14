#include <triedent/cow_ptr.hpp>

#include <random>
#include <thread>
#include <vector>

#include <catch2/catch_test_macros.hpp>

using namespace triedent;

namespace
{
   struct Counted : cow_base
   {
      static std::atomic<int> total;
      Counted() { ++total; }
      ~Counted() { --total; }
   };
   std::atomic<int> Counted::total{0};
}  // namespace

TEST_CASE("Test cow_ptr")
{
   REQUIRE(Counted::total.load() == 0);

   {
      SECTION("copy constructor")
      {
         cow_ptr<Counted> p(new Counted);
         cow_ptr<Counted> p2(p);
      }
      SECTION("move constructor")
      {
         cow_ptr<Counted> p(new Counted);
         cow_ptr<Counted> p2(std::move(p));
      }
      SECTION("copy constructor null")
      {
         cow_ptr<Counted> p;
         cow_ptr<Counted> p2(p);
      }
      SECTION("move constructor null")
      {
         cow_ptr<Counted> p;
         cow_ptr<Counted> p2(std::move(p));
      }
      SECTION("copy assignment null/null")
      {
         cow_ptr<Counted> p1(nullptr);
         cow_ptr<Counted> p2(nullptr);
         p2 = p1;
      }
      SECTION("copy assignment null/p")
      {
         cow_ptr<Counted> p1(nullptr);
         cow_ptr<Counted> p2(new Counted);
         p2 = p1;
      }
      SECTION("copy assignment p/null")
      {
         cow_ptr<Counted> p1(new Counted);
         cow_ptr<Counted> p2(nullptr);
         p2 = p1;
      }
      SECTION("copy assignment p/p")
      {
         cow_ptr<Counted> p1(new Counted);
         cow_ptr<Counted> p2(new Counted);
         p2 = p1;
      }
      SECTION("move assignment null/null")
      {
         cow_ptr<Counted> p1(nullptr);
         cow_ptr<Counted> p2(nullptr);
         p2 = std::move(p1);
      }
      SECTION("move assignment null/p")
      {
         cow_ptr<Counted> p1(nullptr);
         cow_ptr<Counted> p2(new Counted);
         p2 = std::move(p1);
      }
      SECTION("move assignment p/null")
      {
         cow_ptr<Counted> p1(new Counted);
         cow_ptr<Counted> p2(nullptr);
         p2 = std::move(p1);
      }
      SECTION("move assignment p/p")
      {
         cow_ptr<Counted> p1(new Counted);
         cow_ptr<Counted> p2(new Counted);
         p2 = std::move(p1);
      }
      SECTION("release null")
      {
         cow_ptr<Counted> p1;
         p1.release();
      }
      SECTION("release")
      {
         cow_ptr<Counted> p1(new Counted);
         CHECK(p1.release() != nullptr);
      }
      SECTION("release 2")
      {
         cow_ptr<Counted> p1(new Counted);
         cow_ptr<Counted> p2(p1);
         CHECK(p1.release() == nullptr);
         CHECK(p2.release() != nullptr);
      }
      SECTION("unique null")
      {
         cow_ptr<Counted> p1;
         CHECK(p1.unique() == false);
      }
      SECTION("unique null")
      {
         cow_ptr<Counted> p1(new Counted);
         CHECK(p1.unique() == true);
      }
      SECTION("unique 2")
      {
         cow_ptr<Counted> p1(new Counted);
         cow_ptr<Counted> p2(p1);
         CHECK(p1.unique() == false);
         CHECK(p2.unique() == false);
      }
   }

   CHECK(Counted::total.load() == 0);
}
