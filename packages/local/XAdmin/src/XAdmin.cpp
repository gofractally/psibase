#include <services/local/XAdmin.hpp>

#include <psibase/dispatch.hpp>
#include <psio/json/any.hpp>
#include <services/local/XDb.hpp>
#include <services/local/XHttp.hpp>
#include <services/system/HttpServer.hpp>
#include <services/system/RTransact.hpp>

using namespace psibase;
using namespace LocalService;
using namespace SystemService;

namespace LocalService
{
   namespace
   {
      bool incrementRefCount(CodeRefCountTable& refsTable,
                             const Checksum256& codeHash,
                             std::uint8_t       vmType,
                             std::uint8_t       vmVersion)
      {
         auto count = CodeRefCountRow{codeHash, vmType, vmVersion, 0};
         if (auto row = refsTable.get(count.key()))
         {
            count = *row;
         }
         ++count.numRefs;
         check(count.numRefs != 0, "Integer overflow");
         refsTable.put(count);
         return count.numRefs > 1;
      }

      void decrementRefCount(CodeRefCountTable& refsTable,
                             CodeByHashTable&   codeTable,
                             const Checksum256& codeHash,
                             std::uint8_t       vmType,
                             std::uint8_t       vmVersion)
      {
         auto prevCount = refsTable.get(std::tuple(codeHash, vmType, vmVersion));
         check(prevCount.has_value(), "Missing reference count");
         if (--prevCount->numRefs)
            refsTable.put(*prevCount);
         else
         {
            refsTable.remove(*prevCount);
            codeTable.erase(std::tuple(codeHash, vmType, vmVersion));
         }
      }

      std::vector<char> toVec(std::string_view body)
      {
         return std::vector(body.begin(), body.end());
      }

      struct AdminAccountOp
      {
         AccountNumber account;
         bool          admin = true;
         PSIO_REFLECT(AdminAccountOp, account, admin)
      };

      struct LoginReply
      {
         std::string access_token;
         std::string token_type = "bearer";
      };
      PSIO_REFLECT(LoginReply, access_token, token_type)

      struct ShutdownRequest
      {
         bool restart = false;
         bool force   = false;
         bool soft    = false;
      };
      PSIO_REFLECT(ShutdownRequest, restart, force, soft);

      struct PsinodeShutdownArgs
      {
         std::optional<std::vector<std::string>> restart;
         bool                                    soft = false;
         std::optional<MicroSeconds>             deadline;
      };
      PSIO_REFLECT(PsinodeShutdownArgs, restart, soft, deadline)

      void initRefCounts()
      {
         auto refs      = XAdmin{}.open<CodeRefCountTable>();
         auto codeTable = Native::subjective(KvMode::read).open<CodeTable>();
         PSIBASE_SUBJECTIVE_TX
         {
            if (refs.getIndex<0>().empty())
            {
               for (auto row : codeTable.getIndex<0>())
               {
                  incrementRefCount(refs, row.codeHash, row.vmType, row.vmVersion);
               }
            }
         }
      }

      bool chainIsBooted()
      {
         auto mode   = KvMode::read;
         auto prefix = std::span<const char>();
         auto native = Native::Tables{to<XDb>().open(DbId::native, prefix, mode), mode};
         auto row    = native.open<StatusTable>().get({});
         return row && row->head;
      }

