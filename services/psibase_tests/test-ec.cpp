#include <psibase/DefaultTestChain.hpp>
#include <services/system/AuthK1.hpp>
#include <services/system/VerifyK1.hpp>

#include <psibase/nativeTables.hpp>
#include <psibase/serviceEntry.hpp>
#include <psio/to_json.hpp>

#include "test-service.hpp"

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
   auto             test_service = t.addService("test-service"_a, "test-service.wasm");

   transactor<SystemService::AuthK1> ecsys(SystemService::AuthK1::service,
                                           SystemService::AuthK1::service);

   auto alice = t.from(t.addAccount(AccountNumber("alice")));
   auto bob   = t.from(t.addAccount(AccountNumber("bob"), AccountNumber("auth-k1")));
   auto sue   = t.addAccount("sue", pub_key1);

   expect(t.pushTransaction(t.makeTransaction({{
              .sender  = bob,
              .service = test_service,
          }})),
          "sender does not have a public key");
   expect(t.pushTransaction(t.makeTransaction({{
              .sender  = sue,
              .service = test_service,
          }})),
          "transaction does not include a claim for the key");

   auto ec_trx = t.makeTransaction({{
       .sender  = sue,
       .service = test_service,
       .rawData = psio::convert_to_frac(test_cntr::payload{}),
   }});
   ec_trx.claims.push_back({
       .service = SystemService::VerifyK1::service,
       .rawData = psio::convert_to_frac(pub_key1),
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
                                .sender  = sue,
                                .service = test_service,
                                .rawData = psio::convert_to_frac(test_cntr::payload{}),
                            }}),
                            {{pub_key1, priv_key1}}));

   expect(t.pushTransaction(t.makeTransaction({{
                                .sender  = sue,
                                .service = test_service,
                                .rawData = psio::convert_to_frac(test_cntr::payload{}),
                            }}),
                            {{pub_key2, priv_key2}}),
          "transaction does not include a claim for the key");

   expect(t.pushTransaction(t.makeTransaction({{
                                .sender  = sue,
                                .service = test_service,
                                .rawData = psio::convert_to_frac(test_cntr::payload{}),
                            }}),
                            {{pub_key1, priv_key2}}),
          "incorrect signature");

   expect(t.pushTransaction(t.makeTransaction({ecsys.from(sue).setKey(pub_key2)}),
                            {{pub_key1, priv_key1}}));

   expect(t.pushTransaction(t.makeTransaction({{
                                .sender  = sue,
                                .service = test_service,
                                .rawData = psio::convert_to_frac(test_cntr::payload{}),
                            }}),
                            {{pub_key2, priv_key2}}));
}  // ec
