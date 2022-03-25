#define CATCH_CONFIG_MAIN
#include <psio/fracpack.hpp>

#include <contracts/system/account_sys.hpp>
#include <contracts/system/test.hpp>
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

   auto push = [&](std::vector<action>&& actions) {
      transaction_trace trace =
          t.push_transaction(t.make_transaction(std::forward<std::vector<action>&&>(actions)));
      REQUIRE(show(false, trace) == "");
      return trace;
   };

   auto cnum = add_contract(t, "nft.sys", "nft_sys.wasm");
   check(nft_sys::contract == cnum, "nft contract num changed from " +
                                        std::to_string(nft_sys::contract) + " to " +
                                        std::to_string(cnum));
   auto alice = add_account(t, "alice");
   std::cout << "Alice account number is " << alice << "\n";

   transactor<nft_sys> nfts(alice, nft_sys::contract);

   // Mint an NFT
   transaction_trace trace  = push({nfts.mint(alice, 1)});
   auto              nft_id = get_return_val<uint64_t>(trace);
   printf("NFT ID is %" PRId64 "\n", nft_id);

   // Confirm it's owned by alice
   trace    = push({nfts.get_nft(nft_id)});
   auto nft = get_return_val<std::optional<psibase::nft>>(trace);
   REQUIRE(nft != std::nullopt);
   printf("Return owner is %" PRIu32 "\n", nft.value().owner);

   // Confirm owner is "alice"
   transactor<account_sys> asys(alice, account_sys::contract);
   trace           = push({asys.get_account_by_num(nft.value().owner)});
   auto owner_name = get_return_val<optional<string>>(trace);
   REQUIRE(owner_name != std::nullopt);
   printf("NFT ID is %s \n", owner_name.value().c_str());

   // Transfer it

   // Confirm owner changed
}