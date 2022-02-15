#include <newchain/trace.hpp>

namespace newchain
{
   void trim_raw_data(action_trace& t, size_t max)
   {
      if (t.act.raw_data.size() > max)
         t.act.raw_data.resize(max);
      for (auto& inner : t.inner_traces)
         std::visit(
             [max](auto& obj) {
                if constexpr (std::is_same_v<eosio::remove_cvref_t<decltype(obj)>, action_trace>)
                   trim_raw_data(obj, max);
             },
             inner.inner);
   }

   transaction_trace trim_raw_data(transaction_trace t, size_t max)
   {
      for (auto& a : t.trx.actions)
         if (a.raw_data.size() > max)
            a.raw_data.resize(max);
      for (auto& at : t.action_traces)
         trim_raw_data(at, max);
      return t;
   }
}  // namespace newchain
