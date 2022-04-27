#pragma once

#include <psibase/block.hpp>

namespace psibase
{
   struct inner_trace;

   // TODO: Receipts & Merkles. Receipts need sequence numbers, resource consumption, and events.
   struct action_trace
   {
      action                     act;
      std::vector<char>          raw_retval;  // TODO: Move to receipt?
      std::vector<inner_trace>   inner_traces;
      std::optional<std::string> error;
   };
   PSIO_REFLECT(action_trace, act, raw_retval, inner_traces, error)

   // TODO: need event definitions in ABI
   struct event_trace
   {
      std::string       name;  // TODO: eosio::name?
      std::vector<char> data;
   };
   PSIO_REFLECT(event_trace, name, data)

   struct console_trace
   {
      std::string console;
   };
   PSIO_REFLECT(console_trace, console)

   struct inner_trace
   {
      std::variant<console_trace, event_trace, action_trace> inner;
   };
   PSIO_REFLECT(inner_trace, inner)

   // TODO: Receipts & Merkles. Receipts need sequence numbers, resource consumption, and events.
   struct transaction_trace
   {
      signed_transaction         trx;
      std::vector<action_trace>  action_traces;
      std::optional<std::string> error;
   };
   PSIO_REFLECT(transaction_trace, trx, action_traces, error)

   void              trim_raw_data(action_trace& t, size_t max = 32);
   transaction_trace trim_raw_data(transaction_trace t, size_t max = 32);

   void pretty_trace(std::string& dest, const std::string& s, const std::string& indent = "");
   void pretty_trace(std::string& dest, const console_trace& t, const std::string& indent = "");
   void pretty_trace(std::string& dest, const event_trace& t, const std::string& indent = "");
   void pretty_trace(std::string& dest, const action_trace& atrace, const std::string& indent = "");
   void pretty_trace(std::string&             dest,
                     const transaction_trace& ttrace,
                     const std::string&       indent = "");
   std::string pretty_trace(const action_trace& atrace, const std::string& indent = "");
   std::string pretty_trace(const transaction_trace& ttrace, const std::string& indent = "");
}  // namespace psibase