      bool isAdminSocket(std::optional<std::int32_t> socket)
      {
         if (socket)
         {
            std::optional<SocketRow> row;
            auto                     native = Native::session(KvMode::read);
            PSIBASE_SUBJECTIVE_TX
            {
               row = native.open<SocketTable>().get(*socket);
            }
            check(row.has_value(), "Missing socket row");
            check(std::holds_alternative<HttpSocketInfo>(row->info), "Wrong socket type");
            const auto& info = std::get<HttpSocketInfo>(row.value().info);
            check(info.endpoint.has_value(), "Missing endpoint for socket");
            const auto& endpoint = info.endpoint.value();
            if (isLoopback(endpoint))
               return true;

            std::optional<EnvRow> env;
            PSIBASE_SUBJECTIVE_TX
            {
               env = native.open<EnvTable>().get(std::string("PSIBASE_ADMIN_IP"));
            }
            if (env)
            {
               std::string_view            addrs = env->value;
               std::string_view::size_type prev  = 0;
               while (true)
               {
                  auto pos     = addrs.find(prev, ',');
                  auto addrStr = addrs.substr(prev, pos);
                  if (auto prefix = parseIPAddressPrefix(addrStr))
                  {
                     if (auto v4 = std::get_if<IPV4Endpoint>(&info.endpoint.value()))
                     {
                        if (prefix->contains(v4->address))
                           return true;
                     }
                     else if (auto v6 = std::get_if<IPV6Endpoint>(&info.endpoint.value()))
                     {
                        if (prefix->contains(v6->address))
                           return true;
                     }
                  }
                  if (pos == std::string_view::npos)
                     break;
                  prev = pos + 1;
               }
            }
         }
         return false;
      }

      struct CliArgs
      {
         std::vector<std::string> argv;
         PSIO_REFLECT(CliArgs, argv)
      };

      bool parseOptionValue(std::string_view value, const bool& default_)
      {
         if (value == "yes" || value == "true" || value == "on" || value == "1")
            return true;
         else if (value == "no" || value == "false" || value == "off" || value == "0")
            return false;
         else
            return default_;
      }

      bool parseOption(std::string_view name, std::string_view arg, bool& result)
      {
         if (arg.starts_with(name))
         {
            arg.remove_prefix(name.size());
            if (arg.empty())
            {
               result = true;
               return true;
            }
            else if (arg.starts_with('='))
            {
               result = parseOptionValue(arg.substr(1), false);
               return true;
            }
         }
         return false;
      }

      bool parseOption(const psio::json::any& opt, bool default_)
      {
         if (auto* b = opt.get_if<bool>())
            return *b;
         else if (auto* s = opt.get_if<std::string>())
         {
            return parseOptionValue(*s, default_);
         }
         return default_;
      }

      template <typename T>
      T parseOptionList(const psio::json::any& opt, const T& default_)
      {
         if (auto* l = opt.get_if<psio::json::any_array>())
         {
            if (!l->empty())
               return parseOption(l->back(), default_);
            else
               return default_;
         }
         else
         {
            return parseOption(opt, default_);
         }
      }

      struct PsinodeConfig
      {
         psio::json::any         host;
         psio::json::any         service;
         psio::json::any_object* serviceConfig()
         {
            if (auto* s = service.get_if<psio::json::any_object>())
            {
               auto pos =
                   std::ranges::find_if(*s, [](auto& entry) { return entry.key == "config"; });
               if (pos != s->end())
               {
                  return pos->value.get_if<psio::json::any_object>();
               }
            }
            return nullptr;
         }
         std::vector<std::string> serviceArgv()
         {
            if (auto* s = service.get_if<psio::json::any_object>())
            {
               auto pos = std::ranges::find_if(*s, [](auto& entry) { return entry.key == "argv"; });
               if (pos != s->end())
               {
                  if (auto* arr = pos->value.get_if<psio::json::any_array>())
                  {
                     std::vector<std::string> result;
                     for (const auto& arg : *arr)
                     {
                        if (auto* s = arg.get_if<std::string>())
                           result.push_back(*s);
                        else
                           return {};
                     }
                     return result;
                  }
               }
            }
            return {};
         }
         PSIO_REFLECT(PsinodeConfig, host, service)
      };

