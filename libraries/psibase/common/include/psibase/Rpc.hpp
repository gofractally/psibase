#pragma once

#include <psibase/block.hpp>
#include <string>
#include <vector>

namespace psibase
{
   /// An RPC Request
   ///
   /// Most contracts receive this via their `serveSys` action.
   /// [psibase::ProxySys] receives it via its `serve` exported function.
   struct RpcRequestData
   {
      std::string       host;         ///< Fully-qualified domain name
      std::string       rootHost;     ///< host, but without contract subdomain
      std::string       method;       ///< "GET" or "POST"
      std::string       target;       ///< Absolute path, e.g. "/index.js"
      std::string       contentType;  ///< "application/json", "text/html", ...
      std::vector<char> body;         ///< Request body, e.g. POST data
   };
   PSIO_REFLECT(RpcRequestData, host, rootHost, method, target, contentType, body)

   /// An RPC reply
   ///
   /// Contracts return this from their `serveSys` action.
   struct RpcReplyData
   {
      std::string       contentType;  ///< "application/json", "text/html", ...
      std::vector<char> body;         ///< Response body
   };
   PSIO_REFLECT(RpcReplyData, contentType, body)

}  // namespace psibase
