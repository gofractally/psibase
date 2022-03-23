#define CATCH_CONFIG_MAIN
#include <psio/fracpack.hpp>
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
   std::cout << "Alice account number is " << alice << "\n";

   transactor<nft_sys> nfts(nft_sys::contract, nft_sys::contract);

   transaction_trace trace = t.push_transaction(t.make_transaction({nfts.mint(alice, 1)}));
   //show(true, trace);

   REQUIRE(show(false, trace) == "");
   auto ret = get_return_val<uint64_t>(trace);
   printf("Return value is %" PRId64 "\n", ret);

}  // transfer