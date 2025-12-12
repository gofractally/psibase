#pragma once

#include <psibase/psibase.hpp>

#include <services/system/CommonTables.hpp>

namespace UserService
{
   class Chainmail : public psibase::Service
   {
     public:
      static constexpr auto service = psibase::AccountNumber("chainmail");

      Chainmail(psio::shared_view_ptr<psibase::Action> action);

      void init();

      void send(psibase::AccountNumber receiver,
                const std::string&     subject,
                const std::string&     body);

      void archive(std::uint64_t msg_id);

      void save(std::uint64_t          msg_id,
                psibase::AccountNumber receiver,
                psibase::AccountNumber sender,
                std::string            subject,
                std::string            body,
                std::int64_t           datetime);

      void unsave(std::uint64_t          msg_id,
                  psibase::AccountNumber sender,
                  std::string            subject,
                  std::string            body,
                  std::int64_t           datetime);

      std::optional<psibase::HttpReply> serveSys(psibase::HttpRequest request);

      // clang-format off
      struct Events
      {
         struct History
         {
            void sent(psibase::AccountNumber sender, psibase::AccountNumber receiver, std::string subject, std::string body, psibase::TimePointSec datetime) {}
            void archive(std::string msg_id) {}
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
      method(archive, msg_id),
      method(save, msg_id, receiver, sender, subject, body, datetime),
      method(unsave, msg_id, sender, subject, body, datetime),
      method(serveSys, request)
   );
   PSIBASE_REFLECT_EVENTS(Chainmail);
   PSIBASE_REFLECT_HISTORY_EVENTS(Chainmail,
      method(sent, sender, receiver, subject, body, datetime),
      method(archive, msg_id),
   );
   PSIBASE_REFLECT_UI_EVENTS(Chainmail);
   PSIBASE_REFLECT_MERKLE_EVENTS(Chainmail);
   // clang-format on

}  // namespace UserService
