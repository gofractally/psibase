#include <psibase/Contract.hpp>
#include <psibase/contractEntry.hpp>

namespace psibase
{
   /// Interface for contracts which serve http
   ///
   /// `proxy.sys` uses this interface to call into contracts to respond to http requests.
   ///
   /// Do **not** inherit from this. To implement this interface, add a [serveSys] action
   /// to your contract and reflect it.
   struct ServerInterface
   {
      // Note: intentionally doesn't use psio::const_view, since that complicates documentation.
      //       implementations of this interface may, of course, use it.
      std::optional<RpcReplyData> serveSys(RpcRequestData request);
   };
   PSIO_REFLECT(ServerInterface, method(serveSys, request))

   /// Interface for contracts which support uploading files
   struct ServerUploadInterface
   {
      // Note: intentionally doesn't use psio::const_view, since that complicates documentation.
      //       implementations of this interface may, of course, use it.
      void uploadSys(std::string_view         path,
                     std::string_view         contentType,
                     const std::vector<char>& content);
   };
   PSIO_REFLECT(ServerUploadInterface, method(uploadSys, path, contentType, content))
}  // namespace psibase
