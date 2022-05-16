#include <psibase/Table.hpp>
#include <variant>

using namespace psibase;

namespace table_test
{
   struct S0
   {
      int                         key;
      int                         value;
      friend std::strong_ordering operator<=>(const S0&, const S0&) = default;
   };
   PSIO_REFLECT(S0, key, value)
   using table0 = Table<S0, &S0::key>;

   struct S1
   {
      int                         key1;
      int                         key2;
      int                         value;
      friend std::strong_ordering operator<=>(const S1&, const S1&) = default;
   };
   PSIO_REFLECT(S1, key1, key2, value);
   using table1 = Table<S1, &S1::key1, &S1::key2>;

   struct S2
   {
      int                         key1;
      int                         key2;
      int                         value;
      auto                        compound_key() const { return std::tie(key2, key1); }
      friend std::strong_ordering operator<=>(const S2&, const S2&) = default;
   };
   PSIO_REFLECT(S2, key1, key2, value, method(compound_key));
   using table2 = Table<S2, &S2::key1, &S2::compound_key>;

   using test_tables = ContractTables<table0, table1, table2>;

   void test0(AccountNumber this_contract)
   {
      test_tables t{this_contract};
      auto        t0   = t.open<table0>();
      auto        idx0 = t0.getIndex<0>();
      t0.put(S0{0, 1});
      check(idx0.get(0) == S0{0, 1}, "get after create");
      t0.put(S0{0, 2});
      check(idx0.get(0) == S0{0, 2}, "get after modify");
      t0.put(S0{1, 3});
      check(idx0.get(0) == S0{0, 2} && idx0.get(1) == S0{1, 3}, "get after different key");
   }

   void test1(AccountNumber this_contract)
   {
      test_tables t{this_contract};
      auto        t1   = t.open<table1>();
      auto        idx0 = t1.getIndex<0>();
      auto        idx1 = t1.getIndex<1>();
      t1.put(S1{0, 1, 2});
      check(idx0.get(0) == S1{0, 1, 2}, "get0");
      check(idx1.get(1) == S1{0, 1, 2}, "get1");
      t1.put(S1{0, 2, 3});
      check(idx0.get(0) == S1{0, 2, 3}, "get0 updated");
      check(idx1.get(2) == S1{0, 2, 3}, "get1 new");
      check(idx1.get(1) == std::nullopt, "get1 removed");
   }

   void test2(AccountNumber this_contract)
   {
      test_tables t{this_contract};
      auto        t2   = t.open<table2>();
      auto        idx1 = t2.getIndex<1>();
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

   void test3(AccountNumber this_contract)
   {
      test_tables t{this_contract};
      auto        t0   = t.open<table0>();
      auto        idx0 = t0.getIndex<0>();
      t0.put(S0{0, 1});
      t0.put(S0{2, 3});
      t0.erase(0);
      check(!idx0.get(0).has_value(), "erase without secondary");
      t0.remove(S0{2, 3});
      check(!idx0.get(2).has_value(), "remove without secondary");
   }

   void test4(AccountNumber this_contract)
   {
      test_tables t{this_contract};
      auto        t1   = t.open<table1>();
      auto        idx0 = t1.getIndex<0>();
      auto        idx1 = t1.getIndex<1>();
      t1.put(S1{0, 1, 2});
      t1.put(S1{3, 4, 5});
      t1.erase(0);
      check(!idx0.get(0).has_value(), "erase primary");
      check(!idx1.get(1).has_value(), "erase secondary");
      t1.remove(S1{3, 4, 5});
      check(!idx0.get(3).has_value(), "remove primary");
      check(!idx1.get(4).has_value(), "remove secondary");
   }

   extern "C" void called(AccountNumber this_contract, AccountNumber sender)
   {
      test0(this_contract);
      test1(this_contract);
      test2(this_contract);
      test3(this_contract);
      test4(this_contract);
   }

   extern "C" void __wasm_call_ctors();
   extern "C" void start(AccountNumber this_contract) { __wasm_call_ctors(); }
}  // namespace table_test
