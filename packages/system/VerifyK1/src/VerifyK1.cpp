#include <services/system/VerifyK1.hpp>

#include <psibase/api.hpp>
#include <psibase/check.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/serviceEntry.hpp>
#include <psibase/verifier.hpp>

#include <span>

extern "C"
{
#include <secp256k1.h>
}

// Verifies ECDSA signatures over secp256k1 (K1).
//
// A claim is a DER SubjectPublicKeyInfo and a proof is the 64-byte signature
// r || s over the transaction hash. Only what verification needs is linked:
// libsecp256k1 and nothing else. It does not allocate, and its tables are
// constants in the binary, so there is nothing to set up at start. It uses
// its 64-bit code, which relies on the wide-arithmetic instructions.
//
// Keys of any other type belong to another verifier (psibase/verifier.hpp)
// and are rejected here.
//
// Accepted encodings:
// - Keys: exactly the DER SubjectPublicKeyInfo for the curve, holding an
//   uncompressed (04 || X || Y) or compressed (02/03 || X) point. Nothing else
//   that a general DER parser would tolerate is accepted: no trailing bytes,
//   no unused bits, no alternative identifier encodings, no hybrid points.
// - Signatures: only the low-S form, s <= n/2. (r, s) and (r, n - s) are both
//   mathematically valid for the same message, so without this rule every
//   signature would have a second encoding that anyone could produce. A
//   signer normalizes with s = n - s when s > n/2.

using namespace psibase;

namespace
{
   using Bytes = std::span<const unsigned char>;

   void verifyK1(Bytes point, const unsigned char* hash, const unsigned char* signature)
   {
      // libsecp256k1 would also take the "hybrid" form (06/07 || X || Y), a
      // third encoding of the same point.
      check(point[0] == (point.size() == 65 ? 0x04 : (0x02 | (point[0] & 1))), "invalid public key");
      const secp256k1_context* ctx = secp256k1_context_static;
      secp256k1_pubkey         pubkey;
      check(secp256k1_ec_pubkey_parse(ctx, &pubkey, point.data(), point.size()),
            "invalid public key");
      secp256k1_ecdsa_signature sig;
      check(secp256k1_ecdsa_signature_parse_compact(ctx, &sig, signature), "signature invalid");
      // libsecp256k1 rejects high-S signatures.
      check(secp256k1_ecdsa_verify(ctx, &sig, hash, &pubkey), "signature invalid");
   }
}  // namespace

extern "C" void called(AccountNumber thisService, AccountNumber sender)
{
   auto act = getCurrentAction();
   check(act.method == MethodNumber{"verifySys"}, "Unknown action");
   auto data = psio::from_pssz<VerifyArgs>(act.rawData);

   Bytes key{reinterpret_cast<const unsigned char*>(data.claim.rawData.data()),
             data.claim.rawData.size()};
   check(data.proof.size() == 64, "signature invalid");
   auto signature = reinterpret_cast<const unsigned char*>(data.proof.data());
   auto hash      = data.transactionHash.data();

   auto point = verifier::ecPoint(key, KeyType::secp256k1);
   check(!point.empty(), "unsupported public key");
   verifyK1(point, hash, signature);
}

extern "C" void __wasm_call_ctors();

// Caution! Don't replace with version in dispatcher!
extern "C" void start(AccountNumber thisService)
{
   __wasm_call_ctors();
}

#ifdef PSIBASE_GENERATE_SCHEMA

int main(int argc, const char* const* argv)
{
   return ::psibase::serviceMain<SystemService::VerifyK1>(argc, argv);
}

#endif
