#include <psibase/BlockContext.hpp>
#include <psibase/Rpc.hpp>
#include <psibase/Socket.hpp>
#include <psibase/SystemContext.hpp>
#include <psibase/TransactionContext.hpp>
#include <psibase/nativeTables.hpp>
#include <psibase/package.hpp>
#include <psibase/serviceEntry.hpp>
#include <psio/finally.hpp>

using namespace psibase;

namespace
{

   struct TempSocket : AutoCloseSocket, std::enable_shared_from_this<TempSocket>
   {
      TempSocket() {}
      void autoClose(const std::optional<std::string>&) noexcept override {}
      void send(std::span<const char> data) override
      {
         auto reply = psio::from_frac<HttpReply>(data);
         if (reply.status == HttpStatus::ok)
         {
            okay = true;
         }
         else if (reply.contentType.starts_with("text/"))
         {
            throw std::runtime_error(std::string(reply.body.data(), reply.body.size()));
         }
         else
         {
            throw std::runtime_error(proxyServiceNum.str() + "::serve returned " +
                                     std::to_string(static_cast<std::uint16_t>(reply.status)));
         }
      }
      SocketInfo info() const override { return HttpSocketInfo{LocalEndpoint{}}; }
      bool       okay = false;
   };
}  // namespace

void load_local_packages(TransactionContext& tc, const std::vector<PackagedService>& packages)
{
   std::vector<HttpRequest> requests;

   for (const auto& package : packages)
   {
      PSIBASE_LOG(psibase::loggers::generic::get(), info) << "Loading " << package.meta.name;

      for (auto [account, header, serviceInfo] : package.services)
      {
         auto file = package.archive.getEntry(header);

         std::vector<std::uint8_t> code(file.uncompressedSize());
         file.read({reinterpret_cast<char*>(code.data()), code.size()});

         auto    codeHash = sha256(code.data(), code.size());
         CodeRow codeRow{
             .codeNum  = account,
             .flags    = serviceInfo.parseFlags(),
             .codeHash = codeHash,
         };
         tc.blockContext.db.kvPut(DbId::nativeSubjective, codeRow.key(), codeRow);
         CodeByHashRow codeByHashRow{
             .codeHash = codeHash,
             .code     = std::move(code),
         };
         tc.blockContext.db.kvPut(DbId::nativeSubjective, codeByHashRow.key(), codeByHashRow);
      }

      std::string rootHost = "psibase";

      for (auto [account, header] : package.data)
      {
         auto file             = package.archive.getEntry(header);
         auto [path, mimeType] = package.dataFileInfo(header.filename);

         requests.push_back(HttpRequest{
             .host        = account.str() + "." + rootHost,
             .rootHost    = rootHost,
             .method      = "PUT",
             .target      = std::string(path),
             .contentType = std::string(mimeType),
             .body        = file.read(),
         });
      }
   }

   auto socket = std::make_shared<TempSocket>();
   tc.blockContext.systemContext.sockets->add(*tc.blockContext.writer, socket, &tc.ownedSockets,
                                              &tc.blockContext.db);
   for (const auto& request : requests)
   {
      ActionTrace& atrace = tc.transactionTrace.actionTraces.emplace_back();

      Action action{
          .sender  = AccountNumber(),
          .service = proxyServiceNum,
          .rawData = psio::convert_to_frac(std::tuple(socket->id, std::move(request))),
      };
      socket->okay = false;
      tc.execServe(action, atrace);
      if (!socket->okay)
      {
         throw std::runtime_error(proxyServiceNum.str() +
                                  "::serve did not return a synchronous response");
      }
      tc.transactionTrace.actionTraces.clear();
   }
   tc.blockContext.systemContext.sockets->remove(*tc.blockContext.writer, socket,
                                                 &tc.blockContext.db);
}

std::filesystem::path package_path();

void initialize_database(SystemContext& context, const std::string& template_)
{
   BlockContext bc{context, context.sharedDatabase.getHead(), context.sharedDatabase.createWriter(),
                   true};

   SignedTransaction  trx;
   TransactionTrace   trace;
   TransactionContext tc{bc, trx, trace, DbMode::rpc()};

   auto cleanup =
       psio::finally{[&, saved = bc.db.saveSubjective()] { bc.db.restoreSubjective(saved); }};
   bc.db.checkoutSubjective();

   auto key = psio::convert_to_key(codePrefix());
   if (!bc.db.kvGreaterEqualRaw(DbId::nativeSubjective, key, key.size()))
   {
      DirectoryRegistry registry{package_path().string()};
      auto              packages = registry.resolve({&template_, 1});
      bc.start();
      load_local_packages(tc, packages);
   }

   SocketAutoCloseSet autoClose;
   if (!bc.db.commitSubjective(*context.sockets, tc.ownedSockets))
   {
      throw std::runtime_error("Failed to initialize database");
   }
}
