#include <algorithm>
#include <memory>

#include <psibase/check.hpp>

extern "C" [[clang::import_name("writeConsole")]] void writeConsole(const char* cstr, uint32_t len);

extern "C" void prints(const char* cstr)
{
   writeConsole(cstr, strlen(cstr));
}

extern "C" void printui(uint64_t value)
{
   char  s[21];
   char* ch = s;
   do
   {
      *ch++ = '0' + (value % 10);
      value /= 10;
   } while (value);
   std::reverse(s, ch);
   writeConsole(s, ch - s);
}

extern "C" void printi(int64_t value)
{
   if (value < 0)
   {
      prints("-");
      printui(-(uint64_t)value);
   }
   else
      printui(value);
}

extern "C"
{
   struct __attribute__((aligned(16))) capi_checksum160
   {
      uint8_t hash[20];
   };
   struct __attribute__((aligned(16))) capi_checksum256
   {
      uint8_t hash[32];
   };
   struct __attribute__((aligned(16))) capi_checksum512
   {
      uint8_t hash[64];
   };

   int recover_key(capi_checksum256* digest,
                   const char*       sig,
                   uint32_t          sig_len,
                   char*             pub,
                   uint32_t          pub_len)
   {
      psibase::check(false, "recover_key is not available");
      __builtin_unreachable();
   }
   void assert_recover_key(capi_checksum256* digest,
                           const char*       sig,
                           uint32_t          sig_len,
                           const char*       pub,
                           uint32_t          pub_len)
   {
      psibase::check(false, "assert_recover_key is not available");
      __builtin_unreachable();
   }

   [[clang::import_name("sha256")]] void sha256(const char*       data,
                                                uint32_t          length,
                                                capi_checksum256* hash);

   [[clang::import_name("sha1")]] void sha1(const char*       data,
                                            uint32_t          length,
                                            capi_checksum160* hash);

   [[clang::import_name("sha512")]] void sha512(const char*       data,
                                                uint32_t          length,
                                                capi_checksum512* hash);

   [[clang::import_name("ripemd160")]] void ripemd160(const char*       data,
                                                      uint32_t          length,
                                                      capi_checksum160* hash);

   void assert_sha1(const char* data, uint32_t len, const capi_checksum160* expected)
   {
      capi_checksum160 actual;
      sha1(data, len, &actual);
      psibase::check(memcmp(actual.hash, expected->hash, sizeof(actual.hash)) == 0,
                     "hash mismatch");
   }
   void assert_sha256(const char* data, uint32_t len, const capi_checksum256* expected)
   {
      capi_checksum256 actual;
      sha256(data, len, &actual);
      psibase::check(memcmp(actual.hash, expected->hash, sizeof(actual.hash)) == 0,
                     "hash mismatch");
   }
   void assert_sha512(const char* data, uint32_t len, const capi_checksum512* expected)
   {
      capi_checksum512 actual;
      sha512(data, len, &actual);
      psibase::check(memcmp(actual.hash, expected->hash, sizeof(actual.hash)) == 0,
                     "hash mismatch");
   }
   void assert_ripemd160(const char* data, uint32_t len, const capi_checksum160* expected)
   {
      capi_checksum160 actual;
      ripemd160(data, len, &actual);
      psibase::check(memcmp(actual.hash, expected->hash, sizeof(actual.hash)) == 0,
                     "hash mismatch");
   }
}
