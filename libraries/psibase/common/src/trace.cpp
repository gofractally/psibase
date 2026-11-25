#include <psibase/trace.hpp>

#include <psibase/nativeTables.hpp>
#include <psibase/schema.hpp>
#include <psio/to_hex.hpp>

namespace psibase
{
   namespace
   {
      namespace ir = psio::pssz_ir;

      // \pre s is valid UTF-8
      // \post result is valid UTF-8
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

      // Writes a JSON value with long strings and lists cut short
      struct PruneFormatter
      {
         std::string& dest;
         void         format_list(const auto& l, auto&& f)
         {
            std::size_t           i   = 0;
            constexpr std::size_t len = 5;
            for (const auto& item : l)
            {
               if (i != 0)
               {
                  dest += ',';
               }
               if (i >= len)
               {
                  dest += "…";
                  break;
               }
               f(item);
               ++i;
            }
         }
         void operator()(const std::string& s)
         {
            auto pruned = prune_string(s);
            if (s.size() == pruned.size())
               dest += psio::to_json(s);
            else
               dest += psio::to_json(std::string(pruned) + "…");
         }
         void operator()(const psio::json_value::array& a)
         {
            dest += '[';
            format_list(a, [this](const auto& item) { (*this)(item); });
            dest += ']';
         }
         void operator()(const psio::json_value::object& o)
         {
            dest += '{';
            format_list(o,
                        [this](const auto& entry)
                        {
                           dest += psio::to_json(entry.first);
                           dest += ':';
                           (*this)(entry.second);
                        });
            dest += '}';
         }
         void operator()(std::monostate) { dest += "null"; }
         void operator()(bool b) { dest += b ? "true" : "false"; }
         void operator()(const psio::json_numeral& n) { dest += n.text; }
         void operator()(const psio::json_value& value) { std::visit(*this, value.value); }
      };

      void prettyValue(std::string& dest, const psio::json_value& value)
      {
         PruneFormatter{dest}(value);
      }

      const std::string& prettyMethod(const GetSchemaFn& schemas,
                                      AccountNumber      service,
                                      MethodNumber       method,
                                      std::string&       storage)
      {
         if (schemas)
            if (auto* schema = schemas(service))
               if (auto* action = schema->findAction(method))
                  return action->first;
         storage = method.str();
         return storage;
      }

      bool hideAction(const Action& action)
      {
         return action.service == AccountNumber{"db"} && action.method == MethodNumber("open") ||
                action.service == AccountNumber{"transact"} &&
                    action.method == MethodNumber("kvNotify");
      }

      bool hideTrace(const ActionTrace& trace)
      {
         return hideAction(trace.action);
      }
      bool hideTrace(const ConsoleTrace& trace)
      {
         return false;
      }

      psio::codec_status handlerError(std::string message, std::string_view type)
      {
         return psio::codec_fail_owned(message, 0, type);
      }

      // The text of `value` in the format of the walk
      template <typename T>
      std::string jsonText(const T& value, const ir::JsonContext& ctx)
      {
         return ctx.ijson ? psio::to_ijson(value) : psio::to_json(value);
      }

      // The arguments of an action as JSON, by the schema of the service
      psio::codec_status argsToJson(const ServiceSchema&              schema,
                                    const psio::schema_types::AnyType& params,
                                    std::span<const char>             rawData,
                                    const ir::JsonContext&            ctx,
                                    std::string&                      out)
      {
         if (ctx.ijson)
            return ir::pssz_to_json(schema.types, params, psio::ijson{}, rawData, out, nullptr,
                                    ctx.handlers);
         else
            return ir::pssz_to_json(schema.types, params, psio::json{}, rawData, out, nullptr,
                                    ctx.handlers);
      }

      psio::codec_status argsFromJson(const ServiceSchema&               schema,
                                      const psio::schema_types::AnyType& params,
                                      std::string_view                   text,
                                      bool                               ijson,
                                      const ir::CustomHandlers*          handlers,
                                      std::vector<char>&                 out)
      {
         std::span<const char> span{text.data(), text.size()};
         if (ijson)
            return ir::json_to_pssz(schema.types, params, psio::ijson{}, span, out, nullptr,
                                    psio::json_parser::automatic, handlers);
         else
            return ir::json_to_pssz(schema.types, params, psio::json{}, span, out, nullptr,
                                    psio::json_parser::automatic, handlers);
      }

