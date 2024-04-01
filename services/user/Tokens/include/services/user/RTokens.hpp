#include "Tokens.hpp"

namespace UserService
{
   class RTokens : public psibase::Service<RTokens>
   {
     public:
      static constexpr auto service = psibase::AccountNumber("r-tok-sys");

      auto serveSys(psibase::HttpRequest request) -> std::optional<psibase::HttpReply>;
      void storeSys(std::string path, std::string contentType, std::vector<char> content);

     private:
      std::optional<psibase::HttpReply> _serveRestEndpoints(psibase::HttpRequest& request);
   };
   PSIO_REFLECT(RTokens, method(serveSys, request), method(storeSys, path, contentType, content))

}  // namespace UserService
