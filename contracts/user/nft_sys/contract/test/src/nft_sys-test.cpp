#define CATCH_CONFIG_MAIN
#include <test/include/contracts/system/test.hpp>

#include "nft_sys.hpp"

using namespace eosio;
using namespace psibase;

namespace
{
   template <typename T>
   auto get_return_val(auto trace)
   {
      const action_trace& at      = get_top_action(trace, 0);
      auto                ret_val = eosio::convert_from_bin<T>(at.raw_retval);
      return ret_val;
   }
}  // namespace

TEST_CASE("Mint nft")
{
   test_chain t;
   t.start_block();
   boot_minimal(t);
   auto cnum = add_contract(t, "nft.sys", "nft_sys.wasm");
   check(nft_sys::contract == cnum, "nft contract num changed from " +
                                        std::to_string(nft_sys::contract) + " to " +
                                        std::to_string(cnum));
   auto alice = add_account(t, "alice");

   transaction_trace trace = t.push_transaction(  //
       t.make_transaction(                        //
           {{
               .sender   = alice,
               .contract = nft_sys::contract,
               .raw_data = eosio::convert_to_bin(
                   nft_sys::action{nft_sys::mint{.issuer = alice, .sub_id = 1}}),
           }}));
   REQUIRE(show(false, trace) == "");
   auto ret = get_return_val<uint64_t>(trace);
   printf("Return value is %" PRId64 "\n", ret);

}  // transfer