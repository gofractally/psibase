// A verify service with the same interface as VerifySig (verifySys), using
// libsecp256k1 instead of Botan. secp256k1 keys only. Compiled unchanged to
// wasm and to a native shared library.
#include <psibase/api.hpp>
#include <psibase/block.hpp>
#include <psibase/check.hpp>
#include <psibase/serviceEntry.hpp>

#include <cstring>
#include <span>

extern "C"
{
#include <secp256k1.h>
}

using namespace psibase;

namespace
{
   // SubjectPublicKeyInfo for id-ecPublicKey with the secp256k1 curve:
   //   SEQUENCE { SEQUENCE { OID ecPublicKey, OID secp256k1 }, BIT STRING point }
   constexpr unsigned char algorithm[] = {0x30, 0x10, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d,
                                          0x02, 0x01, 0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x0a};

   // Returns the encoded curve point inside a DER SubjectPublicKeyInfo.
   std::span<const unsigned char> pointFromSpki(std::span<const unsigned char> spki)
   {
      // 2 (outer SEQUENCE) + 18 (algorithm) + 3 (BIT STRING header, zero unused bits)
      constexpr std::size_t header = 2 + sizeof(algorithm) + 3;
      check(spki.size() == header + 65 || spki.size() == header + 33, "unsupported public key");
      const std::size_t pointSize = spki.size() - header;
      check(spki[0] == 0x30 && spki[1] == spki.size() - 2, "malformed public key");
      check(std::memcmp(spki.data() + 2, algorithm, sizeof(algorithm)) == 0,
            "not a secp256k1 public key");
      const unsigned char* bits = spki.data() + 2 + sizeof(algorithm);
      check(bits[0] == 0x03 && bits[1] == pointSize + 1 && bits[2] == 0x00, "malformed public key");
      return spki.subspan(header);
   }
}  // namespace

extern "C" void called(AccountNumber thisService, AccountNumber sender)
{
   auto act = getCurrentAction();
   check(act.method == MethodNumber{"verifySys"}, "Unknown action");
   auto data = psio::from_frac<VerifyArgs>(act.rawData);

   auto point = pointFromSpki({reinterpret_cast<const unsigned char*>(data.claim.rawData.data()),
                               data.claim.rawData.size()});
   check(data.proof.size() == 64, "signature must be 64 bytes");

   const secp256k1_context* ctx = secp256k1_context_static;
   secp256k1_pubkey         pubkey;
   check(secp256k1_ec_pubkey_parse(ctx, &pubkey, point.data(), point.size()), "invalid public key");
   secp256k1_ecdsa_signature sig;
   check(secp256k1_ecdsa_signature_parse_compact(
             ctx, &sig, reinterpret_cast<const unsigned char*>(data.proof.data())),
         "signature invalid");
   // libsecp256k1 only verifies low-S signatures. Normalizing first accepts
   // both forms, which is what the Botan-based VerifySig does.
   secp256k1_ecdsa_signature_normalize(ctx, &sig, &sig);
   check(secp256k1_ecdsa_verify(ctx, &sig, data.transactionHash.data(), &pubkey),
         "signature invalid");
}

extern "C" void __wasm_call_ctors();

// Nothing to precompute: the verification tables are constants in the binary.
extern "C" void prestart() {}

extern "C" void start(AccountNumber thisService)
{
#ifdef COMPILING_WASM
   __wasm_call_ctors();
#endif
}
