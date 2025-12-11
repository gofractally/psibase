#include "Tokens.hpp"

namespace UserService
{
   class RTokens : public psibase::Service
   {
     public:
      static constexpr auto service = psibase::AccountNumber("r-tokens");

      auto serveSys(psibase::HttpRequest                  request,
                    std::optional<std::int32_t>           socket,
                    std::optional<psibase::AccountNumber> user)
          -> std::optional<psibase::HttpReply>;

     private:
      std::optional<psibase::HttpReply> _serveRestEndpoints(psibase::HttpRequest& request);
   };
   PSIO_REFLECT(RTokens, method(serveSys, request, socket, user))
   PSIBASE_REFLECT_TABLES(RTokens)

}  // namespace UserService
