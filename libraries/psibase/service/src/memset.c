#include <string.h>

#include <stdio.h>

void *memset(void* dest, int c, size_t n)
{
   unsigned char * d = dest;
   for(; n; n--, d++)
   {
      *d = c;
   }
   return dest;
}
