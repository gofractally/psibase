#include <catch2/catch_all.hpp>
#include <psibase/DefaultTestChain.hpp>
#include <services/system/AuthSig.hpp>
#include <services/system/VerifySig.hpp>

#include <psibase/nativeTables.hpp>
#include <psibase/serviceEntry.hpp>
#include <psio/to_json.hpp>

using namespace psibase;

auto pubFromPem = [](std::string param) {  //
   return SystemService::AuthSig::SubjectPublicKeyInfo{
       SystemService::AuthSig::parseSubjectPublicKeyInfo(param)};
};

auto privFromPem = [](std::string param) {  //
   return SystemService::AuthSig::PrivateKeyInfo{
       SystemService::AuthSig::parsePrivateKeyInfo(param)};
};

auto priv_key1 = privFromPem(
    "-----BEGIN PRIVATE KEY-----\n"
    "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg9h35bFuOZyB8i+GT\n"
    "HEfwKktshavRCyzHq3X55sdfgs6hRANCAARZ0Aumf5wa4PWSWxJFdN1qliUbma5a\n"
    "CgAuh9li58vzfwZFSjjdS6gbPG7+ZblPqv0jHj+pziAfYH5lzpVjD+kp\n"
    "-----END PRIVATE KEY-----\n");
auto pub_key1 = pubFromPem(
    "-----BEGIN PUBLIC KEY-----\n"
    "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEWdALpn+cGuD1klsSRXTdapYlG5mu\n"
    "WgoALofZYufL838GRUo43UuoGzxu/mW5T6r9Ix4/qc4gH2B+Zc6VYw/pKQ==\n"
    "-----END PUBLIC KEY-----\n");
auto priv_key2 = privFromPem(
    "-----BEGIN PRIVATE KEY-----\n"
    "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgEbcmTuUFGjyAn0zd\n"
    "7VKhIDZpswsI3m/5bMV+XoBQNTGhRANCAAQzeyU+Sa3KSwreirHYVfyB0jNMaNWt\n"
    "GjyjVxTbjHHHyq96f3lqGlbApIe9u1CUDng/qlj0jGbuz5sOeeIY/DWJ\n"
    "-----END PRIVATE KEY-----\n");
auto pub_key2 = pubFromPem(
    "-----BEGIN PUBLIC KEY-----\n"
    "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEM3slPkmtyksK3oqx2FX8gdIzTGjV\n"
    "rRo8o1cU24xxx8qven95ahpWwKSHvbtQlA54P6pY9Ixm7s+bDnniGPw1iQ==\n"
    "-----END PUBLIC KEY-----\n");

TEST_CASE("ec")
{
   DefaultTestChain t;

   transactor<SystemService::AuthSig::AuthSig> authsig(SystemService::AuthSig::AuthSig::service,
                                                       SystemService::AuthSig::AuthSig::service);

   auto alice = t.from(t.addAccount(AccountNumber("alice")));
   auto bob   = t.from(t.addAccount(AccountNumber("bob"), AccountNumber("auth-sig")));
   auto sue   = t.addAccount("sue", pub_key1);

   t.startBlock(0);

   CHECK(TraceResult(t.pushTransaction(t.makeTransaction({{
                         .sender  = bob,
                         .service = AccountNumber{"nop"},
                     }})))
             .failed("sender does not have a public key"));
   t.startBlock(0);

   CHECK(TraceResult(t.pushTransaction(t.makeTransaction({{
                         .sender  = sue,
                         .service = AccountNumber{"nop"},
                     }})))
             .failed("transaction does not include a claim for the key"));
   t.startBlock(0);

   auto ec_trx = t.makeTransaction({{
       .sender  = sue,
       .service = AccountNumber{"nop"},
   }});
   ec_trx.claims.push_back({
       .service = SystemService::VerifySig::service,
       .rawData = {pub_key1.data.begin(), pub_key1.data.end()},
   });

   SignedTransaction signedTrx;
   signedTrx.transaction = ec_trx;
   CHECK(TraceResult(t.pushTransaction(signedTrx)).failed("proofs and claims must have same size"));
   t.startBlock(0);

   auto              packed_ec_trx = psio::convert_to_frac(ec_trx);
   auto              data = sign(priv_key2, sha256(packed_ec_trx.data(), packed_ec_trx.size()));
   SignedTransaction ec_signed = {
       .transaction = ec_trx,
       .proofs      = {{data.begin(), data.end()}},
   };

   CHECK(TraceResult(t.pushTransaction(ec_signed)).failed("signature invalid"));
   t.startBlock(0);

   CHECK(TraceResult(t.pushTransaction(t.makeTransaction({{
                                           .sender  = sue,
                                           .service = AccountNumber{"nop"},
                                       }}),
                                       {{pub_key1, priv_key1}}))
             .succeeded());
   t.startBlock(0);

   CHECK(TraceResult(t.pushTransaction(t.makeTransaction({{
                                           .sender  = sue,
                                           .service = AccountNumber{"nop"},
                                       }}),
                                       {{pub_key2, priv_key2}}))
             .failed("transaction does not include a claim for the key"));
   t.startBlock(0);

   CHECK(TraceResult(t.pushTransaction(t.makeTransaction({{
                                           .sender  = sue,
                                           .service = AccountNumber{"nop"},
                                       }}),
                                       {{pub_key1, priv_key2}}))
             .failed("signature invalid"));
   t.startBlock(0);

   CHECK(TraceResult(t.pushTransaction(t.makeTransaction({authsig.from(sue).setKey(pub_key2)}),
                                       {{pub_key1, priv_key1}}))
             .succeeded());
   t.startBlock(0);

   CHECK(TraceResult(t.pushTransaction(t.makeTransaction({{
                                           .sender  = sue,
                                           .service = AccountNumber{"nop"},
                                       }}),
                                       {{pub_key2, priv_key2}}))
             .succeeded());
   t.startBlock(0);
}  // ec
