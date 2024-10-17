#include "Tokens.hpp"

namespace UserService
{
   class RTokens : public psibase::Service
   {
     public:
      static constexpr auto service = psibase::AccountNumber("r-tokens");

      auto serveSys(psibase::HttpRequest request) -> std::optional<psibase::HttpReply>;

     private:
      std::optional<psibase::HttpReply> _serveRestEndpoints(psibase::HttpRequest& request);
   };
   PSIO_REFLECT(RTokens, method(serveSys, request))

}  // namespace UserService
