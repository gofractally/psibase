#include <psibase/api.hpp>

#include <psibase/Rpc.hpp>
#include <psibase/SocketInfo.hpp>

using namespace psibase;

namespace
{
   template <typename... T>
   std::int32_t socketOpenImpl(T&&... t)
   {
      auto args = psio::to_frac(std::tie(t...));
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
}  // namespace

std::int32_t psibase::socketOpen(const HttpRequest& request)
{
   return socketOpenImpl(request);
}

std::int32_t psibase::socketOpen(const HttpRequest& request, const std::optional<TLSInfo>& tls)
{
   return socketOpenImpl(request, tls);
}

std::int32_t psibase::socketOpen(const HttpRequest&                   request,
                                 const std::optional<TLSInfo>&        tls,
                                 const std::optional<SocketEndpoint>& endpoint)
{
   return socketOpenImpl(request, tls, endpoint);
}
