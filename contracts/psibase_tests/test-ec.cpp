#include <base_contracts/auth_ec_sys.hpp>
#include <base_contracts/test.hpp>

#include "test-cntr.hpp"

using namespace eosio;
using namespace psibase;

static auto priv_key1 =
    eosio::private_key_from_string("PVT_R1_5WkGvLou463uDgKqVEZ86ET59Gueo9BjjwYDGQGepqq6bSJsm");
static auto pub_key1 =
    eosio::public_key_from_string("PUB_R1_6BVCPxQuEhq4mwiyP6szbvjJQimG8T4uCkTrtPwqcj6uHBaJ9b");

TEST_CASE("ec")
{
   test_chain t;
   t.start_block();
   boot_minimal(t);
   auto test_contract = add_contract(t, "test-cntr", "test-cntr.wasm");
   auto alice         = add_account(t, "alice");
   auto bob           = add_account(t, "bob", "auth_ec.sys");
   auto sue           = add_ec_account(t, "sue", pub_key1);
   expect(t.push_transaction(t.make_transaction({{
              .sender   = bob,
              .contract = test_contract,
          }})),
          "sender does not have a public key");
   expect(t.push_transaction(t.make_transaction({{
              .sender   = alice,
              .contract = auth_ec_sys::contract,
              .raw_data = eosio::convert_to_bin(auth_ec_sys::action{auth_ec_sys::set_key{
                  .account = bob,
              }}),
          }})),
          "wrong sender");
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
       .contract = verify_ec_sys::contract,
       .raw_data = eosio::convert_to_bin(pub_key1),
   });
   expect(t.push_transaction(ec_trx), "proofs and claims must have same size");

   signed_transaction ec_signed = {
       .trx    = ec_trx,
       .proofs = {eosio::convert_to_bin(eosio::signature{})},
   };
   expect(t.push_transaction(ec_signed), "", true);  // TODO: mismatched signature error

   // TODO: success

}  // ec
