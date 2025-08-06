#include <services/test/TestTable.hpp>

#include <psibase/dispatch.hpp>

using namespace psibase;

namespace TestService
{
   using S0 = SingleKeyRow;
   using S1 = MultiKeyRow;
   using S2 = CompoundKeyRow;

   struct IntKey
   {
      int key;
   };
   PSIO_REFLECT(IntKey, key)

   void TestTable::getSingle()
   {
      auto t0   = open<SingleKeyTable>();
      auto idx0 = t0.getIndex<0>();
      t0.put(S0{0, 1});
      check(idx0.get(0) == S0{0, 1}, "get after create");
      t0.put(S0{0, 2});
      check(idx0.get(0) == S0{0, 2}, "get after modify");
      t0.put(S0{1, 3});
      check(idx0.get(0) == S0{0, 2} && idx0.get(1) == S0{1, 3}, "get after different key");
   }

   void TestTable::getMulti()
   {
      auto t1   = open<MultiKeyTable>();
      auto idx0 = t1.getIndex<0>();
      auto idx1 = t1.getIndex<1>();
      t1.put(S1{0, 1, 2});
      check(idx0.get(0) == S1{0, 1, 2}, "get0");
      check(idx1.get(1) == S1{0, 1, 2}, "get1");
      t1.put(S1{0, 2, 3});
      check(idx0.get(0) == S1{0, 2, 3}, "get0 updated");
      check(idx1.get(2) == S1{0, 2, 3}, "get1 new");
      check(idx1.get(1) == std::nullopt, "get1 removed");
   }

   void TestTable::getCompound()
   {
      auto t2   = open<CompoundKeyTable>();
      auto idx1 = t2.getIndex<1>();
      t2.put(S2{0, 1, 2});
      t2.put(S2{3, 1, 4});
      t2.put(S2{5, 6, 7});
      std::vector<S2> result;
      printf("starting test2\n");
      for (auto x : idx1.subindex(1))
      {
         result.push_back(x);
      }
      check(result.size() == 2, "iter sz");
      check(result[0] == S2{0, 1, 2}, "iter val0");
      check(result[1] == S2{3, 1, 4}, "iter val1");
   }

   void TestTable::removeSingle()
   {
      auto t0   = open<SingleKeyTable>();
      auto idx0 = t0.getIndex<0>();
      t0.put(S0{0, 1});
      t0.put(S0{2, 3});
      t0.erase(0);
      check(!idx0.get(0).has_value(), "erase without secondary");
      t0.remove(S0{2, 3});
      check(!idx0.get(2).has_value(), "remove without secondary");
   }

   void TestTable::removeMulti()
   {
      auto t1   = open<MultiKeyTable>();
      auto idx0 = t1.getIndex<0>();
      auto idx1 = t1.getIndex<1>();
      t1.put(S1{0, 1, 2});
      t1.put(S1{3, 4, 5});
      t1.erase(0);
      check(!idx0.get(0).has_value(), "erase primary");
      check(!idx1.get(1).has_value(), "erase secondary");
      t1.remove(S1{3, 4, 5});
      check(!idx0.get(3).has_value(), "remove primary");
      check(!idx1.get(4).has_value(), "remove secondary");
   }

   void TestTable::subindex()
   {
      auto t2   = open<CompoundKeyTable>();
      auto idx1 = t2.getIndex<1>();
      t2.put(S2{0, 1, 2});
      t2.put(S2{3, 1, 4});
      t2.put(S2{5, 6, 7});
      std::vector<S2> result;
      printf("starting test5\n");
      static_assert(std::same_as<decltype(idx1.subindex<int>(1)), TableIndex<S2, int>>);
      static_assert(std::same_as<decltype(idx1.subindex<std::tuple<int>>(1)),
                                 TableIndex<S2, std::tuple<int>>>);
      static_assert(std::same_as<decltype(idx1.subindex<IntKey>(1)), TableIndex<S2, IntKey>>);
      for (auto x : idx1.subindex<int>(1))
      {
         result.push_back(x);
      }
      check(result.size() == 2, "iter sz");
      check(result[0] == S2{0, 1, 2}, "iter val0");
      check(result[1] == S2{3, 1, 4}, "iter val1");
   }

}  // namespace TestService

PSIBASE_DISPATCH(TestService::TestTable)
