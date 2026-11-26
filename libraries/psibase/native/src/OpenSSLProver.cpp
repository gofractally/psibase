#include <psibase/OpenSSLProver.hpp>

#include <psibase/block.hpp>
#include <psibase/openssl.hpp>

#include <openssl/bn.h>
#include <openssl/core_names.h>
#include <openssl/ec.h>
#include <openssl/err.h>
#include <openssl/evp.h>
#include <openssl/x509.h>

using psibase::handleOpenSSLError;
using psibase::OpenSSLDeleter;

namespace
{
   std::size_t getEcLen(EVP_PKEY* key)
   {
      if (EVP_PKEY_base_id(key) == EVP_PKEY_EC)
      {
         return (EVP_PKEY_bits(key) + 7) / 8;
      }
      else
      {
         return 0;
      }
   }
   // len is the key size in bytes
   std::vector<char> der2compact(std::vector<char>&& sig, std::size_t len)
   {
      auto p = reinterpret_cast<const unsigned char*>(sig.data());
      std::unique_ptr<ECDSA_SIG, OpenSSLDeleter> decoded(d2i_ECDSA_SIG(nullptr, &p, sig.size()));
      if (!decoded)
      {
         handleOpenSSLError();
      }
      auto              r = ECDSA_SIG_get0_r(decoded.get());
      auto              s = ECDSA_SIG_get0_s(decoded.get());
      std::vector<char> result(len * 2);
      if (BN_bn2binpad(r, reinterpret_cast<unsigned char*>(result.data()), len) == -1)
      {
         handleOpenSSLError();
      }
      if (BN_bn2binpad(s, reinterpret_cast<unsigned char*>(result.data()) + len, len) == -1)
      {
         handleOpenSSLError();
      }
      return result;
   }
}  // namespace

void psibase::handleOpenSSLError()
{
   auto err = ERR_get_error();
   char buf[256];
   ERR_error_string_n(err, buf, sizeof(buf));
   throw std::runtime_error("openssl error: " + std::string(buf));
}

std::vector<char> psibase::getPublicKey(EVP_PKEY* key)
{
   int sz = i2d_PUBKEY(static_cast<EVP_PKEY*>(key), nullptr);
   if (sz < 0)
   {
      handleOpenSSLError();
   }
   std::vector<char> result(sz);
   if (sz != 0)
   {
      unsigned char* p = reinterpret_cast<unsigned char*>(result.data());
      i2d_PUBKEY(static_cast<EVP_PKEY*>(key), &p);
   }
   return result;
}

void psibase::setCompressedKey(EVP_PKEY* pkey)
{
#if OPENSSL_VERSION_NUMBER >= 0x30000000
   if (!EVP_PKEY_set_utf8_string_param(pkey, "point-format", "compressed"))
   {
      handleOpenSSLError();
   }
#else
   auto eckey = EVP_PKEY_get0_EC_KEY(pkey);
   check(!!eckey, "Not an EC_KEY");
   EC_KEY_set_conv_form(eckey, POINT_CONVERSION_COMPRESSED);
#endif
}

std::unique_ptr<EVP_PKEY, OpenSSLDeleter> psibase::generateKey(int nid)
{
   std::unique_ptr<EVP_PKEY_CTX, OpenSSLDeleter> ctx(EVP_PKEY_CTX_new_id(EVP_PKEY_EC, nullptr));
   if (!ctx)
   {
      handleOpenSSLError();
   }
   if (EVP_PKEY_keygen_init(ctx.get()) <= 0)
   {
      handleOpenSSLError();
   }
   if (EVP_PKEY_CTX_set_ec_paramgen_curve_nid(ctx.get(), nid) <= 0)
   {
      handleOpenSSLError();
   }
   EVP_PKEY* pkey = nullptr;
   if (EVP_PKEY_keygen(ctx.get(), &pkey) <= 0)
   {
      handleOpenSSLError();
   }
   std::unique_ptr<EVP_PKEY, OpenSSLDeleter> result(pkey);
   setCompressedKey(result.get());
   return result;
}

int psibase::curveNid(KeyType type)
{
   switch (type)
   {
      case KeyType::secp256k1:
         return NID_secp256k1;
      case KeyType::secp256r1:
         return NID_X9_62_prime256v1;
   }
   throw std::runtime_error("Unsupported key type");
}

int psibase::curveNidFor(AccountNumber verifyService)
{
   if (auto type = verifiedKeyType(verifyService))
      return curveNid(*type);
   throw std::runtime_error("Unsupported verify service: " + verifyService.str());
}

void psibase::checkVerifier(AccountNumber service, std::span<const char> publicKey)
{
   if (!verifierFor(publicKey))
      throw std::runtime_error("Unsupported public key");
   if (!isAllowedVerifier(service, publicKey))
      throw std::runtime_error(service.str() + " does not verify this kind of key");
}

bool psibase::answersFor(AccountNumber proverService, const Claim& claim)
{
   return proverService == AccountNumber() || claim.service == proverService ||
          isAllowedVerifier(claim.service, claim.rawData);
}

