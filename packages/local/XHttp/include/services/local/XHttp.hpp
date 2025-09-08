#pragma once

#include <psibase/Service.hpp>
#include <psibase/Table.hpp>
#include <services/system/HttpServer.hpp>

namespace LocalService
{
   using SystemService::PendingRequestRow;
   using SystemService::PendingRequestTable;

   struct XHttp : psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber{"x-http"};

      using Subjective = psibase::SubjectiveTables<PendingRequestTable>;

      static psibase::AccountNumber getService(std::string_view host, std::string_view rootHost)
      {
         if (host.size() > rootHost.size() + 1 && host.ends_with(rootHost) &&
             host[host.size() - rootHost.size() - 1] == '.')
         {
            std::string_view serviceName(host);
            serviceName.remove_suffix(rootHost.size() + 1);
            return psibase::AccountNumber{serviceName};
         }
         return {};
      }
      static psibase::AccountNumber getService(const psibase::HttpRequest& req)
      {
         return getService(req.host, req.rootHost);
      }
      static psibase::AccountNumber getService(psio::view<const psibase::HttpRequest> req)
      {
         return getService(req.host(), req.rootHost());
      }

      /// Sends a message to a socket. HTTP sockets should use sendReply, instead.
      void send(std::int32_t socket, psio::view<const std::vector<char>> data);

      /// Enables or disables automatic closing of the socket
      /// when the transaction context exits.
      ///
      /// Can be called inside `PSIBASE_SUBJECTIVE_TX`
      void autoClose(std::int32_t socket, bool value);

      /// Sends an HTTP response. The socket must have autoClose enabled.
      void sendReply(std::int32_t socket, const psibase::HttpReply& response);
   };
   PSIO_REFLECT(XHttp,
                method(send, socket, data),
                method(autoClose, socket, value),
                method(sendReply, socket, response))

   PSIBASE_REFLECT_TABLES(XHttp, XHttp::Subjective)
}  // namespace LocalService
