#pragma once

#include <psibase/psibase.hpp>

#include <services/system/CommonTables.hpp>

namespace UserService
{
   class Email : public psibase::Service<Email>
   {
     public:
      using Tables = psibase::ServiceTables<InitTable, psibase::WebContentTable>;

      static constexpr auto service = psibase::AccountNumber("email");

      Email(psio::shared_view_ptr<psibase::Action> action);

      void init();

      void send(psibase::AccountNumber recipient,
                const std::string&     subject,
                const std::string&     body);

      std::optional<psibase::HttpReply> serveSys(psibase::HttpRequest request);
      void storeSys(std::string path, std::string contentType, std::vector<char> content);

      // clang-format off
      struct Events
      {
         struct History
         {
            void sent(psibase::AccountNumber sender, psibase::AccountNumber recipient, std::string subject, std::string body) {}
         };
         struct Ui{};
         struct Merkle{};
      };
      // clang-format on
   };

   // clang-format off
   PSIO_REFLECT(Email,
      method(init),
      method(send, recipient, subject, body),
      method(serveSys, request),
      method(storeSys, path, contentType, content)
   );
   PSIBASE_REFLECT_EVENTS(Email);
   PSIBASE_REFLECT_HISTORY_EVENTS(Email,
      method(sent, sender, recipient, subject, body),
   );
   PSIBASE_REFLECT_UI_EVENTS(Email);
   PSIBASE_REFLECT_MERKLE_EVENTS(Email);
   // clang-format on

}  // namespace UserService