void psibase::normalizeSignature(EVP_PKEY* key, std::span<char> signature)
{
   BIGNUM* n = nullptr;
   if (!EVP_PKEY_get_bn_param(key, OSSL_PKEY_PARAM_EC_ORDER, &n))
      handleOpenSSLError();
   std::unique_ptr<BIGNUM, OpenSSLDeleter> order(n);

   const std::size_t len   = signature.size() / 2;
   auto              sData = reinterpret_cast<unsigned char*>(signature.data()) + len;
   std::unique_ptr<BIGNUM, OpenSSLDeleter> s(BN_bin2bn(sData, len, nullptr));
   std::unique_ptr<BIGNUM, OpenSSLDeleter> half(BN_dup(order.get()));
   if (!s || !half || !BN_rshift1(half.get(), half.get()))
      handleOpenSSLError();
   if (BN_cmp(s.get(), half.get()) > 0)
   {
      if (!BN_sub(s.get(), order.get(), s.get()) || BN_bn2binpad(s.get(), sData, len) == -1)
         handleOpenSSLError();
   }
}

std::unique_ptr<EVP_PKEY, OpenSSLDeleter> psibase::parsePrivateKey(std::span<const char> key)
{
   auto* ptr = reinterpret_cast<const unsigned char*>(key.data());
   return std::unique_ptr<EVP_PKEY, OpenSSLDeleter>(d2i_AutoPrivateKey(nullptr, &ptr, key.size()));
}

psibase::OpenSSLProver::OpenSSLProver(AccountNumber service) : service(service)
{
   // The service names the kind of key: the caller chooses a curve by
   // choosing its verifier.
   auto pkey = generateKey(curveNidFor(service));
   if (!pkey)
   {
      handleOpenSSLError();
   }
   pubKey = getPublicKey(pkey.get());
   checkVerifier(service, pubKey);
   privateKey = pkey.release();
}

psibase::OpenSSLProver::OpenSSLProver(AccountNumber service, std::span<const char> key)
    : service(service)
{
   auto* ptr = reinterpret_cast<const unsigned char*>(key.data());
   std::unique_ptr<EVP_PKEY, OpenSSLDeleter> pkey(d2i_AutoPrivateKey(nullptr, &ptr, key.size()));
   if (!pkey)
   {
      handleOpenSSLError();
   }
   pubKey = getPublicKey(pkey.get());
   checkVerifier(service, pubKey);
   privateKey = pkey.release();
}

psibase::OpenSSLProver::~OpenSSLProver()
{
   if (privateKey)
   {
      EVP_PKEY_free(static_cast<EVP_PKEY*>(privateKey));
   }
}

std::vector<char> psibase::OpenSSLProver::prove(std::span<const char> data,
                                                const Claim&          claim) const
{
   if (claim.rawData == pubKey && answersFor(service, claim))
   {
      std::unique_ptr<EVP_MD_CTX, OpenSSLDeleter> ctx(EVP_MD_CTX_new());
      EVP_DigestSignInit(ctx.get(), nullptr, EVP_sha256(), nullptr,
                         static_cast<EVP_PKEY*>(privateKey));
      std::size_t n;
      if (!EVP_DigestSign(ctx.get(), nullptr, &n,
                          reinterpret_cast<const unsigned char*>(data.data()), data.size()))
      {
         handleOpenSSLError();
      }
      std::vector<char> result(n);
      if (!EVP_DigestSign(ctx.get(), reinterpret_cast<unsigned char*>(result.data()), &n,
                          reinterpret_cast<const unsigned char*>(data.data()), data.size()))
      {
         handleOpenSSLError();
      }
      result.resize(n);
      if (auto len = getEcLen(static_cast<EVP_PKEY*>(privateKey)))
      {
         result = der2compact(std::move(result), len);
         normalizeSignature(static_cast<EVP_PKEY*>(privateKey), result);
      }
      return result;
   }
   else
   {
      return {};
   }
}

bool psibase::OpenSSLProver::remove(const Claim& claim)
{
   return claim.rawData == pubKey && answersFor(service, claim);
}

void psibase::OpenSSLProver::get(std::vector<Claim>& out) const
{
   out.push_back({service, pubKey});
}

void psibase::OpenSSLProver::get(std::vector<ClaimKey>& out) const
{
   int sz = i2d_PrivateKey(static_cast<EVP_PKEY*>(privateKey), nullptr);
   if (sz < 0)
   {
      handleOpenSSLError();
   }
   std::vector<char> buf(sz);
   if (sz != 0)
   {
      unsigned char* p = reinterpret_cast<unsigned char*>(buf.data());
      i2d_PrivateKey(static_cast<EVP_PKEY*>(privateKey), &p);
   }
   out.push_back({service, std::move(buf)});
}

psibase::Claim psibase::OpenSSLProver::get() const
{
   return {service, pubKey};
}
