#include <eosio/name.hpp>
#include <newchain/intrinsic.hpp>

extern "C" void prints_l(const char* str, uint32_t len)
{
   newchain::intrinsic::write_console(str, len);
}

extern "C" void prints(const char* cstr)
{
   prints_l(cstr, strlen(cstr));
}

extern "C" void printn(uint64_t n)
{
   std::string s = eosio::name_to_string(n);
   prints_l(s.data(), s.size());
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
   prints_l(s, ch - s);
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
