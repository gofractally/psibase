#include <unistd.h>
#include <wasi/api.h>
#include <cstdlib>
#include "polyfill.hpp"

namespace
{
   struct InitCwd
   {
      InitCwd()
      {
         if (char* pwd = std::getenv("PWD"))
         {
            ::chdir(pwd);
         }
      }
   };
   InitCwd initCwd;

   [[clang::import_module("wasi_snapshot_preview1"), clang::import_name("path_open")]]
   __wasi_errno_t real_wasi_path_open(__wasi_fd_t          fd,
                                      __wasi_lookupflags_t dirflags,
                                      const char*          path,
                                      size_t               path_len,
                                      __wasi_oflags_t      oflags,
                                      __wasi_rights_t      fs_rights_base,
                                      __wasi_rights_t      fs_rights_inheriting,
                                      __wasi_fdflags_t     fdflags,
                                      __wasi_fd_t*         opened_fd);
}  // namespace

extern "C" __wasi_errno_t POLYFILL_NAME(path_open)(__wasi_fd_t          fd,
                                                   __wasi_lookupflags_t dirflags,
                                                   const char*          path,
                                                   size_t               path_len,
                                                   __wasi_oflags_t      oflags,
                                                   __wasi_rights_t      fs_rights_base,
                                                   __wasi_rights_t      fs_rights_inheriting,
                                                   __wasi_fdflags_t     fdflags,
                                                   __wasi_fd_t*         opened_fd)
    __attribute__((__import_module__("wasi_snapshot_preview1"), __import_name__("path_open")))
{
   return real_wasi_path_open(fd, dirflags, path, path_len, oflags, fs_rights_base,
                              fs_rights_inheriting, fdflags, opened_fd);
}
