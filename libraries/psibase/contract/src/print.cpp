#include <psibase/intrinsic.hpp>

extern "C" void prints_l(const char* str, uint32_t len)
{
   psibase::raw::writeConsole(str, len);
}

extern "C" void prints(const char* cstr)
{
   prints_l(cstr, strlen(cstr));
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