      // The result of /config merges the host psinode config with the AdminOptions row
      std::string readConfig()
      {
         AdminOptionsRow adminOpts;
         PsinodeConfig   json;
         PSIBASE_SUBJECTIVE_TX
         {
            HostConfigRow hostConfig = Native::session().open<HostConfigTable>().get({}).value();
            json                     = psio::convert_from_json<PsinodeConfig>(hostConfig.config);
            adminOpts = XAdmin{}.open<AdminOptionsTable>().get({}).value_or(AdminOptionsRow{});
         }
         psio::json::any_object result;
         if (auto* host = json.host.get_if<psio::json::any_object>())
         {
            for (auto& entry : *host)
            {
               // Rename host options that conflict with the ours.
               // Note that we preserve the service defined options here,
               // because they are used by the UI, which is part of this
               // service. Unknown host options will not be displayed and
               // will be round-tripped unmodified.
               if (psio::get_data_member<AdminOptionsRow>(entry.key, [](auto) {}) ||
                   entry.key.starts_with("host."))
                  entry.key = "host." + entry.key;
               result.push_back(std::move(entry));
            }
         }
         result.push_back({"p2p", adminOpts.p2p});
         return psio::convert_to_json(psio::json::any{std::move(result)});
      }
      void writeConfig(std::string config)
      {
         PSIBASE_SUBJECTIVE_TX
         {
            auto            table      = Native::session().open<HostConfigTable>();
            HostConfigRow   hostConfig = table.get({}).value();
            AdminOptionsRow adminConfig{};
            auto json = psio::convert_from_json<psio::json::any_object>(std::move(config));
            psio::json::any_object host;
            psio::json::any_object service;
            for (auto& entry : json)
            {
               if (entry.key == "p2p")
               {
                  if (const bool* b = entry.value.get_if<bool>())
                  {
                     adminConfig.p2p = *b;
                     entry.value     = std::string(*b ? "on" : "off");
                     service.push_back(std::move(entry));
                  }
               }
               else
               {
                  if (entry.key.starts_with("host."))
                     entry.key = entry.key.substr(5);

                  host.push_back(std::move(entry));
               }
            }
            hostConfig.config = psio::convert_to_json(PsinodeConfig{
                .host = std::move(host),
                .service =
                    psio::json::any_object{psio::json::entry{"config", std::move(service)}}});
            table.put(hostConfig);
            XAdmin{}.open<AdminOptionsTable>().put(adminConfig);
         }
      }
   }  // namespace

   void XAdmin::startSession()
   {
      check(getSender() == XHttp::service, "Wrong sender");
      PSIBASE_SUBJECTIVE_TX
      {
         HostConfigRow hostConfig = Native::session().open<HostConfigTable>().get({}).value();
         auto          json       = psio::convert_from_json<PsinodeConfig>(hostConfig.config);

         AdminOptionsRow adminOpts{};
         if (auto* config = json.serviceConfig())
         {
            for (const auto& entry : *config)
            {
               if (entry.key == "p2p")
               {
                  adminOpts.p2p = parseOptionList(entry.value, false);
               }
               else
               {
                  abortMessage(std::format("Unknown option: {}", entry.key));
               }
            }
         }
         for (const auto& opt : json.serviceArgv())
         {
            if (!parseOption("--p2p", opt, adminOpts.p2p))
            {
               abortMessage(std::format("Unknown option: {}", opt));
            }
         }
         open<AdminOptionsTable>().put(adminOpts);
      }
   }

   AdminOptionsRow XAdmin::options()
   {
      check(getSender() == XHttp::service, "Wrong sender");
      PSIBASE_SUBJECTIVE_TX
      {
         return open<AdminOptionsTable>().get({}).value_or(AdminOptionsRow{});
      }
      __builtin_unreachable();
   }

   // Returns nullopt on success, an appropriate error on failure
   std::optional<HttpReply> XAdmin::checkAuth(const HttpRequest&          req,
                                              std::optional<std::int32_t> socket)
   {
      if (isAdminSocket(socket))
         return {};

      if (chainIsBooted())
      {
         if (auto user = to<RTransact>().getUser(req))
         {
            PSIBASE_SUBJECTIVE_TX
            {
               if (open<AdminAccountTable>().get(*user).has_value())
                  return {};
            }
            return HttpReply{.status      = HttpStatus::forbidden,
                             .contentType = "text/html",
                             .body        = toVec("Not authorized")};
         }
      }

      return HttpReply{.status      = HttpStatus::unauthorized,
                       .contentType = "text/html",
                       .body        = toVec("Not authorized")};
   }

