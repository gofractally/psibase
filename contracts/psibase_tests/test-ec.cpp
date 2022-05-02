#include <contracts/system/auth_ec_sys.hpp>
#include <contracts/system/verify_ec_sys.hpp>
#include <psibase/DefaultTestChain.hpp>

#include <psibase/contract_entry.hpp>
#include <psibase/native_tables.hpp>
#include <psio/to_json.hpp>

#include "test-cntr.hpp"

using namespace psibase;

static auto priv_key1 =
    privateKeyFromString("PVT_K1_KSm1gXENJdNCG9tJRErpZpdhut7NQDThVvkLQ3XYW5VksjPKV");
static auto pub_key1 =
    publicKeyFromString("PUB_K1_67w57254khWfNoinC8A3AsRVh2jncUgMDcC6JGNZyERHz9TteV");

static auto priv_key2 =
    privateKeyFromString("PVT_K1_KuuEeDKvFC6dSh7S5ACbkZPuxuvbU3J4buyEcjvg73NBxqdQz");
static auto pub_key2 =
    publicKeyFromString("PUB_K1_5NpiqhMbcHQGUXbVbn2TfYVHKkF7LfSiGp1HLx6qw31Np8ttcD");

TEST_CASE("ec")
{
   DefaultTestChain t;
   auto             test_contract = t.add_contract("test-cntr"_a, "test-cntr.wasm");

   auto alice = t.as(t.add_account(AccountNumber("alice")));
   auto bob   = t.as(t.add_account(AccountNumber("bob"), AccountNumber("auth-ec-sys")));

   // use "real" auth
   auto sue = t.add_ec_account("sue", pub_key1);

   expect(t.push_transaction(t.make_transaction({{
              .sender   = bob,
              .contract = test_contract,
          }})),
          "sender does not have a public key");
   expect(t.push_transaction(t.make_transaction({{
              .sender   = alice,
              .contract = system_contract::auth_ec_sys::contract,
              .rawData  = psio::convert_to_frac(
                   system_contract::auth_ec_sys::action{system_contract::auth_ec_sys::set_key{
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
       .rawData  = psio::convert_to_frac(test_cntr::payload{}),
   }});
   ec_trx.claims.push_back({
       .contract = system_contract::verify_ec_sys::contract,
       .rawData  = psio::convert_to_frac(pub_key1),
   });
   expect(t.push_transaction(ec_trx), "proofs and claims must have same size");

   auto packed_ec_trx = psio::convert_to_frac(ec_trx);

   SignedTransaction ec_signed = {
       .trx    = ec_trx,
       .proofs = {psio::convert_to_frac(
           sign(priv_key2, sha256(packed_ec_trx.data(), packed_ec_trx.size())))},
   };
   expect(t.push_transaction(ec_signed), "incorrect signature");

   ec_signed.proofs = {
       psio::convert_to_frac(sign(priv_key1, sha256(packed_ec_trx.data(), packed_ec_trx.size())))};
   expect(t.push_transaction(ec_signed));

   expect(t.push_transaction(t.make_transaction({{
                                 .sender   = sue,
                                 .contract = test_contract,
                                 .rawData  = psio::convert_to_frac(test_cntr::payload{}),
                             }}),
                             {{pub_key1, priv_key1}}));

   expect(t.push_transaction(t.make_transaction({{
                                 .sender   = sue,
                                 .contract = test_contract,
                                 .rawData  = psio::convert_to_frac(test_cntr::payload{}),
                             }}),
                             {{pub_key2, priv_key2}}),
          "no matching claim found");

   expect(t.push_transaction(t.make_transaction({{
                                 .sender   = sue,
                                 .contract = test_contract,
                                 .rawData  = psio::convert_to_frac(test_cntr::payload{}),
                             }}),
                             {{pub_key1, priv_key2}}),
          "incorrect signature", true);
}  // ec
