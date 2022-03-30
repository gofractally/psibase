#include <contracts/system/auth_ec_sys.hpp>
#include <contracts/system/test.hpp>

#include "test-cntr.hpp"

using namespace eosio;
using namespace psibase;

static auto priv_key1 =
    eosio::private_key_from_string("PVT_K1_KSm1gXENJdNCG9tJRErpZpdhut7NQDThVvkLQ3XYW5VksjPKV");
static auto pub_key1 =
    eosio::public_key_from_string("PUB_K1_67w57254khWfNoinC8A3AsRVh2jncUgMDcC6JGNZyERHz9TteV");

static auto priv_key2 =
    eosio::private_key_from_string("PVT_K1_KuuEeDKvFC6dSh7S5ACbkZPuxuvbU3J4buyEcjvg73NBxqdQz");
static auto pub_key2 =
    eosio::public_key_from_string("PUB_K1_5NpiqhMbcHQGUXbVbn2TfYVHKkF7LfSiGp1HLx6qw31Np8ttcD");

TEST_CASE("ec")
{
   test_chain t;
   t.start_block();
   boot_minimal(t);

   // use fake auth
   auto test_contract = add_contract(t, "test-cntr", "test-cntr.wasm");
   auto alice         = add_account(t, AccountNumber("alice"));
   auto bob           = add_account(t, AccountNumber("bob"), AccountNumber("auth-ec-sys") );

   // use "real" auth
   auto sue = add_ec_account(t, "sue", pub_key1);
   expect(t.push_transaction(t.make_transaction({{
              .sender   = bob,
              .contract = test_contract,
          }})),
          "sender does not have a public key");

   /// TODO FIX THIS
   /*
   expect(t.push_transaction(t.make_transaction({{
              .sender   = alice,
              .contract = system_contract::auth_ec_sys::contract,
              .raw_data = eosio::convert_to_bin(system_contract::auth_ec_sys::action{auth_ec_sys::set_key{
                  .account = bob,
              }}),
          }})),
          "wrong sender");
          */
   expect(t.push_transaction(t.make_transaction({{
              .sender   = sue,
              .contract = test_contract,
          }})),
          "no matching claim found");

   auto ec_trx = t.make_transaction({{
       .sender   = sue,
       .contract = test_contract,
       .raw_data = eosio::convert_to_bin(test_cntr::payload{}),
   }});
   ec_trx.claims.push_back({
       .contract = system_contract::verify_ec_sys::contract,
       .raw_data = eosio::convert_to_bin(pub_key1),
   });
   expect(t.push_transaction(ec_trx), "proofs and claims must have same size");

   auto packed_ec_trx = psio::convert_to_frac(ec_trx);

   signed_transaction ec_signed = {
       .trx    = ec_trx,
       .proofs = {eosio::convert_to_bin(
           sign(priv_key2, sha256(packed_ec_trx.data(), packed_ec_trx.size())))},
   };
   expect(t.push_transaction(ec_signed), "incorrect signature");

   ec_signed.proofs = {
       eosio::convert_to_bin(sign(priv_key1, sha256(packed_ec_trx.data(), packed_ec_trx.size())))};
   expect(t.push_transaction(ec_signed));

   expect(t.push_transaction(t.make_transaction({{
                                 .sender   = sue,
                                 .contract = test_contract,
                                 .raw_data = eosio::convert_to_bin(test_cntr::payload{}),
                             }}),
                             {{pub_key1, priv_key1}}));

   expect(t.push_transaction(t.make_transaction({{
                                 .sender   = sue,
                                 .contract = test_contract,
                                 .raw_data = eosio::convert_to_bin(test_cntr::payload{}),
                             }}),
                             {{pub_key2, priv_key2}}),
          "no matching claim found");

   expect(t.push_transaction(t.make_transaction({{
                                 .sender   = sue,
                                 .contract = test_contract,
                                 .raw_data = eosio::convert_to_bin(test_cntr::payload{}),
                             }}),
                             {{pub_key1, priv_key2}}),
          "incorrect signature", true);
}  // ec
