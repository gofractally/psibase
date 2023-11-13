#pragma once

#include <openssl/ec.h>
#include <openssl/evp.h>

// Some C++ wrappers for OpenSSL

namespace psibase
{
   void handleOpenSSLError();
   struct OpenSSLDeleter
   {
      void operator()(EVP_MD_CTX* ctx) const { EVP_MD_CTX_free(ctx); }
      void operator()(EVP_PKEY* key) const { EVP_PKEY_free(key); }
      void operator()(EVP_PKEY_CTX* ctx) const { EVP_PKEY_CTX_free(ctx); }
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
}  // namespace psibase
