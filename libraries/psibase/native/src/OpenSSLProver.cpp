#include <psibase/OpenSSLProver.hpp>

#include <psibase/block.hpp>

#include <openssl/ec.h>
#include <openssl/evp.h>

namespace
{
   void handleOpenSSLError()
   {
      throw std::runtime_error("openssl error");
   }
   void handleOpenSSLError(int result)
   {
      if (!result)
      {
         throw std::runtime_error("openssl error");
      }
   }
   struct OpenSSLDeleter
   {
      void operator()(EVP_MD_CTX* ctx) const { EVP_MD_CTX_free(ctx); }
      void operator()(EVP_PKEY* key) const { EVP_PKEY_free(key); }
   };
   std::vector<char> getPublicKey(EVP_PKEY* key)
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
}  // namespace

psibase::OpenSSLProver::OpenSSLProver(AccountNumber service) : service(service)
{
   std::unique_ptr<EVP_PKEY, OpenSSLDeleter> pkey(EVP_EC_gen("P-256"));
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
      handleOpenSSLError(EVP_DigestSign(ctx.get(), nullptr, &n,
                                        reinterpret_cast<const unsigned char*>(data.data()),
                                        data.size()));
      std::vector<char> result(n);
      handleOpenSSLError(EVP_DigestSign(ctx.get(), reinterpret_cast<unsigned char*>(result.data()),
                                        &n, reinterpret_cast<const unsigned char*>(data.data()),
                                        data.size()));
      result.resize(n);
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
