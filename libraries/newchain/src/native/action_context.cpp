#include <newchain/action_context.hpp>

namespace newchain
{
   action_context::action_context(newchain::transaction_context& transaction_context,
                                  const newchain::action&        action,
                                  newchain::action_trace&        action_trace)
       : transaction_context{transaction_context}, action{action}, action_trace{action_trace}
   {
   }

   void action_context::exec(bool is_auth)
   {
      try
      {
         auto& db = transaction_context.block_context.db;
         auto& ec = transaction_context.get_execution_context(action.contract);
         ec.exec(*this, is_auth);
      }
      catch (const std::exception& e)
      {
         action_trace.error = e.what();
         throw;
      }
   }

}  // namespace newchain
