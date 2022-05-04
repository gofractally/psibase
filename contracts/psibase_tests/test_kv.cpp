#include <psibase/intrinsic.hpp>
#include <psibase/print.hpp>
#include <psio/from_bin.hpp>
#include <psio/to_bin.hpp>
#include <psio/to_key.hpp>

using namespace psibase;

static constexpr bool enable_print = false;

struct item
{
   std::vector<unsigned char> key;
   uint8_t                    value;
   bool                       add;
   bool                       keep;

   std::optional<uint8_t> lt4;
   std::optional<uint8_t> lt5;
   std::optional<uint8_t> lt6;

   std::optional<uint8_t> ge4;
   std::optional<uint8_t> ge5;
   std::optional<uint8_t> ge6;

   std::optional<uint8_t> max;

   auto getKey(AccountNumber this_contract) const
   {
      auto k = psio::convert_to_key(this_contract);
      k.insert(k.end(), key.begin(), key.end());
      return k;
   }
};

auto    none = std::nullopt;
uint8_t skip = 0xff;  // TODO: verify abort

// clang-format off
std::vector<item> items = {
   //                         add    keep       lt4   lt5   lt6      ge4   ge5   ge6      max
   {{},                 0x00, false, false,     none, skip, skip,    0x10, skip, skip,    0x19},
   {{0x10},             0x10, true,  true,      none, none, skip,    0x10, 0x10, skip,    0x15},
   {{0x10, 0x00},       0x11, true,  true,      0x10, 0x10, none,    0x11, 0x11, 0x11,    0x11},
   {{0x10, 0x01},       0x12, true,  true,      0x11, 0x11, none,    0x12, 0x12, 0x12,    0x12},
   {{0x10, 0x10},       0x13, true,  false,     0x12, 0x12, none,    0x14, 0x14, 0x14,    0x15},
   {{0x10, 0x10, 0x00}, 0x14, true,  true,      0x12, 0x12, none,    0x14, 0x14, 0x14,    0x14},
   {{0x10, 0x10, 0x01}, 0x15, true,  true,      0x14, 0x14, 0x14,    0x15, 0x15, 0x15,    0x15},
   {{0x11, 0x10, 0x02}, 0x16, true,  false,     0x15, none, none,    0x17, 0x17, none,    none},
   {{0x11, 0x11},       0x17, true,  true,      0x15, none, none,    0x17, 0x17, 0x17,    0x17},
   {{0x12, 0x10, 0x02}, 0x18, false, false,     0x17, none, none,    0x19, none, none,    none},
   {{0x13, 0x11},       0x19, true,  true,      0x17, none, none,    0x19, 0x19, 0x19,    0x19},
   {{0x20},             0x20, false, false,     0x19, none, skip,    none, none, skip,    none},
};
// clang-format on

void test(AccountNumber this_contract)
{
   if (enable_print)
      print("kvPut\n");
   for (const auto& item : items)
      if (item.add)
         kvPutRaw(kv_map::contract, item.getKey(this_contract), psio::convert_to_bin(item.value));

   if (enable_print)
      print("kvRemove\n");
   for (const auto& item : items)
      if (!item.keep)
         kvRemoveRaw(kv_map::contract, item.getKey(this_contract));

   auto run = [&](auto matchKeySize, auto expected, const auto& key, auto f)
   {
      if (expected == skip)
      {
         if (enable_print)
            print("skip ");
         return;
      }
      auto result = f(kv_map::contract, key, matchKeySize + 4);
      if (!result && !expected)
      {
         check(getKey().empty(), "getKey() not empty");
         if (enable_print)
            print("ok   ");
         return;
      }
      check(!!result, "missing result");
      check(!!expected, "result exists");
      auto val = psio::convert_from_bin<uint8_t>(*result);
      if (val != *expected)
      {
         if (enable_print)
            printf("0x%02x\n", val);
         abortMessage("mismatched result");
      }
      bool found = false;
      for (auto& item : items)
      {
         if (item.value != *expected)
            continue;
         check(item.getKey(this_contract) == getKey(), "getKey() does not match");
         found = true;
      }
      check(found, "matching value missing in items");
      if (enable_print)
         print("ok   ");
   };

   if (enable_print)
      print("kvLessThan\n");
   for (const auto& item : items)
   {
      auto key = item.getKey(this_contract);
      if (enable_print)
      {
         printf("    0x%02x ", item.value);
         fflush(stdout);
      }
      run(4, item.lt4, key, kvLessThanRaw);
      run(5, item.lt5, key, kvLessThanRaw);
      run(6, item.lt6, key, kvLessThanRaw);
      if (enable_print)
         print("\n");
   }  // kvLessThan

   if (enable_print)
      print("kvGreaterEqual\n");
   for (const auto& item : items)
   {
      auto key = item.getKey(this_contract);
      if (enable_print)
      {
         printf("    0x%02x ", item.value);
         fflush(stdout);
      }
      run(4, item.ge4, key, kvGreaterEqualRaw);
      run(5, item.ge5, key, kvGreaterEqualRaw);
      run(6, item.ge6, key, kvGreaterEqualRaw);
      if (enable_print)
         print("\n");
   }  // kvGreaterEqual

   if (enable_print)
      print("kvMax\n");
   for (const auto& item : items)
   {
      auto key = item.getKey(this_contract);
      if (enable_print)
      {
         printf("    0x%02x ", item.value);
         fflush(stdout);
      }
      run(0, item.max, key,
          [](kv_map map, psio::input_stream key, size_t) { return kvMaxRaw(map, key); });
      if (enable_print)
         print("\n");
   }  // kvMax

}  // test()

extern "C" void called(AccountNumber this_contract, AccountNumber sender)
{
   test(this_contract);
}

extern "C" void __wasm_call_ctors();
extern "C" void start(AccountNumber this_contract)
{
   __wasm_call_ctors();
}
