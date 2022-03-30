#define CATCH_CONFIG_MAIN
#include <psio/fracpack.hpp>

#include <contracts/system/account_sys.hpp>
#include <contracts/system/test.hpp>
#include "nft_sys.hpp"

using namespace eosio;
using namespace nft_sys;
using namespace psibase;
using nft_sys::nft_row;
using std::optional;

SCENARIO("Minting nfts")
{
   GIVEN("An empty chain with registered users Alice and Bob")
   {
      test_chain t;
      t.start_block();
      boot_minimal(t);
      auto cnum = add_contract(t, "nft.sys", "nft_sys.wasm");
      REQUIRE(cnum == nft_contract::contract);

      Actor alice{add_account(t, "alice")};
      Actor bob{add_account(t, "bob")};

      THEN("Alice can mint an NFT")
      {
         uint32_t          sub_id = 0;
         transaction_trace trace  = t.trace(alice.at<nft_contract>().mint(alice.id, sub_id));
         CHECK(show(false, trace) == "");

         AND_THEN("The NFT exists")
         {
            auto generate = [](uint32_t a, uint32_t b) {
               return (static_cast<uint64_t>(a) << 32 | static_cast<uint64_t>(b));
            };

            nft_row expectedNft{.nftid            = generate(alice.id, sub_id),
                                .issuer           = alice.id,
                                .owner            = alice.id,
                                .approved_account = 0};

            auto nft_id = getReturnVal<&nft_contract::mint>(trace);
            trace       = t.trace(alice.at<nft_contract>().get_nft(nft_id));
            auto nft    = getReturnVal<&nft_contract::get_nft>(trace);
            REQUIRE(nft != std::nullopt);
            REQUIRE(*nft == expectedNft);
         }
      }
   }
}