   bool XAdmin::isAdmin(std::optional<AccountNumber> account, std::optional<std::int32_t> socket)
   {
      if (account)
      {
         if (*account == XAdmin::service)
            return true;
         PSIBASE_SUBJECTIVE_TX
         {
            if (open<AdminAccountTable>().get(*account).has_value())
               return true;
         }
      }
      return isAdminSocket(socket);
   }

   std::optional<HttpReply> XAdmin::serveSys(HttpRequest req, std::optional<std::int32_t> socket)
   {
      check(getSender() == XHttp::service, "Wrong sender");

      auto target = req.path();
      if (target.starts_with("/native/"))
      {
         if (auto reply = checkAuth(req, socket))
            return reply;

         return {};
      }
      else if (target == "/config")
      {
         if (auto reply = checkAuth(req, socket))
            return reply;

         if (req.method == "GET")
         {
            auto config = readConfig();
            return HttpReply{
                .status      = HttpStatus::ok,
                .contentType = "application/json",
                .body        = std::vector(config.begin(), config.end()),
            };
         }
         else if (req.method == "PUT")
         {
            if (req.contentType != "application/json")
            {
               return HttpReply{
                   .status      = HttpStatus::unsupportedMediaType,
                   .contentType = "text/html",
                   .body        = toVec("Content-Type must be application/json\n"),
               };
            }
            writeConfig(std::string(req.body.begin(), req.body.end()));
            return HttpReply{
                .status = HttpStatus::ok,
            };
         }
         else
         {
            return HttpReply::methodNotAllowed(req);
         }
      }
      else if (target == "/shutdown")
      {
         if (req.method != "POST")
         {
            return HttpReply::methodNotAllowed(req);
         }
         if (req.contentType != "application/json")
         {
            return HttpReply{
                .status      = HttpStatus::unsupportedMediaType,
                .contentType = "text/html",
                .body        = toVec("Content-Type must be application/json\n"),
            };
         }
         auto body = psio::convert_from_json<ShutdownRequest>(
             std::string{req.body.begin(), req.body.end()});
         PSIBASE_SUBJECTIVE_TX
         {
            auto now = std::chrono::time_point_cast<MicroSeconds>(std::chrono::steady_clock::now())
                           .time_since_epoch();

            PsinodeShutdownArgs args{.restart  = std::nullopt,
                                     .soft     = body.soft,
                                     .deadline = body.force ? now : now + std::chrono::seconds{10}};
            if (body.restart)
            {
               HostConfigRow hostConfig = Native::session().open<HostConfigTable>().get({}).value();
               auto          opts       = psio::convert_from_json<PsinodeConfig>(hostConfig.config);
               args.restart             = opts.serviceArgv();
            }
            PendingShutdownRow row{.args = psio::convert_to_json(args)};

            auto table = Native::session(KvMode::readWrite).open<PendingShutdownTable>();
            PSIBASE_SUBJECTIVE_TX
            {
               table.put(row);
            }
         }
         return HttpReply{};
      }
      else if (target.starts_with("/services/"))
      {
         if (auto reply = checkAuth(req, socket))
            return reply;

         auto service = AccountNumber{std::string_view{target}.substr(10)};
         if (service == AccountNumber{})
         {
            return {};
         }
         if (req.method == "PUT")
         {
            initRefCounts();
            if (req.contentType != "application/wasm")
            {
               return HttpReply{
                   .status      = HttpStatus::unsupportedMediaType,
                   .contentType = "text/html",
                   .body        = toVec("Content-Type must be application/wasm\n"),
               };
            }
            auto codeHash        = sha256(req.body.data(), req.body.size());
            auto refsTable       = open<CodeRefCountTable>();
            auto native          = Native::subjective(KvMode::readWrite);
            auto codeByHashTable = native.open<CodeByHashTable>();
            auto codeTable       = native.open<CodeTable>();
            PSIBASE_SUBJECTIVE_TX
            {
               auto account = codeTable.get(service);
               if (!account)
               {
                  account.emplace();
                  account->codeNum = service;
               }

               constexpr std::uint8_t vmType    = 0;
               constexpr std::uint8_t vmVersion = 0;

               if (vmType == account->vmType && vmVersion == account->vmVersion &&
                   codeHash == account->codeHash)
                  return HttpReply{};

               // decrement old reference count
               if (account->codeHash != Checksum256{})
               {
                  decrementRefCount(refsTable, codeByHashTable, account->codeHash, account->vmType,
                                    account->vmVersion);
               }

               account->codeHash  = codeHash;
               account->flags     = CodeRow::isPrivileged;
               account->vmType    = vmType;
               account->vmVersion = vmVersion;
               codeTable.put(*account);

               if (!incrementRefCount(refsTable, codeHash, vmType, vmVersion))
               {
                  CodeByHashRow code_obj{.codeHash  = account->codeHash,
                                         .vmType    = account->vmType,
                                         .vmVersion = account->vmVersion,
                                         .code{req.body.begin(), req.body.end()}};
                  codeByHashTable.put(code_obj);
               }
            }
            return HttpReply{};
         }
         else if (req.method == "GET")
         {
            auto native          = Native::subjective(KvMode::read);
            auto codeByHashTable = native.open<CodeByHashTable>();
            auto codeTable       = native.open<CodeTable>();
            PSIBASE_SUBJECTIVE_TX
            {
               if (auto account = codeTable.get(service))
               {
                  auto code = codeByHashTable.get(
                      std::tuple(account->codeHash, account->vmType, account->vmVersion));
                  check(code.has_value(), "CodeByHashRow is missing");
                  return HttpReply{.contentType = "application/wasm",
                                   .body{code->code.begin(), code->code.end()}};
               }
               else
               {
                  return {};
               }
            }
         }
         else if (req.method == "DELETE")
         {
            initRefCounts();
            // MUST delete all data to avoid exposing node secrets to on-chain services
         }
         return HttpReply::methodNotAllowed(req);
      }
      else if (target == "/admin_accounts")
      {
         if (auto reply = checkAuth(req, socket))
            return reply;

         auto adminAccounts = open<AdminAccountTable>();
         if (req.method == "POST")
         {
            if (req.contentType != "application/json")
            {
               return HttpReply{
                   .status      = HttpStatus::unsupportedMediaType,
                   .contentType = "text/html",
                   .body        = toVec("Content-Type must be application/json\n"),
               };
            }
            auto op = psio::convert_from_json<AdminAccountOp>(
                std::string(req.body.data(), req.body.size()));
            PSIBASE_SUBJECTIVE_TX
            {
               if (op.admin)
               {
                  adminAccounts.put({op.account});
               }
               else
               {
                  adminAccounts.erase(op.account);
               }
            }
            return HttpReply{};
         }
         else if (req.method == "GET")
         {
            std::vector<AccountNumber> result;
            PSIBASE_SUBJECTIVE_TX
            {
               for (auto row : adminAccounts.getIndex<0>())
               {
                  result.push_back(row.account);
               }
            }
            HttpReply reply{
                .contentType = "application/json",
            };
            psio::vector_stream stream{reply.body};
            psio::to_json(result, stream);
            return reply;
         }
         else
         {
            return HttpReply::methodNotAllowed(req);
         }
      }
      else if (target == "/admin_login")
      {
         if (auto reply = checkAuth(req, socket))
            return reply;

         if (req.method != "GET")
         {
            return HttpReply::methodNotAllowed(req);
         }

         HttpReply           reply{.contentType = "application/json"};
         psio::vector_stream stream{reply.body};
         to_json(LoginReply{to<RTransact>().login(req.rootHost)}, stream);
         return reply;
      }
      return {};
   }
}  // namespace LocalService

PSIBASE_DISPATCH(LocalService::XAdmin)