      psio::codec_status accountFromText(const std::string& name, AccountNumber& out)
      {
         out = AccountNumber{};
         if (!name.empty())
         {
            out = AccountNumber{std::string_view{name}};
            if (out == AccountNumber{})
               return handlerError("invalid account: " + name, "Action");
         }
         return psio::codec_ok();
      }

      psio::codec_status toActionImpl(PrettyAction&&            in,
                                      const GetSchemaFn&        schemas,
                                      const ir::CustomHandlers* handlers,
                                      bool                      ijson,
                                      bool                      defaultData,
                                      Action&                   out)
      {
         if (auto status = accountFromText(in.sender, out.sender); !status.ok())
            return status;
         if (auto status = accountFromText(in.service, out.service); !status.ok())
            return status;
         if (out.service == AccountNumber{})
            return handlerError("Invalid service account " + in.service, "Action");
         out.method = MethodNumber{in.method};
         if (in.rawData && !in.data)
         {
            out.rawData = std::move(*in.rawData);
            return psio::codec_ok();
         }
         if (!in.data)
         {
            if (!defaultData)
               return handlerError("Missing field rawData", "Action");
            in.data.emplace(psio::json_value::object{});
         }
         const ServiceSchema* schema = schemas ? schemas(out.service) : nullptr;
         if (!schema)
            return handlerError("Cannot find schema for " + in.service, "Action");
         auto* action = schema->findAction(out.method);
         if (!action)
            return handlerError("Action not found: " + in.service + "::" + in.method, "Action");
         out.rawData.clear();
         auto text = ijson ? psio::to_ijson(*in.data) : psio::to_json(*in.data);
         if (auto status =
                 argsFromJson(*schema, *action->second.params, text, ijson, handlers, out.rawData);
             !status.ok())
            return handlerError(in.service + "::" + in.method + ": " +
                                    std::string(status.error().what),
                                "Action");
         return psio::codec_ok();
      }

      struct PrettyServiceMethod
      {
         std::string service;
         std::string method;
      };
      PSIO_REFLECT(PrettyServiceMethod, service, method)
   }  // namespace

   psio::pssz_ir::CustomHandlers action_types(
       GetSchemaFn                                                     schemas,
       std::function<void(AccountNumber sender, AccountNumber service)> onAction)
   {
      auto result = psibase_types();
      result.add(
          "ServiceMethod",
          {.to_json =
               [schemas](std::span<const char> pssz, const ir::JsonContext& ctx, std::string& json)
           {
              auto        value = psio::from_pssz<ServiceMethod>(psio::trusted{pssz});
              std::string storage;
              json += jsonText(
                  PrettyServiceMethod{.service = value.service.str(),
                                      .method =
                                          prettyMethod(schemas, value.service, value.method, storage)},
                  ctx);
              return psio::codec_ok();
           },
           .from_json =
               [](std::string_view json, const ir::JsonContext& ctx, std::vector<char>& pssz)
           {
              PrettyServiceMethod   in;
              std::span<const char> text{json.data(), json.size()};
              if (auto status = ctx.ijson ? psio::decode_json_checked(psio::ijson{}, text, in)
                                          : psio::decode_json_checked(psio::json{}, text, in);
                  !status.ok())
                 return status;
              ServiceMethod value;
              if (auto status = accountFromText(in.service, value.service); !status.ok())
                 return status;
              value.method = MethodNumber{in.method};
              psio::to_pssz(value, pssz);
              return psio::codec_ok();
           }});
      result.add(
          "Action",
          {.to_json =
               [schemas](std::span<const char> pssz, const ir::JsonContext& ctx, std::string& json)
           {
              auto        act = psio::from_pssz<Action>(psio::trusted{pssz});
              std::string storage;
              std::string data;
              bool        decoded = false;
              std::string method  = act.method.str();
              if (schemas)
                 if (auto* schema = schemas(act.service))
                    if (auto* action = schema->findAction(act.method))
                    {
                       method  = action->first;
                       decoded = argsToJson(*schema, *action->second.params, act.rawData, ctx, data)
                                     .ok();
                    }
              json += "{\"sender\":";
              json += jsonText(act.sender.str(), ctx);
              json += ",\"service\":";
              json += jsonText(act.service.str(), ctx);
              json += ",\"method\":";
              json += jsonText(method, ctx);
              if (decoded)
              {
                 json += ",\"data\":";
                 json += data;
              }
              else
              {
                 json += ",\"rawData\":\"";
                 json += psio::to_hex(act.rawData);
                 json += '"';
              }
              json += '}';
              return psio::codec_ok();
           },
           .from_json =
               [schemas, onAction](std::string_view json, const ir::JsonContext& ctx,
                                   std::vector<char>& pssz)
           {
              PrettyAction          in;
              std::span<const char> text{json.data(), json.size()};
              if (auto status = ctx.ijson ? psio::decode_json_checked(psio::ijson{}, text, in)
                                          : psio::decode_json_checked(psio::json{}, text, in);
                  !status.ok())
                 return status;
              Action act;
              if (auto status =
                      toActionImpl(std::move(in), schemas, ctx.handlers, ctx.ijson, false, act);
                  !status.ok())
                 return status;
              if (onAction)
                 onAction(act.sender, act.service);
              psio::to_pssz(act, pssz);
              return psio::codec_ok();
           }});
      return result;
   }

