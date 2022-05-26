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
      /// Handle HTTP requests
      ///
      /// Define this action in your contract to handle HTTP requests. You'll also need to
      /// [register your contract](#registration).
      ///
      /// `serveSys` can do any of the following:
      ///
      /// - Return `std::nullopt` to signal not found. psinode produces a 404 response in this case.
      /// - Abort. psinode produces a 500 response with the contract's abort message.
      /// - Return a [psibase::RpcReplyData]. psinode produces a 200 response with the body and contentType returned.
      /// - Call other contracts.
      ///
      /// A contract runs in RPC mode while serving an HTTP request. This mode prevents database writes,
      /// but allows database reads, including reading data and events which are normally not available
      /// to contracts; see [psibase::DbId].
      //
      // Note: intentionally doesn't use psio::const_view, since that complicates documentation.
      //       implementations of this interface may, of course, use it.
      std::optional<RpcReplyData> serveSys(RpcRequestData request);
   };
   PSIO_REFLECT(ServerInterface, method(serveSys, request))

   /// Interface for contracts which support storing files
   ///
   /// Some contracts support storing files which they then serve via HTTP.
   /// This is the standard interface for these contracts.
   ///
   /// Do **not** inherit from this. To implement this interface, add a [storeSys] action
   /// to your contract and reflect it.
   struct StorageInterface
   {
      /// Store a file
      ///
      /// Define this action in your contract to handle file storage requests. This action
      /// should store the file in the contract's tables. The contract can then serve these
      /// files via HTTP.
      ///
      /// - `path`: absolute path to file. e.g. `/` for the main page and `/index.js` for its script.
      /// - `contentType`: `text/html`, `text/javascript`, `application/octet-stream`, ...
      /// - `content`: file content
      ///
      /// The `psibase upload` command uses this action.
      ///
      /// [storeContent] simplifies implementing this.
      //
      // Note: intentionally doesn't use psio::const_view, since that complicates documentation.
      //       implementations of this interface may, of course, use it.
      void storeSys(std::string_view path, std::string_view contentType, std::vector<char> content);
   };
   PSIO_REFLECT(StorageInterface, method(storeSys, path, contentType, content))
}  // namespace psibase
