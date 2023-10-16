#pragma once

#include <psibase/block.hpp>

#include <psio/chrono.hpp>

namespace psibase
{
   struct InnerTrace;

   // TODO: Receipts & Merkles. Receipts need sequence numbers, resource consumption, and events.
   struct ActionTrace
   {
      Action                     action;
      std::vector<char>          rawRetval;  // TODO: Move to receipt?
      std::vector<InnerTrace>    innerTraces;
      std::chrono::nanoseconds   totalTime;  // includes time in inner actions
      std::optional<std::string> error;
   };
   PSIO_REFLECT(ActionTrace, action, rawRetval, innerTraces, totalTime, error)

   // TODO: need event definitions in ABI
   struct EventTrace
   {
      std::string       name;  // TODO: eosio::name?
      std::vector<char> data;
   };
   PSIO_REFLECT(EventTrace, name, data)

   struct ConsoleTrace
   {
      std::string console;
   };
   PSIO_REFLECT(ConsoleTrace, console)

   struct InnerTrace
   {
      std::variant<ConsoleTrace, EventTrace, ActionTrace> inner;
   };
   PSIO_REFLECT(InnerTrace, inner)

   // TODO: Receipts & Merkles. Receipts need sequence numbers, resource consumption, and events.
   struct TransactionTrace
   {
      std::vector<ActionTrace>   actionTraces;
      std::optional<std::string> error;
   };
   PSIO_REFLECT(TransactionTrace, actionTraces, error)

   void             trimRawData(ActionTrace& t, size_t max = 32);
   TransactionTrace trimRawData(TransactionTrace t, size_t max = 32);

   void prettyTrace(std::string& dest, const std::string& s, const std::string& indent = "");
   void prettyTrace(std::string& dest, const ConsoleTrace& t, const std::string& indent = "");
   void prettyTrace(std::string& dest, const EventTrace& t, const std::string& indent = "");
   void prettyTrace(std::string& dest, const ActionTrace& atrace, const std::string& indent = "");
   void prettyTrace(std::string&            dest,
                    const TransactionTrace& ttrace,
                    const std::string&      indent = "");
   std::string prettyTrace(const ActionTrace& atrace, const std::string& indent = "");
   std::string prettyTrace(const TransactionTrace& ttrace, const std::string& indent = "");
}  // namespace psibase
