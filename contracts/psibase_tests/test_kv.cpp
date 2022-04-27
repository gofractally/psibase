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

   auto get_key(account_num this_contract) const
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

void test(account_num this_contract)
{
   if (enable_print)
      print("kv_put\n");
   for (const auto& item : items)
      if (item.add)
         kv_put_raw(kv_map::contract, item.get_key(this_contract),
                    psio::convert_to_bin(item.value));

   if (enable_print)
      print("kv_remove\n");
   for (const auto& item : items)
      if (!item.keep)
         kv_remove_raw(kv_map::contract, item.get_key(this_contract));

   auto run = [&](auto match_key_size, auto expected, const auto& key, auto f)
   {
      if (expected == skip)
      {
         if (enable_print)
            print("skip ");
         return;
      }
      auto result = f(kv_map::contract, key, match_key_size + 4);
      if (!result && !expected)
      {
         check(get_key().empty(), "get_key() not empty");
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
         abort_message_str("mismatched result");
      }
      bool found = false;
      for (auto& item : items)
      {
         if (item.value != *expected)
            continue;
         check(item.get_key(this_contract) == get_key(), "get_key() does not match");
         found = true;
      }
      check(found, "matching value missing in items");
      if (enable_print)
         print("ok   ");
   };

   if (enable_print)
      print("kv_less_than\n");
   for (const auto& item : items)
   {
      auto key = item.get_key(this_contract);
      if (enable_print)
      {
         printf("    0x%02x ", item.value);
         fflush(stdout);
      }
      run(4, item.lt4, key, kv_less_than_raw);
      run(5, item.lt5, key, kv_less_than_raw);
      run(6, item.lt6, key, kv_less_than_raw);
      if (enable_print)
         print("\n");
   }  // kv_less_than

   if (enable_print)
      print("kv_greater_equal\n");
   for (const auto& item : items)
   {
      auto key = item.get_key(this_contract);
      if (enable_print)
      {
         printf("    0x%02x ", item.value);
         fflush(stdout);
      }
      run(4, item.ge4, key, kv_greater_equal_raw);
      run(5, item.ge5, key, kv_greater_equal_raw);
      run(6, item.ge6, key, kv_greater_equal_raw);
      if (enable_print)
         print("\n");
   }  // kv_greater_equal

   if (enable_print)
      print("kv_max\n");
   for (const auto& item : items)
   {
      auto key = item.get_key(this_contract);
      if (enable_print)
      {
         printf("    0x%02x ", item.value);
         fflush(stdout);
      }
      run(0, item.max, key,
          [](kv_map map, psio::input_stream key, size_t) { return kv_max_raw(map, key); });
      if (enable_print)
         print("\n");
   }  // kv_max

}  // test()

extern "C" void called(account_num this_contract, account_num sender)
{
   test(this_contract);
}

extern "C" void __wasm_call_ctors();
extern "C" void start(account_num this_contract)
{
   __wasm_call_ctors();
}
