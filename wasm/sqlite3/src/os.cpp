#include <sqlite3.h>

sqlite3_vfs vfs{
    .iVersion      = 3,
    .szOsFile      = sizeof(sqlite3_file),
    .mxPathname    = 128,
    .pNext         = nullptr,
    .zName         = "psibase",
    .pAppData      = nullptr,
    .xOpen         = nullptr,
    .xDelete       = nullptr,
    .xFullPathname = nullptr,
    .xDlOpen       = nullptr,
    .xDlSym        = nullptr,
    .xRandomness   = nullptr,
    .xSleep        = nullptr,
    .xCurrentTime  = nullptr,
    .xGetLastError = nullptr,

    .xCurrentTimeInt64 = nullptr,

    .xSetSystemCall  = nullptr,
    .xGetSystemCall  = nullptr,
    .xNextSystemCall = nullptr,
};

extern "C" int sqlite3_os_init(void)
{
   if (int err = sqlite3_vfs_register(&vfs, 1))
      return err;
   return SQLITE_OK;
}
extern "C" int sqlite3_os_end(void)
{
   return SQLITE_OK;
}
