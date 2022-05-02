#include <psibase/trace.hpp>

#include <psio/to_json.hpp>

namespace psibase
{
   void trim_raw_data(ActionTrace& t, size_t max)
   {
      if (t.action.rawData.size() > max)
         t.action.rawData.resize(max);
      for (auto& inner : t.inner_traces)
         std::visit(
             [max](auto& obj)
             {
                if constexpr (std::is_same_v<psio::remove_cvref_t<decltype(obj)>, ActionTrace>)
                   trim_raw_data(obj, max);
             },
             inner.inner);
   }

   TransactionTrace trim_raw_data(TransactionTrace t, size_t max)
   {
      for (auto& a : t.trx.transaction.actions)
         if (a.rawData.size() > max)
            a.rawData.resize(max);
      for (auto& at : t.action_traces)
         trim_raw_data(at, max);
      return t;
   }

   void pretty_trace(std::string& dest, const std::string& s, const std::string& indent)
   {
      std::string::size_type pos = 0;
      while (true)
      {
         auto nl = s.find_first_of("\n", pos);
         if (nl >= s.size())
            break;
         dest += s.substr(pos, nl - pos);
         pos = nl + 1;
         if (pos < s.size())
            dest += "\n" + indent;
      }
      dest += s.substr(pos) + "\n";
   }

   void pretty_trace(std::string& dest, const ConsoleTrace& t, const std::string& indent)
   {
      dest += indent + "console:    ";
      pretty_trace(dest, t.console, indent + "            ");
   }

   void pretty_trace(std::string& dest, const EventTrace& t, const std::string& indent)
   {
      dest += indent + "event\n";
   }

   void pretty_trace(std::string& dest, const ActionTrace& atrace, const std::string& indent)
   {
      dest += indent + "action:\n";
      dest += indent + "    " + atrace.action.sender.str() + " => " + atrace.action.contract.str() +
              "::" + atrace.action.method.str() + "\n";
      dest += indent + "    " + psio::convert_to_json(atrace.action.rawData) + "\n";
      for (auto& inner : atrace.inner_traces)
         std::visit([&](auto& inner) { pretty_trace(dest, inner, indent + "    "); }, inner.inner);
      if (!atrace.raw_retval.empty())
         dest += indent + "    raw_retval: " + psio::convert_to_json(atrace.raw_retval) + "\n";
   }

   void pretty_trace(std::string& dest, const TransactionTrace& ttrace, const std::string& indent)
   {
      for (auto& a : ttrace.action_traces)
         pretty_trace(dest, a, indent);
      if (!!ttrace.error)
      {
         dest += indent + "error:     ";
         pretty_trace(dest, *ttrace.error, indent + "           ");
      }
   }

   std::string pretty_trace(const ActionTrace& atrace, const std::string& indent)
   {
      std::string result;
      pretty_trace(result, atrace, indent);
      return result;
   }

   std::string pretty_trace(const TransactionTrace& ttrace, const std::string& indent)
   {
      std::string result;
      pretty_trace(result, ttrace, indent);
      return result;
   }
}  // namespace psibase
