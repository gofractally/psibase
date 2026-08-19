#include <psibase/Secrets.hpp>

#include <openssl/evp.h>
#include <openssl/rand.h>
#include <cassert>
#include <cstring>
#include <fstream>
#include <psibase/check.hpp>
#include <psibase/fileUtil.hpp>
#include <psibase/openssl.hpp>
#include <psio/fracpack.hpp>
#include <psio/reflect.hpp>
#include <vector>

using namespace psibase;

// AES-GCM
// magic (4-bytes) || version (4-bytes) || KDF params || iv (16-bytes) || cyphertext || tag (16-bytes)

// KDF uses scrypt
// salt (16 bytes) || logn (4-bytes) || r (4-bytes) || p (4-bytes)

namespace
{
   constexpr unsigned char prefix[] = {0, 0xcf, 0x88, 's', 1, 0, 0, 0};

   constexpr std::size_t prefix_size = sizeof(prefix);
   constexpr std::size_t block_size  = 16;
   constexpr std::size_t iv_size     = block_size;
   constexpr std::size_t tag_size    = block_size;

   template <std::size_t N>
   std::array<unsigned char, N> randomSalt()
   {
      std::array<unsigned char, N> result;
      if (RAND_bytes(result.data(), result.size()) != 1)
      {
         abortMessage("Could not generate salt");
      }
      return result;
   }

   std::uint32_t readLE(const unsigned char*& in)
   {
      std::uint32_t result = 0;
      for (std::uint32_t i = 0; i < 4; ++i)
      {
         result += (static_cast<std::uint32_t>(*in++) << i * 8);
      }
      return result;
   }

   void writeLE(std::uint32_t value, unsigned char*& out)
   {
      for (std::size_t i = 0; i < 4; ++i)
      {
         *out++ = value & 0xffu;
         value >>= 8;
      }
   }

   struct SCryptParams
   {
      static constexpr std::size_t salt_size = 16;
      SCryptParams() : salt(randomSalt<SCryptParams::salt_size>()), logn(14), r(8), p(1) {}
      SCryptParams(const unsigned char*& in)
      {
         std::memcpy(salt.data(), in, salt.size());
         in += salt.size();
         logn = readLE(in);
         r    = readLE(in);
         p    = readLE(in);
      }
      std::array<unsigned char, salt_size> salt;
      std::uint32_t                        logn;
      std::uint32_t                        r;
      std::uint32_t                        p;
      static constexpr std::size_t         size()
      {
         return salt_size + sizeof(logn) + sizeof(r) + sizeof(p);
      }
   };

   void writeParams(const SCryptParams& params, unsigned char*& out)
   {
      std::memcpy(out, params.salt.data(), params.salt.size());
      out += params.salt.size();
      writeLE(params.logn, out);
      writeLE(params.r, out);
      writeLE(params.p, out);
   }

   struct DecryptedFile
   {
      std::array<unsigned char, 32> key;
      SCryptParams                  params;
      std::vector<char>             data;
   };

   template <std::size_t N>
   std::array<unsigned char, N> deriveKey(std::string_view passphrase, const SCryptParams& params)
   {
      if (params.logn > 63)
      {
         abortMessage("invalid scrypt parameters");
      }
      auto kdf = std::unique_ptr<EVP_KDF, OpenSSLDeleter>(EVP_KDF_fetch(NULL, "SCRYPT", NULL));
      auto ctx = std::unique_ptr<EVP_KDF_CTX, OpenSSLDeleter>(EVP_KDF_CTX_new(kdf.get()));
      std::uint64_t n           = std::uint64_t(1) << params.logn;
      OSSL_PARAM    sslparams[] = {
          OSSL_PARAM_octet_string("pass", const_cast<char*>(passphrase.data()), passphrase.size()),
          OSSL_PARAM_octet_string("salt", const_cast<unsigned char*>(params.salt.data()),
                                  params.salt.size()),
          OSSL_PARAM_uint64("n", &n),
          OSSL_PARAM_uint32("r", const_cast<std::uint32_t*>(&params.r)),
          OSSL_PARAM_uint32("p", const_cast<std::uint32_t*>(&params.p)),
          OSSL_PARAM_END,
      };
      std::array<unsigned char, N> result;
      if (EVP_KDF_derive(ctx.get(), result.data(), result.size(), sslparams) != 1)
      {
         abortMessage("failed to derive key");
      }
      return result;
   }

   void writeEncryptedFile(const std::filesystem::path&       file,
                           std::span<const char>              data,
                           const SCryptParams                 params,
                           std::span<const unsigned char, 32> master_key)
   {
      const std::size_t cyphertext_size = data.size();
      const std::size_t output_size =
          prefix_size + params.size() + iv_size + cyphertext_size + tag_size;
      auto error = [&] { abortMessage("Failed to write encrypted file: " + file.string()); };
      std::vector<unsigned char> buffer(output_size);
      {
         auto ctx = std::unique_ptr<EVP_CIPHER_CTX, OpenSSLDeleter>(EVP_CIPHER_CTX_new());
         if (!ctx)
            error();
         unsigned char* outp            = buffer.data();
         auto           additional_data = outp;
         std::memcpy(outp, prefix, prefix_size);
         outp += prefix_size;

         writeParams(params, outp);

         std::size_t additional_data_size = outp - additional_data;

         if (RAND_bytes(outp, iv_size) != 1)
            error();
         const unsigned char* iv = outp;
         outp += iv_size;

         if (!EVP_EncryptInit_ex2(ctx.get(), EVP_aes_256_gcm(), master_key.data(), iv, nullptr))
         {
            error();
         }
         std::size_t          remaining = data.size();
         const unsigned char* pos       = reinterpret_cast<const unsigned char*>(data.data());
         int                  outl;
         if (!EVP_EncryptUpdate(ctx.get(), nullptr, &outl, additional_data, additional_data_size))
         {
            error();
         }
         if (!EVP_EncryptUpdate(ctx.get(), outp, &outl, pos, remaining))
         {
            error();
         }
         outp += outl;
         if (!EVP_EncryptFinal_ex(ctx.get(), outp, &outl))
         {
            error();
         }
         outp += outl;
         if (!EVP_CIPHER_CTX_ctrl(ctx.get(), EVP_CTRL_AEAD_GET_TAG, tag_size, outp))
         {
            error();
         }
         outp += tag_size;
         assert(outp - buffer.data() == buffer.size());
      }
      std::ofstream stream(file, std::ios_base::binary);
      if (!stream.write(reinterpret_cast<const char*>(buffer.data()), buffer.size()))
      {
         error();
      }
   }

