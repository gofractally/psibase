#include <services/system/VerifyBr1.hpp>

#include <psibase/api.hpp>
#include <psibase/check.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/serviceEntry.hpp>
#include <psibase/verifier.hpp>

#include <cstring>
#include <span>

extern "C"
{
#include <bearssl/bearssl_ec.h>
}

// Verifies ECDSA signatures over secp256r1 (R1, P-256) with BearSSL.
//
// This is the second verifier for the curve. The default is verify-r1; an
// account that prefers this implementation chooses it in auth-sig
// (psibase/verifier.hpp lists the verifiers allowed for a key). Both accept
// and reject exactly the same claims and proofs.
//
// A claim is a DER SubjectPublicKeyInfo and a proof is the 64-byte signature
// r || s over the transaction hash. Only what verification needs is linked:
// BearSSL's P-256 and nothing else. It does not allocate, and its tables are
// constants in the binary, so there is nothing to set up at start and the
// service is one page. It uses its 64-bit code, which relies on the
// wide-arithmetic instructions.
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

   // BearSSL only takes uncompressed points, so a compressed P-256 point is
   // expanded here with BearSSL's modular integer routines. These are internal
   // to the library (declared in its src/inner.h); the library is pinned to one
   // commit, so the signatures below cannot drift.
   extern "C"
   {
      void     br_i31_decode(uint32_t* x, const void* src, size_t len);
      uint32_t br_i31_decode_mod(uint32_t* x, const void* src, size_t len, const uint32_t* m);
      void     br_i31_encode(void* dst, size_t len, const uint32_t* x);
      uint32_t br_i31_ninv31(uint32_t x);
      uint32_t br_i31_add(uint32_t* a, const uint32_t* b, uint32_t ctl);
      uint32_t br_i31_sub(uint32_t* a, const uint32_t* b, uint32_t ctl);
      void     br_i31_to_monty(uint32_t* x, const uint32_t* m);
      void     br_i31_montymul(uint32_t*       d,
                               const uint32_t* x,
                               const uint32_t* y,
                               const uint32_t* m,
                               uint32_t        m0i);
      void     br_i31_modpow(uint32_t*            x,
                             const unsigned char* e,
                             size_t               elen,
                             const uint32_t*      m,
                             uint32_t             m0i,
                             uint32_t*            t1,
                             uint32_t*            t2);
   }

   // The P-256 field prime p, the curve constant b, and (p + 1) / 4. Because
   // p = 3 (mod 4), a square root of v is v^((p + 1) / 4).
   constexpr unsigned char r1Prime[32] = {
       0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
       0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff};
   constexpr unsigned char r1B[32] = {
       0x5a, 0xc6, 0x35, 0xd8, 0xaa, 0x3a, 0x93, 0xe7, 0xb3, 0xeb, 0xbd, 0x55, 0x76, 0x98, 0x86, 0xbc,
       0x65, 0x1d, 0x06, 0xb0, 0xcc, 0x53, 0xb0, 0xf6, 0x3b, 0xce, 0x3c, 0x3e, 0x27, 0xd2, 0x60, 0x4b};
   constexpr unsigned char r1SqrtExponent[32] = {
       0x3f, 0xff, 0xff, 0xff, 0xc0, 0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
       0x00, 0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00};

   // Expands 02/03 || X into 04 || X || Y. The result is not trusted: the
   // caller hands it to BearSSL, which checks that it is on the curve.
   void decompressR1(Bytes compressed, unsigned char* uncompressed)
   {
      // A 256-bit integer in BearSSL's i31 format: a header word and 9 words of 31 bits.
      using Int = uint32_t[10];
      Int p, x, b, v, y, y2, t1, t2;

      br_i31_decode(p, r1Prime, sizeof(r1Prime));
      const uint32_t m0i = br_i31_ninv31(p[1]);
      // Adds p back after a subtraction that borrowed, or removes it after an
      // addition that reached p.
      auto subMod = [&](uint32_t* a, const uint32_t* c) { br_i31_add(a, p, br_i31_sub(a, c, 1)); };
      auto addMod = [&](uint32_t* a, const uint32_t* c)
      {
         uint32_t carry   = br_i31_add(a, c, 1);
         uint32_t atLeast = 1 ^ br_i31_sub(a, p, 0);
         br_i31_sub(a, p, carry | atLeast);
      };
      // montymul(a * R, c) = a * c, where R is the Montgomery constant.
      auto mul = [&](uint32_t* d, const uint32_t* a, const uint32_t* c)
      {
         Int am;
         std::memcpy(am, a, sizeof(Int));
         br_i31_to_monty(am, p);
         br_i31_montymul(d, am, c, p, m0i);
      };

      check(br_i31_decode_mod(x, compressed.data() + 1, 32, p), "invalid public key");
      br_i31_decode_mod(b, r1B, sizeof(r1B), p);

      // v = x^3 - 3x + b
      mul(v, x, x);
      mul(v, v, x);
      subMod(v, x);
      subMod(v, x);
      subMod(v, x);
      addMod(v, b);

      std::memcpy(y, v, sizeof(Int));
      br_i31_modpow(y, r1SqrtExponent, sizeof(r1SqrtExponent), p, m0i, t1, t2);
      mul(y2, y, y);
      check(std::memcmp(y2, v, sizeof(Int)) == 0, "invalid public key");

      uncompressed[0] = 0x04;
      std::memcpy(uncompressed + 1, compressed.data() + 1, 32);
      br_i31_encode(uncompressed + 33, 32, y);
      if ((uncompressed[64] & 1) != (compressed[0] & 1))
      {
         // The other root is p - y.
         std::memcpy(y2, p, sizeof(Int));
         br_i31_sub(y2, y, 1);
         br_i31_encode(uncompressed + 33, 32, y2);
      }
   }

   void verifyR1(Bytes point, const unsigned char* hash, const unsigned char* signature)
   {
      // BearSSL accepts any s in [1, n-1].
      check(verifier::isLowS(std::span<const unsigned char, 64>{signature, 64}, KeyType::secp256r1),
            "signature invalid");
      unsigned char expanded[65];
      if (point.size() == 33)
      {
         check(point[0] == 0x02 || point[0] == 0x03, "invalid public key");
         decompressR1(point, expanded);
         point = expanded;
      }
      check(point[0] == 0x04, "invalid public key");
      br_ec_public_key key{BR_EC_secp256r1, const_cast<unsigned char*>(point.data()), point.size()};
      check(br_ecdsa_i31_vrfy_raw(br_ec_p256_m64_get(), hash, 32, &key, signature, 64) == 1, "signature invalid");
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

   auto point = verifier::ecPoint(key, KeyType::secp256r1);
   check(!point.empty(), "unsupported public key");
   verifyR1(point, hash, signature);
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
   return ::psibase::serviceMain<SystemService::VerifyBr1>(argc, argv);
}

#endif
