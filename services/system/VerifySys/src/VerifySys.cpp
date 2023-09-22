#include <botan/pkcs8.h>
#include <botan/pubkey.h>
#include <botan/x509_key.h>
#include <psibase/nativeFunctions.hpp>
#include <psibase/serviceEntry.hpp>

using namespace psibase;
using namespace Botan;

// The supported algorithms depend on how Botan was built. See the root CMakeLists.txt.
extern "C" [[clang::export_name("verify")]] void verify()
{
   auto act  = getCurrentAction();
   auto data = psio::from_frac<VerifyArgs>(act.rawData);

   auto ber_pubkey = std::span{reinterpret_cast<const std::uint8_t*>(data.claim.rawData.data()),
                               data.claim.rawData.size()};
   auto signature =
       std::span{reinterpret_cast<const std::uint8_t*>(data.proof.data()), data.proof.size()};

   std::unique_ptr<Public_Key> pubkey = X509::load_key(ber_pubkey);
   PK_Verifier                 verifier(*pubkey, "Raw", Signature_Format::DerSequence);
   check(verifier.verify_message(data.transactionHash, signature), "signature invalid");
}

extern "C" void called(AccountNumber thisService, AccountNumber sender)
{
   abortMessage("this service has no actions");
}

extern "C" void __wasm_call_ctors();

extern "C" void start(AccountNumber thisService)
{
   __wasm_call_ctors();
}