   Action toAction(PrettyAction&&                       action,
                   const GetSchemaFn&                   schemas,
                   const psio::pssz_ir::CustomHandlers& handlers)
   {
      Action result;
      if (auto status = toActionImpl(std::move(action), schemas, &handlers, true, true, result);
          !status.ok())
         abortMessage(std::string(status.error().what));
      return result;
   }

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
                    const ActionTrace& atrace,
                    const GetSchemaFn& schemas,
                    const std::string& indent)
   {
      dest += indent + "action:\n";
      std::string methodStorage;
      dest += indent + "    " + atrace.action.sender.str() + " => " + atrace.action.service.str() +
              "::" +
              prettyMethod(schemas, atrace.action.service, atrace.action.method, methodStorage) +
              "\n";
      const ServiceSchema* schema = schemas ? schemas(atrace.action.service) : nullptr;
      if (auto* action = schema ? schema->findAction(atrace.action.method) : nullptr)
      {
         auto handlers = action_types(schemas);
         // The text of a packed value, or nothing if the bytes are not one
         auto decode = [&](const psio::schema_types::AnyType& type,
                           std::span<const char>              bytes) -> std::optional<psio::json_value>
         {
            std::string      text;
            psio::json_value value;
            if (ir::pssz_to_json(schema->types, type, psio::ijson{}, bytes, text, nullptr, &handlers)
                    .ok() &&
                psio::decode_json_checked(psio::ijson{}, std::span<const char>{text}, value).ok())
               return value;
            return {};
         };
         if (auto args = decode(*action->second.params, atrace.action.rawData))
         {
            if (auto* args_obj = args->as_object())
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
               prettyValue(dest, *args);
               dest += "\n";
            }
         }
         if (!atrace.rawRetval.empty() && action->second.result)
         {
            if (auto retval = decode(**action->second.result, atrace.rawRetval))
            {
               dest += indent;
               dest += "    retval: ";
               prettyValue(dest, *retval);
               dest += "\n";
            }
         }
      }
      for (auto& inner : atrace.innerTraces)
         std::visit(
             [&](auto& inner)
             {
                if (!hideTrace(inner))
                   prettyTrace(dest, inner, schemas, indent + "    ");
             },
             inner.inner);
   }

   void prettyTrace(std::string&            dest,
                    const TransactionTrace& ttrace,
                    const GetSchemaFn&      schemas,
                    const std::string&      indent)
   {
      for (auto& a : ttrace.actionTraces)
      {
         if (!hideTrace(a))
            prettyTrace(dest, a, schemas, indent);
      }
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
