#include "TokenSys.hpp"

namespace UserContract
{
   class RTokenSys : public psibase::Contract<RTokenSys>
   {
     public:
      static constexpr auto contract = psibase::AccountNumber("r-tok-sys");

      auto serveSys(psibase::RpcRequestData request) -> std::optional<psibase::RpcReplyData>;
      void storeSys(std::string path, std::string contentType, std::vector<char> content);

     private:
      std::optional<psibase::RpcReplyData> _serveRestEndpoints(psibase::RpcRequestData& request);
   };
   PSIO_REFLECT(RTokenSys, method(serveSys, request), method(storeSys, path, contentType, content))

}  // namespace UserContract
