#include <string.h>

void * memmove(void* dest, const void* src, size_t n)
{
   unsigned char * d = dest;
   const unsigned char * s = src;
   if (d < s)
   {
      for(;n; --n, ++d, ++s)
      {
         *d = *s;
      }
      return d;
   }
   else
   {
      while(n)
      {
         --n;
         d[n] = s[n];
      }
      return dest;
   }
}
