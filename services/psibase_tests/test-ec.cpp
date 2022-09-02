#include <contracts/system/AuthEcSys.hpp>
#include <contracts/system/VerifyEcSys.hpp>
#include <psibase/DefaultTestChain.hpp>

#include <psibase/contractEntry.hpp>
#include <psibase/nativeTables.hpp>
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

   transactor<system_contract::AuthEcSys> ecsys(system_contract::AuthEcSys::service,
                                                system_contract::AuthEcSys::service);

   auto alice = t.as(t.add_account(AccountNumber("alice")));
   auto bob   = t.as(t.add_account(AccountNumber("bob"), AccountNumber("auth-ec-sys")));
   auto sue   = t.add_ec_account("sue", pub_key1);

   expect(t.pushTransaction(t.makeTransaction({{
              .sender   = bob,
              .contract = test_contract,
          }})),
          "sender does not have a public key");
   expect(t.pushTransaction(t.makeTransaction({{
              .sender   = sue,
              .contract = test_contract,
          }})),
          "transaction is not signed with key");

   auto ec_trx = t.makeTransaction({{
       .sender   = sue,
       .contract = test_contract,
       .rawData  = psio::convert_to_frac(test_cntr::payload{}),
   }});
   ec_trx.claims.push_back({
       .contract = system_contract::VerifyEcSys::service,
       .rawData  = psio::convert_to_frac(pub_key1),
   });
   expect(t.pushTransaction(ec_trx), "proofs and claims must have same size");

   auto packed_ec_trx = psio::convert_to_frac(ec_trx);

   SignedTransaction ec_signed = {
       .transaction = ec_trx,
       .proofs      = {psio::convert_to_frac(
                sign(priv_key2, sha256(packed_ec_trx.data(), packed_ec_trx.size())))},
   };
   expect(t.pushTransaction(ec_signed), "incorrect signature");

   ec_signed.proofs = {
       psio::convert_to_frac(sign(priv_key1, sha256(packed_ec_trx.data(), packed_ec_trx.size())))};
   expect(t.pushTransaction(ec_signed));

   t.startBlock();
   expect(t.pushTransaction(t.makeTransaction({{
                                .sender   = sue,
                                .contract = test_contract,
                                .rawData  = psio::convert_to_frac(test_cntr::payload{}),
                            }}),
                            {{pub_key1, priv_key1}}));

   expect(t.pushTransaction(t.makeTransaction({{
                                .sender   = sue,
                                .contract = test_contract,
                                .rawData  = psio::convert_to_frac(test_cntr::payload{}),
                            }}),
                            {{pub_key2, priv_key2}}),
          "transaction is not signed with key");

   expect(t.pushTransaction(t.makeTransaction({{
                                .sender   = sue,
                                .contract = test_contract,
                                .rawData  = psio::convert_to_frac(test_cntr::payload{}),
                            }}),
                            {{pub_key1, priv_key2}}),
          "incorrect signature");

   expect(t.pushTransaction(t.makeTransaction({ecsys.as(sue).setKey(pub_key2)}),
                            {{pub_key1, priv_key1}}));

   expect(t.pushTransaction(t.makeTransaction({{
                                .sender   = sue,
                                .contract = test_contract,
                                .rawData  = psio::convert_to_frac(test_cntr::payload{}),
                            }}),
                            {{pub_key2, priv_key2}}));
}  // ec
