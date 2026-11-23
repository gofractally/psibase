// Lean signature verification service: same interface as the Botan-based
// VerifySig (verifySys), built only from the pieces verification needs.
//   secp256k1 (K1): libsecp256k1
//   secp256r1 (R1, P-256): selected at build time (LEAN_R1_BEARSSL or LEAN_R1_P256M)
// Keys are DER SubjectPublicKeyInfo; signatures are 64 bytes, r || s.
#include <psibase/api.hpp>
#include <psibase/block.hpp>
#include <psibase/check.hpp>
#include <psibase/serviceEntry.hpp>

#include <cstring>
#include <span>

extern "C"
{
#include <secp256k1.h>
#if defined(LEAN_R1_BEARSSL)
#include <bearssl_ec.h>
#elif defined(LEAN_R1_P256M)
#include <p256-m.h>
#endif
}

using namespace psibase;

namespace
{
   using Bytes = std::span<const unsigned char>;

   // AlgorithmIdentifier { id-ecPublicKey, namedCurve }
   constexpr unsigned char k1Algorithm[] = {0x30, 0x10, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d,
                                            0x02, 0x01, 0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x0a};
   constexpr unsigned char r1Algorithm[] = {0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48,
                                            0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a,
                                            0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07};

   // If spki is SEQUENCE { algorithm, BIT STRING point } with exactly this
   // algorithm, returns the encoded point; otherwise an empty span.
   Bytes pointFor(Bytes spki, Bytes algorithm)
   {
      const std::size_t header = 2 + algorithm.size() + 3;
      if (spki.size() != header + 65 && spki.size() != header + 33)
         return {};
      const std::size_t pointSize = spki.size() - header;
      if (spki[0] != 0x30 || spki[1] != spki.size() - 2)
         return {};
      if (std::memcmp(spki.data() + 2, algorithm.data(), algorithm.size()) != 0)
         return {};
      const unsigned char* bits = spki.data() + 2 + algorithm.size();
      if (bits[0] != 0x03 || bits[1] != pointSize + 1 || bits[2] != 0x00)
         return {};
      return spki.subspan(header);
   }

   void verifyK1(Bytes point, const unsigned char* hash, const unsigned char* sig64)
   {
      const secp256k1_context* ctx = secp256k1_context_static;
      secp256k1_pubkey         pubkey;
      check(secp256k1_ec_pubkey_parse(ctx, &pubkey, point.data(), point.size()),
            "invalid public key");
      secp256k1_ecdsa_signature sig;
      check(secp256k1_ecdsa_signature_parse_compact(ctx, &sig, sig64), "signature invalid");
      // libsecp256k1 only verifies low-S signatures; normalizing first accepts
      // both forms, as the Botan-based service does.
      secp256k1_ecdsa_signature_normalize(ctx, &sig, &sig);
      check(secp256k1_ecdsa_verify(ctx, &sig, hash, &pubkey), "signature invalid");
   }

   void verifyR1(Bytes point, const unsigned char* hash, const unsigned char* sig64)
   {
      check(point.size() == 65 && point[0] == 0x04, "unsupported public key encoding");
#if defined(LEAN_R1_BEARSSL)
      br_ec_public_key pk{BR_EC_secp256r1, const_cast<unsigned char*>(point.data()), point.size()};
      check(br_ecdsa_i31_vrfy_raw(LEAN_R1_BEARSSL, hash, 32, &pk, sig64, 64) == 1,
            "signature invalid");
#elif defined(LEAN_R1_P256M)
      check(p256_ecdsa_verify(sig64, point.data() + 1, hash, 32) == P256_SUCCESS,
            "signature invalid");
#else
      check(false, "secp256r1 is not supported by this build");
#endif
   }
}  // namespace

extern "C" void called(AccountNumber thisService, AccountNumber sender)
{
   auto act = getCurrentAction();
   check(act.method == MethodNumber{"verifySys"}, "Unknown action");
   auto data = psio::from_frac<VerifyArgs>(act.rawData);

   Bytes spki{reinterpret_cast<const unsigned char*>(data.claim.rawData.data()),
              data.claim.rawData.size()};
   check(data.proof.size() == 64, "signature must be 64 bytes");
   auto sig  = reinterpret_cast<const unsigned char*>(data.proof.data());
   auto hash = data.transactionHash.data();

   if (auto point = pointFor(spki, r1Algorithm); !point.empty())
      verifyR1(point, hash, sig);
   else if (auto point = pointFor(spki, k1Algorithm); !point.empty())
      verifyK1(point, hash, sig);
   else
      check(false, "unsupported public key");
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
