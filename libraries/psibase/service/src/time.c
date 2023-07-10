#include <time.h>

#include <wasi/api.h>

struct __clockid
{
   __wasi_clockid_t id;
};

const struct __clockid _CLOCK_PROCESS_CPUTIME_ID = {__WASI_CLOCKID_PROCESS_CPUTIME_ID};
