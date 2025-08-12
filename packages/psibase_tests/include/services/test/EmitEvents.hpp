#pragma once

#include <psibase/psibase.hpp>

namespace TestService
{

   struct ExampleRecord
   {
      uint32_t    count;
      int32_t     value;
      std::string message;

      auto operator<=>(const ExampleRecord& other) const = default;
   };
   PSIO_REFLECT(ExampleRecord, count, value, message);

   struct EmitEvents : psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber{"event-service"};

      struct Events
      {
         struct History
         {
            void e(std::string s, int i);
            void e2(ExampleRecord r);
         };
         struct Ui
         {
         };
         struct Merkle
         {
            void m(std::string s);
         };
      };

      void init();

      psibase::EventNumber foo(std::string s, int i);
      void                 foo2(std::string s, int i);
      psibase::EventNumber emitMerkle(std::string);
      psibase::EventNumber emitFail(std::string s, int i);
      void                 emitExample(ExampleRecord r);

      auto serveSys(psibase::HttpRequest request) -> std::optional<psibase::HttpReply>;
   };

   PSIO_REFLECT(EmitEvents,  //
                method(init),
                method(foo, s, i),
                method(foo2, s, i),
                method(emitMerkle, s),
                method(emitFail, s, i),
                method(emitExample, r),
                method(serveSys, request))

   PSIBASE_REFLECT_EVENTS(EmitEvents)
   PSIBASE_REFLECT_HISTORY_EVENTS(EmitEvents,  //
                                  method(e, s, i),
                                  method(e2, r))
   PSIBASE_REFLECT_UI_EVENTS(EmitEvents)
   PSIBASE_REFLECT_MERKLE_EVENTS(EmitEvents,  //
                                 method(m, s))
   PSIBASE_REFLECT_TABLES(EmitEvents)

}  // namespace TestService
