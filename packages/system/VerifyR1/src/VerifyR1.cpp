#include <services/system/VerifyR1.hpp>

#include <botan/ec_apoint.h>
#include <botan/ec_group.h>
#include <botan/ecdsa.h>
#include <botan/pubkey.h>
#include <psibase/api.hpp>
#include <psibase/check.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/serviceEntry.hpp>
#include <psibase/verifier.hpp>

#include <cstdint>
#include <optional>
#include <span>

// Verifies ECDSA signatures over secp256r1 (R1, P-256) with Botan.
//
// This is the default verifier for the curve. verify-br1 is a second,
// independent implementation that an account may choose instead; both
// accept and reject exactly the same claims and proofs.
//
// A claim is a DER SubjectPublicKeyInfo and a proof is the 64-byte signature
// r || s over the transaction hash.
//
// Everything about the encoding is decided here, with the functions of
// psibase/verifier.hpp, before Botan is called. Botan is given only a point
// encoding of the right size and form and a signature of 64 bytes in the
// low-S form; its X.509 parser is not used at all.
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
//
// Setting up the curve (Botan computes its tables at run time) costs several
// times a verification. It is done once, when the service is built: prestart
// below is run by wasm-ctor-eval and the module that is deployed starts with
// the memory that left behind. See CMakeLists.txt.

using namespace psibase;

namespace
{
   using Bytes = std::span<const std::uint8_t>;

   // Created by prestart. Never destroyed.
   const Botan::EC_Group* curve = nullptr;

   const Botan::EC_Group& getCurve()
   {
      // Only reached with a null pointer if the module was not pre-initialized.
      if (!curve)
         curve = new Botan::EC_Group(Botan::EC_Group::from_name("secp256r1"));
      return *curve;
   }

   bool verify(const Botan::EC_AffinePoint& point, Bytes hash, Bytes signature)
   {
      Botan::ECDSA_PublicKey key(getCurve(), point);
      // "Raw": the message is the digest. Standard: r || s (IEEE 1363).
      Botan::PK_Verifier verifier(key, "Raw", Botan::Signature_Format::Standard);
      return verifier.verify_message(hash, signature);
   }

   // The generator of the curve, uncompressed
   constexpr std::uint8_t generator[65] = {
       0x04, 0x6b, 0x17, 0xd1, 0xf2, 0xe1, 0x2c, 0x42, 0x47, 0xf8, 0xbc, 0xe6, 0xe5,
       0x63, 0xa4, 0x40, 0xf2, 0x77, 0x03, 0x7d, 0x81, 0x2d, 0xeb, 0x33, 0xa0, 0xf4,
       0xa1, 0x39, 0x45, 0xd8, 0x98, 0xc2, 0x96, 0x4f, 0xe3, 0x42, 0xe2, 0xfe, 0x1a,
       0x7f, 0x9b, 0x8e, 0xe7, 0xeb, 0x4a, 0x7c, 0x0f, 0x9e, 0x16, 0x2b, 0xce, 0x33,
       0x57, 0x6b, 0x31, 0x5e, 0xce, 0xcb, 0xb6, 0x40, 0x68, 0x37, 0xbf, 0x51, 0xf5};
}  // namespace

extern "C" void called(AccountNumber thisService, AccountNumber sender)
{
   auto act = getCurrentAction();
   check(act.method == MethodNumber{"verifySys"}, "Unknown action");
   auto data = psio::from_pssz<VerifyArgs>(act.rawData);

   Bytes key{reinterpret_cast<const std::uint8_t*>(data.claim.rawData.data()),
             data.claim.rawData.size()};
   check(data.proof.size() == 64, "signature invalid");
   std::span<const std::uint8_t, 64> signature{
       reinterpret_cast<const std::uint8_t*>(data.proof.data()), 64};

   auto encoded = verifier::ecPoint(key, KeyType::secp256r1);
   check(!encoded.empty(), "unsupported public key");
   // No hybrid points (06/07 || X || Y), a third encoding of the same point.
   check(encoded[0] == (encoded.size() == 65 ? 0x04 : (0x02 | (encoded[0] & 1))),
         "invalid public key");
   // Botan accepts any s in [1, n-1].
   check(verifier::isLowS(signature, KeyType::secp256r1), "signature invalid");

   // Nothing unless the coordinates are in range and the point is on the curve
   auto point = Botan::EC_AffinePoint::deserialize(getCurve(), encoded);
   check(point.has_value(), "invalid public key");

   check(verify(*point, Bytes{data.transactionHash.data(), data.transactionHash.size()}, signature),
         "signature invalid");
}

extern "C" void __wasm_call_ctors();

#ifndef VERIFY_R1_NOT_PREINITIALIZED

// Run by wasm-ctor-eval when the service is built; not present in the
// deployed module. Loads the curve and takes one verification through every
// path, so that whatever Botan sets up on first use is already set up.
extern "C" [[clang::export_name("prestart")]] void prestart()
{
   __wasm_call_ctors();
   if (auto point = Botan::EC_AffinePoint::deserialize(getCurve(), generator))
   {
      // Not a valid signature; it only has to be computed.
      std::uint8_t hash[32]      = {1};
      std::uint8_t signature[64] = {};
      signature[31]              = 1;
      signature[63]              = 1;
      (void)verify(*point, hash, signature);
   }
}

// Caution! Don't replace with version in dispatcher!
// Constructors ran in prestart.
extern "C" void start(AccountNumber thisService) {}

#else

// The same service without the build-time step: every instance sets the
// curve up when it first verifies. Built only as the comparison for the test
// that shows the deployed service does not pay for this.
extern "C" void start(AccountNumber thisService)
{
   __wasm_call_ctors();
}

#endif

#ifdef PSIBASE_GENERATE_SCHEMA

int main(int argc, const char* const* argv)
{
   return ::psibase::serviceMain<SystemService::VerifyR1>(argc, argv);
}

#endif
