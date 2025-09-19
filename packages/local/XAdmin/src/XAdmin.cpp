#include <services/local/XAdmin.hpp>

#include <psibase/dispatch.hpp>
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
         auto row = Native::tables(KvMode::read).open<StatusTable>().get({});
         return row && row->head;
      }

   }  // namespace

   // Returns nullopt on success, an appropriate error on failure
   std::optional<HttpReply> XAdmin::checkAuth(const HttpRequest&          req,
                                              std::optional<std::int32_t> socket)
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
            return {};

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
                        return {};
                  }
                  else if (auto v6 = std::get_if<IPV6Endpoint>(&info.endpoint.value()))
                  {
                     if (prefix->contains(v6->address))
                        return {};
                  }
               }
               if (pos == std::string_view::npos)
                  break;
               prev = pos + 1;
            }
         }
      }

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

   bool XAdmin::isAdmin(AccountNumber account)
   {
      if (account == XAdmin::service)
         return true;
      PSIBASE_SUBJECTIVE_TX
      {
         return open<AdminAccountTable>().get(account).has_value();
      }
      __builtin_unreachable();
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
