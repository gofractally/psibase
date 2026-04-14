#include <psibase/BlockContext.hpp>
#include <psibase/Rpc.hpp>
#include <psibase/Socket.hpp>
#include <psibase/SystemContext.hpp>
#include <psibase/TransactionContext.hpp>
#include <psibase/nativeTables.hpp>
#include <psibase/package.hpp>
#include <psibase/serviceEntry.hpp>
#include <psio/finally.hpp>
#include <services/local/XHttp.hpp>
#include <services/local/XPackages.hpp>

using namespace psibase;
using namespace LocalService;

namespace
{

   struct TempSocket : AutoCloseSocket, std::enable_shared_from_this<TempSocket>
   {
      TempSocket() {}
      // TempSocket is used synchronously, so instead of posting remove
      // to an executor in onClose, the creator is responsible for
      // calling remove.
      void onClose(const std::optional<std::string>&) noexcept override {}
      void send(Writer&, std::span<const char> data, std::uint32_t flags) override
      {
         if (flags != 0)
            abortMessage("Invalid flags for HttpSocket: " + std::to_string(flags));
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

   HttpRequest registerServer(LocalService::RegisteredServiceRow server)
   {
      std::string         rootHost("", 1);
      HttpRequest         req{.host        = XHttp::service.str() + "." + rootHost,
                              .method      = "POST",
                              .target      = "/register_server",
                              .contentType = "application/json"};
      psio::vector_stream stream{req.body};
      to_json(server, stream);
      return req;
   }
}  // namespace

void load_local_packages(TransactionContext&           tc,
                         const DirectoryRegistry&      registry,
                         std::vector<PackagedService>& packages)
{
   std::vector<HttpRequest>          requests;
   std::vector<RegisteredServiceRow> servers;

   for (auto& package : packages)
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

         if (serviceInfo.server)
         {
            auto server = LocalService::RegisteredServiceRow{account, *serviceInfo.server};
            if (account == XPackages::service)
               servers.push_back(server);
            else
               requests.push_back(registerServer(server));
         }
      }

      std::string rootHost("", 1);

      for (auto [account, header] : package.data)
      {
         auto file             = package.archive.getEntry(header);
         auto [path, mimeType] = package.dataFileInfo(header.filename);

         requests.push_back(HttpRequest{
             .host        = account.str() + "." + rootHost,
             .method      = "PUT",
             .target      = std::string(path),
             .contentType = std::string(mimeType),
             .body        = file.read(),
         });
      }

      requests.push_back(HttpRequest{
          .host        = XPackages::service.str() + "." + rootHost,
          .method      = "PUT",
          .target      = "/manifest/" + loggers::to_string(package.sha256),
          .contentType = "application/json",
          .body        = package.manifest(),
      });
      HttpRequest postinstall{
          .host        = XPackages::service.str() + "." + rootHost,
          .method      = "POST",
          .target      = "/postinstall",
          .contentType = "application/json",
      };
      psio::vector_stream stream(postinstall.body);
      to_json(
          LocalPackage{
              .name        = package.meta.name,
              .version     = package.meta.version,
              .description = package.meta.description,
              .depends     = package.meta.depends,
              .accounts    = package.meta.accounts,
              .services    = package.meta.services,
              .sha256      = package.sha256,
          },
          stream);
      requests.push_back(std::move(postinstall));
   }

   // Set up HTTP servers that we use directly, first
   {
      auto serverReqs = servers | std::views::transform(registerServer);
      requests.insert(requests.begin(), serverReqs.begin(), serverReqs.end());
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
      tc.ownedSockets.close(*tc.blockContext.writer, *tc.blockContext.systemContext.sockets,
                            std::nullopt);
      if (!socket->closed)
         throw std::runtime_error("Socket was not closed");
      if (socket->notifyClose)
         throw std::runtime_error(
             "Not implemented: socket notifyClose during initial service load");
      // Mark the socket as open again, so we can re-use it in the
      // next iteration of the loop.
      socket->closed = false;
      tc.ownedSockets.sockets.insert(socket->id);
      socket->closeLocks  = 1;
      socket->autoClosing = true;
   }
   socket->forceClose = true;
   tc.ownedSockets.close(*tc.blockContext.writer, *tc.blockContext.systemContext.sockets,
                         std::nullopt);
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
      DirectoryRegistry            registry{package_path().string()};
      auto                         packageInfo = registry.resolve({&template_, 1});
      std::vector<PackagedService> packages;
      packages.reserve(packageInfo.size());
      for (const auto& info : packageInfo)
      {
         packages.push_back(registry.get(info));
      }
      sortPackages(packages, {});
      bc.start();
      load_local_packages(tc, registry, packages);
   }

   SocketAutoCloseSet autoClose;
   if (!bc.db.commitSubjective(*context.sockets, tc.ownedSockets))
   {
      throw std::runtime_error("Failed to initialize database");
   }
}
