#pragma once

#include <psibase/psibase.hpp>

#include <services/system/CommonTables.hpp>

namespace UserService
{
   class Webmail : public psibase::Service<Webmail>
   {
     public:
      using Tables = psibase::ServiceTables<InitTable, psibase::WebContentTable>;

      static constexpr auto service = psibase::AccountNumber("webmail");

      Webmail(psio::shared_view_ptr<psibase::Action> action);

      void init();

      void send(psibase::AccountNumber receiver,
                const std::string&     subject,
                const std::string&     body);

      std::optional<psibase::HttpReply> serveSys(psibase::HttpRequest request);
      void storeSys(std::string path, std::string contentType, std::vector<char> content);

      // clang-format off
      struct Events
      {
         struct History
         {
            void sent(psibase::AccountNumber sender, psibase::AccountNumber receiver, std::string subject, std::string body) {}
         };
         struct Ui{};
         struct Merkle{};
      };
      // clang-format on
   };

   // clang-format off
   PSIO_REFLECT(Webmail,
      method(init),
      method(send, receiver, subject, body),
      method(serveSys, request),
      method(storeSys, path, contentType, content)
   );
   PSIBASE_REFLECT_EVENTS(Webmail);
   PSIBASE_REFLECT_HISTORY_EVENTS(Webmail,
      method(sent, sender, receiver, subject, body),
   );
   PSIBASE_REFLECT_UI_EVENTS(Webmail);
   PSIBASE_REFLECT_MERKLE_EVENTS(Webmail);
   // clang-format on

}  // namespace UserService
