#include <psibase/fileUtil.hpp>

#include <cstdlib>
#include <limits>
#include <psibase/check.hpp>
#include <string>
#include <string_view>
#include <vector>

#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

std::vector<char> psibase::readWholeFile(std::string_view filename)
{
   auto fail = [&] { check(false, "read " + std::string(filename) + " failed"); };
   int  fd   = ::open(std::string(filename).c_str(), O_RDONLY);
   if (fd < 0)
      fail();
   struct stat stat;
   if (::fstat(fd, &stat) < 0)
      fail();
   if (stat.st_size > std::numeric_limits<std::size_t>::max())
      fail();
   std::vector<char> result(static_cast<std::size_t>(stat.st_size));
   char*             pos       = result.data();
   std::size_t       remaining = result.size();
   while (remaining)
   {
      auto count = ::read(fd, pos, remaining);
      if (count <= 0)
         fail();
      remaining -= count;
      pos += count;
   }
   ::close(fd);
   return result;
}
