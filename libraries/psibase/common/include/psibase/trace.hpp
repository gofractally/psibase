#pragma once

#include <psibase/block.hpp>

namespace psibase
{
   struct inner_trace;

   // TODO: Receipts & Merkles. Receipts need sequence numbers, resource consumption, and events.
   struct ActionTrace
   {
      Action                     action;
      std::vector<char>          raw_retval;  // TODO: Move to receipt?
      std::vector<inner_trace>   inner_traces;
      std::optional<std::string> error;
   };
   PSIO_REFLECT(ActionTrace, action, raw_retval, inner_traces, error)

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

   struct inner_trace
   {
      std::variant<ConsoleTrace, EventTrace, ActionTrace> inner;
   };
   PSIO_REFLECT(inner_trace, inner)

   // TODO: Receipts & Merkles. Receipts need sequence numbers, resource consumption, and events.
   struct TransactionTrace
   {
      SignedTransaction          trx;
      std::vector<ActionTrace>   action_traces;
      std::optional<std::string> error;
   };
   PSIO_REFLECT(TransactionTrace, trx, action_traces, error)

   void             trim_raw_data(ActionTrace& t, size_t max = 32);
   TransactionTrace trim_raw_data(TransactionTrace t, size_t max = 32);

   void pretty_trace(std::string& dest, const std::string& s, const std::string& indent = "");
   void pretty_trace(std::string& dest, const ConsoleTrace& t, const std::string& indent = "");
   void pretty_trace(std::string& dest, const EventTrace& t, const std::string& indent = "");
   void pretty_trace(std::string& dest, const ActionTrace& atrace, const std::string& indent = "");
   void pretty_trace(std::string&            dest,
                     const TransactionTrace& ttrace,
                     const std::string&      indent = "");
   std::string pretty_trace(const ActionTrace& atrace, const std::string& indent = "");
   std::string pretty_trace(const TransactionTrace& ttrace, const std::string& indent = "");
}  // namespace psibase
