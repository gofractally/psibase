#include <psibase/OpenSSLProver.hpp>

#include <psibase/block.hpp>
#include <psibase/openssl.hpp>

#include <openssl/ec.h>
#include <openssl/err.h>
#include <openssl/evp.h>

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
   int sz = i2d_PublicKey(static_cast<EVP_PKEY*>(key), nullptr);
   if (sz < 0)
   {
      handleOpenSSLError();
   }
   std::vector<char> result(sz);
   if (sz != 0)
   {
      unsigned char* p = reinterpret_cast<unsigned char*>(result.data());
      i2d_PublicKey(static_cast<EVP_PKEY*>(key), &p);
   }
   return result;
}

std::unique_ptr<EVP_PKEY, OpenSSLDeleter> psibase::generateKey()
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
   if (EVP_PKEY_CTX_set_ec_paramgen_curve_nid(ctx.get(), NID_X9_62_prime256v1) <= 0)
   {
      handleOpenSSLError();
   }
   EVP_PKEY* result = nullptr;
   if (EVP_PKEY_keygen(ctx.get(), &result) <= 0)
   {
      handleOpenSSLError();
   }
   return std::unique_ptr<EVP_PKEY, OpenSSLDeleter>(result);
}

std::unique_ptr<EVP_PKEY, OpenSSLDeleter> psibase::parsePrivateKey(std::span<const char> key)
{
   auto* ptr = reinterpret_cast<const unsigned char*>(key.data());
   return std::unique_ptr<EVP_PKEY, OpenSSLDeleter>(d2i_AutoPrivateKey(nullptr, &ptr, key.size()));
}

psibase::OpenSSLProver::OpenSSLProver(AccountNumber service) : service(service)
{
   auto pkey = generateKey();
   if (!pkey)
   {
      handleOpenSSLError();
   }
   pubKey     = getPublicKey(pkey.get());
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
   pubKey     = getPublicKey(pkey.get());
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
   if ((service == AccountNumber() || claim.service == service) && claim.rawData == pubKey)
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
   return (service == AccountNumber() || claim.service == service) && claim.rawData == pubKey;
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
