#include <services/system/VerifyR1.hpp>

#include <botan/internal/pcurves.h>
#include <botan/internal/pcurves_instance.h>
#include <psibase/api.hpp>
#include <psibase/check.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/serviceEntry.hpp>
#include <psibase/verifier.hpp>

#include <cstdint>
#include <memory>
#include <span>

// Verifies ECDSA signatures over secp256r1 (R1, P-256) with Botan's
// fixed-size curve arithmetic.
//
// This is the default verifier for the curve. verify-br1 is a second,
// independent implementation that an account may choose instead; both
// accept and reject exactly the same claims and proofs.
//
// A claim is a DER SubjectPublicKeyInfo and a proof is the 64-byte signature
// r || s over the transaction hash.
//
// Everything about the encoding is decided here, with the functions of
// psibase/verifier.hpp, before Botan is called:
// - Keys: exactly the DER SubjectPublicKeyInfo for the curve, holding an
//   uncompressed (04 || X || Y) or compressed (02/03 || X) point. Nothing else
//   that a general DER parser would tolerate is accepted: no trailing bytes,
//   no unused bits, no alternative identifier encodings, no hybrid points.
// - Signatures: only the low-S form, s <= n/2. (r, s) and (r, n - s) are both
//   mathematically valid for the same message, so without this rule every
//   signature would have a second encoding that anyone could produce. A
//   signer normalizes with s = n - s when s > n/2.
//
// BOTAN INTERNALS. The verification itself (verify, below) is written on
// Botan::PCurve::PrimeOrderCurve, declared in botan/internal/pcurves.h. That
// is not Botan's public interface: nothing of Botan's key, signature, X.509,
// big-integer or EC_Group code is used or linked, which is what keeps this
// service small and quick to start. It is written against Botan 3.14.1, the
// version the build pins by hash (wasm-botan in the root CMakeLists.txt), and
// performs the same steps, in the same order, as that version's own
//
//    ECDSA_Verification_Operation::verify   src/lib/pubkey/ecdsa/ecdsa.cpp:260
//
// which calls, through EC_Scalar and EC_Group::Mul2Table (ec_scalar.cpp,
// ec_inner_data.cpp, ec_inner_pc.cpp), the functions used here:
//
//    Botan 3.14.1                               here
//    EC_Scalar::deserialize_pair(group, sig)    deserialize_scalar for r and for s
//    r.is_nonzero() && s.is_nonzero()           deserialize_scalar refuses zero
//    EC_Scalar::from_bytes_with_trunc(msg)      scalar_from_wide_bytes (a 32-byte
//                                               digest is not truncated: reduced mod n)
//    s.invert_vartime()                         scalar_invert_vartime
//    m_gy_mul.mul2_vartime_x_mod_order_eq(      scalar_mul twice, then
//        r, w, m, r)                            mul2_vartime_x_mod_order_eq(table, r, m*w, r*w)
//    EC_Group::Mul2Table(public point)          mul2_setup_g
//
// When the pinned version changes, read that function again and compare.
// The differential test (test_verifier_differential.cpp) holds this service
// to the decisions of the BearSSL verifier on several thousand cases.
//
// Setting up the curve (Botan computes its generator tables at run time)
// costs several times a verification. It is done once, when the service is
// built: prestart below is run by wasm-ctor-eval and the module that is
// deployed starts with the memory that left behind. See CMakeLists.txt.

using namespace psibase;

namespace
{
   using Bytes = std::span<const std::uint8_t>;
   using Curve = Botan::PCurve::PrimeOrderCurve;

   // Created by prestart. Never destroyed.
   const Curve* curve = nullptr;

   const Curve& getCurve()
   {
      // Only reached with a null pointer if the module was not pre-initialized.
      if (!curve)
         curve = (new std::shared_ptr<const Curve>(Botan::PCurve::PCurveInstance::secp256r1()))
                     ->get();
      return *curve;
   }

   // Nothing unless `encoded` is 04 || X || Y or 02/03 || X with coordinates
   // below the field prime that are those of a point on the curve.
   std::optional<Curve::AffinePoint> point(Bytes encoded)
   {
      if (encoded.size() == 33)
         return getCurve().deserialize_point_compressed(encoded);
      else
         return getCurve().deserialize_point_uncompressed(encoded);
   }

   // ECDSA verification of the signature r || s over a 32-byte digest.
   // See BOTAN INTERNALS above for the correspondence with Botan's own.
   bool verify(const Curve::AffinePoint& q, Bytes hash, std::span<const std::uint8_t, 64> signature)
   {
      const Curve& c = getCurve();
      // Each is nothing unless it is in [1, n-1].
      auto r = c.deserialize_scalar(signature.first(32));
      auto s = c.deserialize_scalar(signature.last(32));
      if (!r || !s)
         return false;
      // The digest as an integer, reduced modulo n
      auto m = c.scalar_from_wide_bytes(hash);
      if (!m)
         return false;
      // Nothing here is secret, so the variable-time functions are used.
      auto w  = c.scalar_invert_vartime(*s);
      auto u1 = c.scalar_mul(*m, w);
      auto u2 = c.scalar_mul(*r, w);
      // r == x(u1 * G + u2 * Q) mod n; false also if that is the point at infinity
      auto table = c.mul2_setup_g(q);
      return c.mul2_vartime_x_mod_order_eq(*table, *r, u1, u2);
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
   // The arithmetic accepts any s in [1, n-1].
   check(verifier::isLowS(signature, KeyType::secp256r1), "signature invalid");

   auto q = point(encoded);
   check(q.has_value(), "invalid public key");

   check(verify(*q, Bytes{data.transactionHash.data(), data.transactionHash.size()}, signature),
         "signature invalid");
}

extern "C" void __wasm_call_ctors();

#ifndef VERIFY_R1_NOT_PREINITIALIZED

// Run by wasm-ctor-eval when the service is built; not present in the
// deployed module. Creates the curve and takes one complete verification,
// with each encoding of a point, so that whatever is set up on first use is
// already set up.
extern "C" [[clang::export_name("prestart")]] void prestart()
{
   __wasm_call_ctors();
   // Not a valid signature; it only has to be computed.
   std::uint8_t hash[32]      = {1};
   std::uint8_t signature[64] = {};
   signature[31]              = 1;
   signature[63]              = 1;
   if (auto q = point(generator))
      (void)verify(*q, hash, signature);
   // Gy is odd
   std::uint8_t compressed[33] = {0x03};
   for (int i = 0; i < 32; ++i)
      compressed[1 + i] = generator[1 + i];
   if (auto q = point(compressed))
      (void)verify(*q, hash, signature);
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
