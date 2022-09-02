#include "TokenSys.hpp"

namespace UserContract
{
   class RTokenSys : public psibase::Service<RTokenSys>
   {
     public:
      static constexpr auto service = psibase::AccountNumber("r-tok-sys");

      auto serveSys(psibase::HttpRequest request) -> std::optional<psibase::HttpReply>;
      void storeSys(std::string path, std::string contentType, std::vector<char> content);

     private:
      std::optional<psibase::HttpReply> _serveRestEndpoints(psibase::HttpRequest& request);
   };
   PSIO_REFLECT(RTokenSys, method(serveSys, request), method(storeSys, path, contentType, content))

}  // namespace UserContract
