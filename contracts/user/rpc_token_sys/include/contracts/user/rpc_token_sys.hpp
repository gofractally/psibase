#include "token_sys.hpp"

namespace UserContract
{
   class RpcTokenSys : public psibase::Contract<RpcTokenSys>
   {
     public:
      static constexpr auto contract = psibase::AccountNumber("rpc-tok-sys");

      auto serveSys(psibase::RpcRequestData request) -> std::optional<psibase::RpcReplyData>;
      void storeSys(std::string path, std::string contentType, std::vector<char> content);
   };
   PSIO_REFLECT(RpcTokenSys,
                method(serveSys, request),
                method(storeSys, path, contentType, content))

}  // namespace UserContract
