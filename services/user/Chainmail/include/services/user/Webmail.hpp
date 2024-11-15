#pragma once

#include <psibase/psibase.hpp>

#include <services/system/CommonTables.hpp>

namespace UserService
{
   class Chainmail : public psibase::Service<Chainmail>
   {
     public:
      static constexpr auto service = psibase::AccountNumber("chainmail");

      Chainmail(psio::shared_view_ptr<psibase::Action> action);

      void init();

      void send(psibase::AccountNumber receiver,
                const std::string&     subject,
                const std::string&     body);

      std::optional<psibase::HttpReply> serveSys(psibase::HttpRequest request);

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
   PSIO_REFLECT(Chainmail,
      method(init),
      method(send, receiver, subject, body),
      method(serveSys, request)
   );
   PSIBASE_REFLECT_EVENTS(Chainmail);
   PSIBASE_REFLECT_HISTORY_EVENTS(Chainmail,
      method(sent, sender, receiver, subject, body),
   );
   PSIBASE_REFLECT_UI_EVENTS(Chainmail);
   PSIBASE_REFLECT_MERKLE_EVENTS(Chainmail);
   // clang-format on

}  // namespace UserService
