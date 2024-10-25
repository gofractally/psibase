#include <services/system/RSetCode.hpp>

#include <psibase/dispatch.hpp>
#include <psibase/serveSchema.hpp>
#include <services/system/SetCode.hpp>

namespace SystemService
{

   std::optional<psibase::HttpReply> RSetCode::serveSys(psibase::HttpRequest request)
   {
      if (auto result = psibase::serveSchema<SetCode>(request))
         return result;
      return {};
   }
}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::RSetCode)
