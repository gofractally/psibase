#pragma once

#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>
#include <psibase/Table.hpp>

#include <cstdint>
#include <optional>
#include <string>

namespace TestService
{
   /// A row whose text is declared: UTF-8 of at most 8 bytes.
   struct NoteRow
   {
      std::uint32_t id;
      std::string   text;
      PSIO_REFLECT(NoteRow, id, attr(text, utf8 | max<8>))
   };
   using NoteTable = psibase::Table<NoteRow, &NoteRow::id>;

   /// Where PSIO's two read modes and two write modes meet the boundaries of
   /// a service (gofractally/psibase#2281, gofractally/psio#14).
   ///
   /// An action argument and an HTTP body come from outside: they are
   /// validated against what their type declares. A row of the service's own
   /// table is written with the fast write and read trusted: neither holds
   /// the row against its declaration.
   struct TestModes : psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber{"test-modes"};
      using Tables                  = psibase::ServiceTables<NoteTable>;

      /// The argument is declared as the row's text is: the dispatcher
      /// refuses any other bytes. Returns the length of the text.
      std::uint32_t declared(std::string text);
      /// The argument declares nothing. The row is written as it is
      /// (`Table::put`, the fast write), whatever `NoteRow` declares.
      void store(std::uint32_t id, std::string text);
      /// The same row through the validated write (`psio::to_pssz_checked`):
      /// aborts unless the row is what `NoteRow` declares.
      void storeChecked(std::uint32_t id, std::string text);
      /// The length of the text of row `id`, read as a service reads its own
      /// table (`Table::get`, the trusted read)
      std::uint32_t length(std::uint32_t id);
      /// Whether the stored bytes of row `id` are a valid `NoteRow`
      /// (`psio::validate_pssz`): what a reader that does not trust the row
      /// asks.
      bool valid(std::uint32_t id);

      /// POST /note with a JSON `NoteRow`: the body is validated, then stored
      std::optional<psibase::HttpReply> serveSys(const psibase::HttpRequest& request);
   };
   PSIO_REFLECT(TestModes,
                method(declared, attr(text, utf8 | max<8>)),
                method(store, id, text),
                method(storeChecked, id, text),
                method(length, id),
                method(valid, id),
                method(serveSys, request))
}  // namespace TestService
