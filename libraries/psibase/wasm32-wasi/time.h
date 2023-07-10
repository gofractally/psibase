#pragma once

#include_next <time.h>

#ifdef __cplusplus
extern "C"
{
#endif

   extern const struct __clockid _CLOCK_PROCESS_CPUTIME_ID;
#define CLOCK_PROCESS_CPUTIME_ID (&_CLOCK_PROCESS_CPUTIME_ID)

#ifdef __cplusplus
}
#endif
