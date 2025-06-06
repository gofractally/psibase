#include <services/system/VerifySig.hpp>

#include <botan/ec_group.h>
#include <botan/pubkey.h>
#include <botan/x509_key.h>
#include <psibase/api.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/serviceEntry.hpp>

using namespace psibase;
using namespace Botan;

// The supported algorithms depend on how Botan was built. See the root CMakeLists.txt.
extern "C" void called(AccountNumber thisService, AccountNumber sender)
{
   auto act = getCurrentAction();
   check(act.method == MethodNumber{"verifySys"}, "Unknown action");
   auto data = psio::from_frac<VerifyArgs>(act.rawData);

   auto ber_pubkey = std::span{reinterpret_cast<const std::uint8_t*>(data.claim.rawData.data()),
                               data.claim.rawData.size()};
   auto signature =
       std::span{reinterpret_cast<const std::uint8_t*>(data.proof.data()), data.proof.size()};

   std::unique_ptr<Public_Key> pubkey = X509::load_key(ber_pubkey);
   PK_Verifier                 verifier(*pubkey, "Raw", Signature_Format::Standard);
   check(verifier.verify_message(data.transactionHash, signature), "signature invalid");
}

extern "C" void __wasm_call_ctors();

// Called by wasm-ctor-eval during build
extern "C" [[clang::export_name("prestart")]] void prestart()
{
   __wasm_call_ctors();
   // Loading an EC_Group for the first time is very expensive
   EC_Group{"secp256k1"};
   EC_Group{"secp256r1"};
}

// Caution! Don't replace with version in dispatcher!
extern "C" void start(AccountNumber thisService) {}

#ifdef PSIBASE_GENERATE_SCHEMA

int main(int argc, const char* const* argv)
{
   return ::psibase::serviceMain<SystemService::VerifySig>(argc, argv);
}

#endif
