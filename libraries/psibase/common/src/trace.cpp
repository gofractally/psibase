#include <psibase/trace.hpp>

#include <psibase/schema.hpp>
#include <psio/to_json.hpp>

namespace psibase
{
   namespace
   {
      template <typename S>
      struct PruneFormatter
      {
         S    base;
         void format_list(const auto& l, auto&& f)
         {
            std::size_t           i   = 0;
            constexpr std::size_t len = 5;
            for (const auto& item : l)
            {
               if (i != 0)
               {
                  base.write(',');
               }
               if (i >= len)
               {
                  std::string_view s{"…"};
                  base.write(s.data(), s.size());
                  break;
               }
               f(item);
               ++i;
            }
         }
         // \pre s is valid UTF-8
         // \post result is valud UTF-8
         // \post result.size() <= 20
         std::string_view prune_string(std::string_view s)
         {
            if (s.size() <= 20)
            {
               return s;
            }
            for (std::size_t i = 20; i > 0; --i)
            {
               if ((static_cast<unsigned char>(s[i]) & 0xC0) != 0x80)
               {
                  return s.substr(0, i);
               }
            }
            return s.substr(0, 0);
         }
         void operator()(const std::string& s)
         {
            auto pruned = prune_string(s);
            if (s.size() == pruned.size())
            {
               to_json(pruned, base);
            }
            else
            {
               to_json(std::string(pruned) + "…", base);
            }
         }
         void operator()(const psio::json::any_array& a)
         {
            base.write('[');
            format_list(a, *this);
            base.write(']');
         }
         void operator()(const psio::json::any_object& o)
         {
            base.write('{');
            format_list(o,
                        [this](const auto& entry)
                        {
                           to_json(entry.key, base);
                           write_colon(base);
                           (*this)(entry.value);
                        });
            base.write('}');
         }
         void operator()(const psio::json::any& value) { std::visit(*this, value.value()); }
      };
      void prettyValue(std::string& dest, const psio::json::any& value)
      {
         PruneFormatter{psio::string_stream{dest}}(value);
      }
   }  // namespace

   void trimRawData(ActionTrace& t, size_t max)
   {
      if (t.action.rawData.size() > max)
         t.action.rawData.resize(max);
      for (auto& inner : t.innerTraces)
         std::visit(
             [max](auto& obj)
             {
                if constexpr (std::is_same_v<std::remove_cvref_t<decltype(obj)>, ActionTrace>)
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

   void prettyTrace(std::string&        dest,
                    const ConsoleTrace& t,
                    const GetSchemaFn&  schemas,
                    const std::string&  indent)
   {
      dest += indent + "console:    ";
      prettyTrace(dest, t.console, indent + "            ");
   }

   void prettyTrace(std::string&       dest,
                    const EventTrace&  t,
                    const GetSchemaFn& schemas,
                    const std::string& indent)
   {
      dest += indent + "event\n";
   }

   void prettyTrace(std::string&       dest,
                    const ActionTrace& atrace,
                    const GetSchemaFn& schemas,
                    const std::string& indent)
   {
      dest += indent + "action:\n";
      dest += indent + "    " + atrace.action.sender.str() + " => " + atrace.action.service.str() +
              "::" + atrace.action.method.str() + "\n";
      if (auto schema = schemas(atrace.action.service))
      {
         auto pos = schema->actions.find(atrace.action.method.str());
         if (pos != schema->actions.end())
         {
            const auto& ty         = pos->second.params;
            const auto& rty        = pos->second.result;
            auto        extraTypes = std::vector{&ty};
            if (rty)
               extraTypes.push_back(&*rty);
            psio::schema_types::CompiledSchema cschema{schema->types, psibase_types(), extraTypes};
            psio::schema_types::FracParser     parser{psio::FracStream{atrace.action.rawData},
                                                      cschema.get(ty.resolve(schema->types)),
                                                      cschema.builtin};
            std::string                        tmp;
            auto                               stream = psio::string_stream{tmp};
            to_json(parser, stream);
            auto args = psio::convert_from_json<psio::json::any>(std::move(tmp));

            if (auto* args_obj = args.get_if<psio::json::any_object>())
            {
               for (const auto& [name, value] : *args_obj)
               {
                  dest += indent;
                  dest += "    ";
                  dest += name;
                  dest += ": ";
                  prettyValue(dest, value);
                  dest += "\n";
               }
            }
            else
            {
               dest += indent;
               dest += "    args: ";
               prettyValue(dest, args);
               dest += "\n";
            }
            if (!atrace.rawRetval.empty() && rty)
            {
               dest += indent;
               dest += "    retval: ";
               psio::schema_types::FracParser parser{psio::FracStream{atrace.rawRetval},
                                                     cschema.get(rty->resolve(schema->types)),
                                                     cschema.builtin};
               std::string                    tmp;
               auto                           stream = psio::string_stream{tmp};
               to_json(parser, stream);
               auto retval = psio::convert_from_json<psio::json::any>(std::move(tmp));
               prettyValue(dest, retval);
               dest += "\n";
            }
         }
      }
      dest += "\n";
      for (auto& inner : atrace.innerTraces)
         std::visit([&](auto& inner) { prettyTrace(dest, inner, schemas, indent + "    "); },
                    inner.inner);
   }

   void prettyTrace(std::string&            dest,
                    const TransactionTrace& ttrace,
                    const GetSchemaFn&      schemas,
                    const std::string&      indent)
   {
      for (auto& a : ttrace.actionTraces)
         prettyTrace(dest, a, schemas, indent);
      if (!!ttrace.error)
      {
         dest += indent + "error:     ";
         prettyTrace(dest, *ttrace.error, indent + "           ");
      }
   }

   std::string prettyTrace(const ActionTrace& atrace,
                           const GetSchemaFn& schemas,
                           const std::string& indent)
   {
      std::string result;
      prettyTrace(result, atrace, schemas, indent);
      return result;
   }

   std::string prettyTrace(const TransactionTrace& ttrace,
                           const GetSchemaFn&      schemas,
                           const std::string&      indent)
   {
      std::string result;
      prettyTrace(result, ttrace, schemas, indent);
      return result;
   }
}  // namespace psibase
