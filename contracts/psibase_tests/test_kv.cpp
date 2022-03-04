#include <psibase/intrinsic.hpp>

#include <eosio/asset.hpp>
#include <eosio/from_bin.hpp>
#include <eosio/to_bin.hpp>

using namespace psibase;

struct item
{
   std::vector<unsigned char> key;
   uint8_t                    value;
   bool                       add;
   bool                       keep;

   std::optional<uint8_t> lt4;
   std::optional<uint8_t> lt5;
   std::optional<uint8_t> lt6;

   auto get_key(account_num this_contract) const
   {
      auto k = eosio::convert_to_key(this_contract);
      k.insert(k.end(), key.begin(), key.end());
      return k;
   }
};

auto none = std::nullopt;

// clang-format off
std::vector<item> items = {
   //                         add    keep       lt4   lt5   lt6
   {{},                 0x00, false, false,     none, none, none, },
   {{0x10},             0x10, true,  true,      none, none, none, },
   {{0x10, 0x00},       0x11, true,  true,      0x10, 0x10, none, },
   {{0x10, 0x01},       0x12, true,  true,      0x11, 0x11, none, },
   {{0x10, 0x10},       0x13, true,  false,     0x12, 0x12, none, },
   {{0x10, 0x10, 0x00}, 0x14, true,  true,      0x12, 0x12, none, },
   {{0x10, 0x10, 0x01}, 0x15, true,  true,      0x14, 0x14, 0x14, },
   {{0x20},             0x20, false, false,     0x15, none, none, },
};
// clang-format on

void test(account_num this_contract)
{
   eosio::print("kv_put\n");
   for (const auto& item : items)
      if (item.add)
         kv_put_raw(kv_map::contract, item.get_key(this_contract),
                    eosio::convert_to_bin(item.value));

   eosio::print("kv_remove\n");
   for (const auto& item : items)
      if (!item.keep)
         kv_remove_raw(kv_map::contract, item.get_key(this_contract));

   eosio::print("kv_less_than\n");
   for (const auto& item : items)
   {
      auto key = item.get_key(this_contract);
      auto f   = [&](auto match_key_size, auto expected) {
         if (match_key_size > key.size())
         {
            eosio::print("skip ");
            return;
         }
         auto result = kv_less_than_raw(kv_map::contract, key, match_key_size);
         if (!result && !expected)
         {
            eosio::print("ok   ");
            return;
         }
         eosio::check(!!result, "missing result");
         eosio::check(!!expected, "result exists");
         auto val = eosio::convert_from_bin<uint8_t>(*result);
         eosio::check(val == *expected, "mismatched result");
         eosio::print("ok   ");
      };
      printf("    0x%02x ", item.value);
      fflush(stdout);
      f(4, item.lt4);
      f(5, item.lt5);
      f(6, item.lt6);
      eosio::print("\n");
   }
}

extern "C" void called(account_num this_contract, account_num sender)
{
   test(this_contract);
}

extern "C" void __wasm_call_ctors();
extern "C" void start(account_num this_contract)
{
   __wasm_call_ctors();
}
