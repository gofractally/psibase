#include <psibase/prefix.hpp>

#include <stdexcept>

#ifdef __APPLE__
#include <libproc.h>
#endif

std::filesystem::path psibase::installPrefix()
{
#ifdef __APPLE__
   int   ret;
   pid_t pid;
   char  pathbuf[2048];

   pid = getpid();
   ret = proc_pidpath(pid, pathbuf, sizeof(pathbuf));

   if (ret <= 0)
      throw std::runtime_error("unable to get process path");

   std::filesystem::path prefix(std::string(pathbuf, ret));
   prefix = prefix.parent_path();
#else
   auto prefix = std::filesystem::read_symlink("/proc/self/exe").parent_path();
#endif

   if (prefix.filename() == "bin")
   {
      prefix = prefix.parent_path();
   }
   return prefix;
}
