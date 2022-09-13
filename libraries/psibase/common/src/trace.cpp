#include <psibase/trace.hpp>

#include <psio/to_json.hpp>

namespace psibase
{
   void trimRawData(ActionTrace& t, size_t max)
   {
      if (t.action.rawData.size() > max)
         t.action.rawData.resize(max);
      for (auto& inner : t.innerTraces)
         std::visit(
             [max](auto& obj)
             {
                if constexpr (std::is_same_v<psio::remove_cvref_t<decltype(obj)>, ActionTrace>)
                   trimRawData(obj, max);
             },
             inner.inner);
   }

   TransactionTrace trimRawData(TransactionTrace t, size_t max)
   {
      for (auto& at : t.actionTraces)
         trimRawData(at, max);
      return t;
   }

   void prettyTrace(std::string& dest, const std::string& s, const std::string& indent)
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

   void prettyTrace(std::string& dest, const ConsoleTrace& t, const std::string& indent)
   {
      dest += indent + "console:    ";
      prettyTrace(dest, t.console, indent + "            ");
   }

   void prettyTrace(std::string& dest, const EventTrace& t, const std::string& indent)
   {
      dest += indent + "event\n";
   }

   void prettyTrace(std::string& dest, const ActionTrace& atrace, const std::string& indent)
   {
      dest += indent + "action:\n";
      dest += indent + "    " + atrace.action.sender.str() + " => " + atrace.action.service.str() +
              "::" + atrace.action.method.str() + "\n";
      dest += indent + "    " + psio::convert_to_json(atrace.action.rawData) + "\n";
      for (auto& inner : atrace.innerTraces)
         std::visit([&](auto& inner) { prettyTrace(dest, inner, indent + "    "); }, inner.inner);
      if (!atrace.rawRetval.empty())
         dest += indent + "    rawRetval: " + psio::convert_to_json(atrace.rawRetval) + "\n";
   }

   void prettyTrace(std::string& dest, const TransactionTrace& ttrace, const std::string& indent)
   {
      for (auto& a : ttrace.actionTraces)
         prettyTrace(dest, a, indent);
      if (!!ttrace.error)
      {
         dest += indent + "error:     ";
         prettyTrace(dest, *ttrace.error, indent + "           ");
      }
   }

   std::string prettyTrace(const ActionTrace& atrace, const std::string& indent)
   {
      std::string result;
      prettyTrace(result, atrace, indent);
      return result;
   }

   std::string prettyTrace(const TransactionTrace& ttrace, const std::string& indent)
   {
      std::string result;
      prettyTrace(result, ttrace, indent);
      return result;
   }
}  // namespace psibase
