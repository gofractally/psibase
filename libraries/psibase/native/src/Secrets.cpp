#include <psibase/Secrets.hpp>

#include <openssl/evp.h>
#include <openssl/rand.h>
#include <cassert>
#include <cstring>
#include <fstream>
#include <psibase/check.hpp>
#include <psibase/fileUtil.hpp>
#include <psio/fracpack.hpp>
#include <psio/reflect.hpp>
#include <vector>

using namespace psibase;

// AES-GCM
// magic (4-bytes) || version (4-bytes) || iv (16-bytes) || cyphertext || tag (16-bytes)

namespace
{
   constexpr unsigned char prefix[] = {0, 0xcf, 0x88, 's', 1, 0, 0, 0};

   constexpr std::size_t prefix_size = sizeof(prefix);
   constexpr std::size_t block_size  = 16;
   constexpr std::size_t iv_size     = block_size;
   constexpr std::size_t tag_size    = block_size;

   struct FreeCipher
   {
      void operator()(EVP_CIPHER_CTX* ctx) const { EVP_CIPHER_CTX_free(ctx); }
   };

   void writeEncryptedFile(const std::filesystem::path& file,
                           std::span<const char>        data,
                           std::span<const char, 32>    master_key)
   {
      const std::size_t cyphertext_size = data.size();
      const std::size_t output_size     = prefix_size + iv_size + cyphertext_size + tag_size;
      auto error = [&] { abortMessage("Failed to write encrypted file: " + file.string()); };
      std::vector<unsigned char> buffer(output_size);
      {
         auto ctx = std::unique_ptr<EVP_CIPHER_CTX, FreeCipher>(EVP_CIPHER_CTX_new());
         if (!ctx)
            error();
         unsigned char* outp = buffer.data();
         std::memcpy(outp, prefix, prefix_size);
         outp += prefix_size;

         if (RAND_bytes(outp, iv_size) != 1)
            error();
         const unsigned char* iv = outp;
         outp += iv_size;

         if (!EVP_EncryptInit_ex2(ctx.get(), EVP_aes_256_gcm(),
                                  reinterpret_cast<const unsigned char*>(master_key.data()), iv,
                                  nullptr))
         {
            error();
         }
         std::size_t          remaining = data.size();
         const unsigned char* pos       = reinterpret_cast<const unsigned char*>(data.data());
         int                  outl;
         if (!EVP_EncryptUpdate(ctx.get(), nullptr, &outl, prefix, prefix_size))
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

   std::vector<char> readEncryptedFile(const std::filesystem::path& file,
                                       std::span<const char, 32>    master_key)
   {
      auto error = [&] { abortMessage("Failed to read encrypted file: " + file.string()); };
      auto data  = readWholeFile(file.string());
      if (data.size() < prefix_size + iv_size + tag_size)
      {
         error();
      }
      const unsigned char* inp = reinterpret_cast<const unsigned char*>(data.data());
      auto                 pfx = std::span<const unsigned char, prefix_size>{inp, prefix_size};
      inp += prefix_size;
      auto iv = std::span<const unsigned char, iv_size>{inp, iv_size};
      inp += iv_size;
      auto ciphertext_size = data.size() - prefix_size - iv_size - tag_size;
      auto ciphertext      = std::span<const unsigned char>{inp, ciphertext_size};
      inp += ciphertext_size;
      auto tag = std::span<const unsigned char, tag_size>{inp, tag_size};
      inp += tag_size;
      assert(inp - reinterpret_cast<const unsigned char*>(data.data()) == data.size());
      if (!std::ranges::equal(prefix, pfx))
      {
         error();
      }
      auto ctx = std::unique_ptr<EVP_CIPHER_CTX, FreeCipher>(EVP_CIPHER_CTX_new());
      if (!ctx)
         error();
      if (!EVP_DecryptInit_ex2(ctx.get(), EVP_aes_256_gcm(),
                               reinterpret_cast<const unsigned char*>(master_key.data()), iv.data(),
                               nullptr))
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
      if (!EVP_DecryptUpdate(ctx.get(), nullptr, &outl, pfx.data(), prefix_size))
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
      return result;
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
   std::filesystem::path filename;
   std::vector<KeyValue> items;
   std::array<char, 32>  key;
};

Secrets::Secrets(const std::filesystem::path& file, std::span<const char, 32> master_key)
    : impl(new Impl{file, std::filesystem::exists(file) ? psio::from_frac<std::vector<KeyValue>>(
                                                              readEncryptedFile(file, master_key))
                                                        : std::vector<KeyValue>()})
{
   std::memcpy(impl->key.data(), master_key.data(), master_key.size());
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
   writeEncryptedFile(impl->filename, psio::to_frac(impl->items), impl->key);
}
