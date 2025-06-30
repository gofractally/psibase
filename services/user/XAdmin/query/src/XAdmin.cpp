#include <services/user/XAdmin.hpp>

#include <psibase/dispatch.hpp>
#include <services/system/HttpServer.hpp>
#include <services/system/RTransact.hpp>

using namespace psibase;
using namespace UserService;
using namespace SystemService;

namespace UserService
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
            kvRemove(DbId::nativeSubjective, codeByHashKey(codeHash, vmType, vmVersion));
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
         auto refs = XAdmin{}.open<CodeRefCountTable>();
         PSIBASE_SUBJECTIVE_TX
         {
            if (refs.getIndex<0>().empty())
            {
               for (auto row : TableIndex<CodeRow, AccountNumber>{
                        DbId::nativeSubjective, psio::convert_to_key(codePrefix()), false})
               {
                  incrementRefCount(refs, row.codeHash, row.vmType, row.vmVersion);
               }
            }
         }
      }
   }  // namespace

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

   std::optional<HttpReply> XAdmin::serveSys(HttpRequest req)
   {
      auto target = req.path();
      if (target.starts_with("/services/"))
      {
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
            Checksum256 codeHash  = sha256(req.body.data(), req.body.size());
            auto        refsTable = open<CodeRefCountTable>();
            PSIBASE_SUBJECTIVE_TX
            {
               auto account = kvGet<CodeRow>(DbId::nativeSubjective, codeKey(service));
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
                  decrementRefCount(refsTable, account->codeHash, account->vmType,
                                    account->vmVersion);
               }

               account->codeHash  = codeHash;
               account->vmType    = vmType;
               account->vmVersion = vmVersion;
               kvPut(DbId::nativeSubjective, account->key(), *account);

               if (!incrementRefCount(refsTable, codeHash, vmType, vmVersion))
               {
                  CodeByHashRow code_obj{.codeHash  = account->codeHash,
                                         .vmType    = account->vmType,
                                         .vmVersion = account->vmVersion,
                                         .code{req.body.begin(), req.body.end()}};
                  kvPut(DbId::nativeSubjective, code_obj.key(), code_obj);
               }
            }
            return HttpReply{};
         }
         else if (req.method == "GET")
         {
            PSIBASE_SUBJECTIVE_TX
            {
               if (auto account = kvGet<CodeRow>(DbId::nativeSubjective, codeKey(service)))
               {
                  auto code = kvGet<CodeByHashRow>(
                      DbId::nativeSubjective,
                      codeByHashKey(account->codeHash, account->vmType, account->vmVersion));
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
         return HttpReply{
             .status      = HttpStatus::methodNotAllowed,
             .contentType = "text/html",
             .body = toVec(std::format("The resource '{}' does not accept the method {}.\n", target,
                                       req.method))};
      }
      else if (target == "/admin_accounts")
      {
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
            return HttpReply{
                .status      = HttpStatus::methodNotAllowed,
                .contentType = "text/html",
                .body = toVec(std::format("The resource '{}' does not accept the method {}.\n",
                                          target, req.method))};
         }
      }
      else if (target == "/admin_login")
      {
         if (req.method != "GET")
         {
            return HttpReply{
                .status      = HttpStatus::methodNotAllowed,
                .contentType = "text/html",
                .body = toVec(std::format("The resource '{}' does not accept the method {}.\n",
                                          target, req.method))};
         }

         HttpReply           reply{.contentType = "application/json"};
         psio::vector_stream stream{reply.body};
         to_json(LoginReply{to<RTransact>().login(req.rootHost)}, stream);
         return reply;
      }
      else
      {
         auto table = open<ContentTable>();
         if (req.method == "PUT")
         {
            ContentRow row{
                .path        = target,
                .contentType = req.contentType,
                .contentHash = sha256(req.body.data(), req.body.size()),
                .content     = std::move(req.body),
            };
            for (auto& h : req.headers)
            {
               if (h.matches("content-encoding"))
               {
                  row.contentEncoding = std::move(h.value);
                  break;
               }
            }
            PSIBASE_SUBJECTIVE_TX
            {
               table.put(row);
            }
            return HttpReply{};
         }
         else if (req.method == "GET")
         {
            std::optional<ContentRow> row;
            PSIBASE_SUBJECTIVE_TX
            {
               row = table.get(target);
               if (!row)
               {
                  row = table.get(target + (target.ends_with('/') ? "index.html" : "/index.html"));
               }
            }
            if (row)
            {
               auto reply = HttpReply{
                   .contentType = std::move(row->contentType),
                   .body        = std::move(row->content),
               };
               if (row->contentEncoding)
               {
                  reply.headers.push_back({"Content-Encoding", std::move(*row->contentEncoding)});
               }
               if (row->csp)
               {
                  reply.headers.push_back({"Content-Security-Policy", std::move(*row->csp)});
               }
               return reply;
            }
         }
         else if (req.method == "DELETE")
         {
            PSIBASE_SUBJECTIVE_TX
            {
               table.erase(target);
            }
            return HttpReply{};
         }
         else
         {
            return HttpReply{
                .status      = HttpStatus::methodNotAllowed,
                .contentType = "text/html",
                .body = toVec(std::format("The resource '{}' does not accept the method {}.\n",
                                          target, req.method))};
         }
      }
      return HttpReply{.status      = HttpStatus::notFound,
                       .contentType = "text/html",
                       .body = toVec(std::format("The resource '{}' was not found\n", target))};
   }
}  // namespace UserService

#ifndef PSIBASE_GENERATE_SCHEMA

extern "C" [[clang::export_name("serve")]] void serve()
{
   auto act = getCurrentAction();

   psibase::internal::receiver = XAdmin::service;
   auto [sock, req] = psio::from_frac<std::tuple<std::int32_t, HttpRequest>>(act.rawData);
   UserService::XAdmin xadmin;
   auto                reply = xadmin.serveSys(std::move(req));
   if (!reply)
   {
      reply = HttpReply{
          .status = HttpStatus::notFound, .contentType = "text/html", .body = toVec("not found")};
   }
   socketSend(sock, psio::to_frac(*reply));
}

extern "C" [[clang::export_name("checkAccess")]] void checkAccess()
{
   psibase::internal::receiver = XAdmin::service;
   auto act                    = getCurrentAction();

   auto [req] = psio::from_frac<std::tuple<HttpRequest>>(act.rawData);
   auto user  = to<RTransact>().getUser(req);
   check(user.has_value(), "Not logged in");
   check(XAdmin{}.open<AdminAccountTable>().get(*user).has_value(),
         std::format("'{}' is not a node admin", user->str()));
}

#endif

PSIBASE_DISPATCH(UserService::XAdmin)