   DecryptedFile readEncryptedFile(const std::filesystem::path& file, std::string_view passphrase)
   {
      auto error        = [&] { abortMessage("Failed to read encrypted file: " + file.string()); };
      auto data         = readWholeFile(file.string());
      auto nondata_size = prefix_size + SCryptParams::size() + iv_size + tag_size;
      if (data.size() < nondata_size)
      {
         error();
      }
      const unsigned char* inp = reinterpret_cast<const unsigned char*>(data.data());
      auto                 pfx = std::span<const unsigned char, prefix_size>{inp, prefix_size};
      inp += prefix_size;
      if (!std::ranges::equal(prefix, pfx))
      {
         error();
      }
      auto params               = SCryptParams(inp);
      auto additional_data      = pfx.data();
      auto additional_data_size = inp - additional_data;
      auto iv                   = std::span<const unsigned char, iv_size>{inp, iv_size};
      inp += iv_size;
      auto ciphertext_size = data.size() - nondata_size;
      auto ciphertext      = std::span<const unsigned char>{inp, ciphertext_size};
      inp += ciphertext_size;
      auto tag = std::span<const unsigned char, tag_size>{inp, tag_size};
      inp += tag_size;
      assert(inp - reinterpret_cast<const unsigned char*>(data.data()) == data.size());
      auto master_key = deriveKey<32>(passphrase, params);
      auto ctx        = std::unique_ptr<EVP_CIPHER_CTX, OpenSSLDeleter>(EVP_CIPHER_CTX_new());
      if (!ctx)
         error();
      if (!EVP_DecryptInit_ex2(ctx.get(), EVP_aes_256_gcm(), master_key.data(), iv.data(), nullptr))
      {
         error();
      }
      if (!EVP_CIPHER_CTX_ctrl(ctx.get(), EVP_CTRL_AEAD_SET_TAG, tag.size(),
                               const_cast<void*>(static_cast<const void*>(tag.data()))))
      {
         error();
      }
      std::vector<char> result(ciphertext_size);
      auto              out = reinterpret_cast<unsigned char*>(result.data());
      int               outl;
      if (!EVP_DecryptUpdate(ctx.get(), nullptr, &outl, additional_data, additional_data_size))
      {
         error();
      }
      if (!EVP_DecryptUpdate(ctx.get(), out, &outl, ciphertext.data(), ciphertext_size))
      {
         error();
      }
      out += outl;
      if (!EVP_DecryptFinal_ex(ctx.get(), out, &outl))
      {
         error();
      }
      out += outl;
      assert(out - reinterpret_cast<const unsigned char*>(result.data()) == result.size());
      return {master_key, params, std::move(result)};
   }

   struct KeyValue
   {
      std::vector<char> key;
      std::vector<char> value;
      std::string_view  skey() const { return {key.data(), key.size()}; }
      PSIO_REFLECT(KeyValue, key, value);
   };
}  // namespace

struct Secrets::Impl
{
   Impl(const std::filesystem::path& path, std::string_view passphrase)
       : params(), key(deriveKey<32>(passphrase, params)), filename(path)
   {
   }
   Impl(const std::filesystem::path& path, DecryptedFile&& contents)
       : params(std::move(contents.params)),
         key(std::move(contents.key)),
         filename(path),
         items(psio::from_frac<std::vector<KeyValue>>(contents.data))
   {
   }
   SCryptParams                  params;
   std::array<unsigned char, 32> key;
   std::filesystem::path         filename;
   std::vector<KeyValue>         items;
};

Secrets::Secrets(const std::filesystem::path& file, std::string_view passphrase)
    : impl(new Impl{std::filesystem::exists(file) ? Impl(file, readEncryptedFile(file, passphrase))
                                                  : Impl(file, passphrase)})
{
}

Secrets::~Secrets() = default;

std::optional<std::span<const char>> Secrets::get(std::span<const char> key)
{
   auto k   = std::string_view{key.data(), key.size()};
   auto pos = std::ranges::lower_bound(impl->items, k, {}, &KeyValue::skey);
   if (pos != impl->items.end() && pos->skey() == k)
   {
      return pos->value;
   }
   else
   {
      return {};
   }
}

void Secrets::put(std::span<const char> key, std::span<const char> value)
{
   auto k   = std::string_view{key.data(), key.size()};
   auto pos = std::ranges::lower_bound(impl->items, k, {}, &KeyValue::skey);
   if (pos != impl->items.end() && pos->skey() == k)
   {
      pos->value.reserve(value.size());
      pos->value.clear();
      pos->value.insert(pos->value.end(), value.begin(), value.end());
   }
   else
   {
      impl->items.insert(pos, KeyValue{std::vector(key.begin(), key.end()),
                                       std::vector(value.begin(), value.end())});
   }
   writeEncryptedFile(impl->filename, psio::to_frac(impl->items), impl->params, impl->key);
}
