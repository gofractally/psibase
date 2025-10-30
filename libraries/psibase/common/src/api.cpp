#include <psibase/api.hpp>

#include <psibase/Rpc.hpp>

using namespace psibase;

std::int32_t psibase::socketOpen(const HttpRequest& request)
{
   auto args = psio::to_frac(std::tie(request));
   if (auto res = raw::socketOpen(args.data(), args.size()); res >= 0)
   {
      return res;
   }
   else
   {
      errno = -res;
      return -1;
   }
}
