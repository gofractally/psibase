#pragma once

#include <openssl/ec.h>
#include <openssl/evp.h>
#include <openssl/kdf.h>

#include <psibase/block.hpp>
#include <psibase/verifier.hpp>

#include <memory>
#include <span>
#include <vector>

// Some C++ wrappers for OpenSSL

namespace psibase
{
   void handleOpenSSLError();
   struct OpenSSLDeleter
   {
      void operator()(EVP_MD_CTX* ctx) const { EVP_MD_CTX_free(ctx); }
      void operator()(EVP_PKEY* key) const { EVP_PKEY_free(key); }
      void operator()(EVP_PKEY_CTX* ctx) const { EVP_PKEY_CTX_free(ctx); }
      void operator()(EVP_KDF* kdf) const { EVP_KDF_free(kdf); }
      void operator()(EVP_KDF_CTX* ctx) const { EVP_KDF_CTX_free(ctx); }
      void operator()(EVP_CIPHER_CTX* ctx) const { EVP_CIPHER_CTX_free(ctx); }
      void operator()(ECDSA_SIG* sig) const { ECDSA_SIG_free(sig); }
      void operator()(BIGNUM* bn) const { BN_free(bn); }
      void operator()(ASN1_OCTET_STRING* s) const { ASN1_OCTET_STRING_free(s); }
      void operator()(ASN1_OBJECT* o) const { ASN1_OBJECT_free(o); }
      void operator()(unsigned char* p) const { OPENSSL_free(p); }
#if OPENSSL_VERSION_NUMBER < 0x30000000
      void operator()(EC_KEY* p) const { EC_KEY_free(p); }
#endif
   };
   void                                      setCompressedKey(EVP_PKEY* pkey);
   std::vector<char>                         getPublicKey(EVP_PKEY* key);
   std::unique_ptr<EVP_PKEY, OpenSSLDeleter> generateKey(int nid);
   std::unique_ptr<EVP_PKEY, OpenSSLDeleter> parsePrivateKey(std::span<const char> key);
   // The OpenSSL curve for a key type
   int curveNid(KeyType type);
   // The OpenSSL curve for the keys that a verify service verifies. Throws if
   // the service is not one of the verifiers in psibase/verifier.hpp.
   int curveNidFor(AccountNumber verifyService);
   // Throws unless service is one of the verifiers allowed for this public
   // key (a DER SubjectPublicKeyInfo): a claim naming any other service would
   // not verify.
   void checkVerifier(AccountNumber service, std::span<const char> publicKey);
   // Whether a prover that holds the key of this claim under proverService
   // signs for it. The signature does not depend on which service verifies
   // it, so a key answers for every verifier allowed for it: a producer that
   // registers its key under another allowed verifier needs no new key.
   // A prover with no service answers for any.
   bool answersFor(AccountNumber proverService, const Claim& claim);
   // Rewrites a raw r || s ECDSA signature made with key into the low-S form,
   // s <= n/2. The verifiers accept no other form.
   void normalizeSignature(EVP_PKEY* key, std::span<char> signature);
}  // namespace psibase
