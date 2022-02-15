#pragma once

#include <newchain/block.hpp>

namespace newchain
{
   struct inner_trace;

   // TODO: Receipts & Merkles. Receipts need sequence numbers, resource consumption, and events.
   struct action_trace
   {
      action                     act;
      account_num                auth_contract = 0;  // non-0: called instead of act.contract
      std::vector<char>          retval;             // TODO: Move to receipt?
      std::vector<inner_trace>   inner_traces;
      std::optional<std::string> error;
   };
   EOSIO_REFLECT(action_trace, act, auth_contract, retval, inner_traces, error)

   // TODO: need event definitions in ABI
   struct event_trace
   {
      std::string       name;  // TODO: eosio::name?
      std::vector<char> data;
   };
   EOSIO_REFLECT(event_trace, name, data)

   struct console_trace
   {
      std::vector<char> console;
   };
   EOSIO_REFLECT(console_trace, console)

   struct inner_trace
   {
      std::variant<console_trace, event_trace, action_trace> inner;
   };
   EOSIO_REFLECT(inner_trace, inner)

   // TODO: Receipts & Merkles. Receipts need sequence numbers, resource consumption, and events.
   struct transaction_trace
   {
      signed_transaction         trx;
      std::vector<action_trace>  action_traces;
      std::optional<std::string> error;
   };
   EOSIO_REFLECT(transaction_trace, trx, action_traces, error)

   void              trim_raw_data(action_trace& t, size_t max = 32);
   transaction_trace trim_raw_data(transaction_trace t, size_t max = 32);
}  // namespace newchain
