#include <psibase/tester.hpp>
#include <psibase/testerApi.hpp>

#include <psibase/fileUtil.hpp>
#include <psibase/package.hpp>
#include <psibase/serviceEntry.hpp>
#include <psibase/version.hpp>
#include <services/local/XHttp.hpp>
#include <services/system/Transact.hpp>
#include <services/system/VerifySig.hpp>

#include <fcntl.h>

#include <catch2/catch_message.hpp>

namespace psibase::tester::raw
{
   std::optional<std::uint32_t> selectedChain;
   uint32_t                     getSelectedChain()
   {
      check(!!selectedChain, "no chain is selected");
      return *selectedChain;
   }
}  // namespace psibase::tester::raw

namespace
{
   std::uint32_t numPublicChains = 0;
   struct ScopedSelectChain
   {
      ScopedSelectChain(std::uint32_t id) : saved(psibase::tester::raw::selectedChain)
      {
         psibase::tester::raw::selectedChain = id;
      }
      ~ScopedSelectChain() { psibase::tester::raw::selectedChain = saved; }
      std::optional<std::uint32_t> saved;
   };
   __wasi_oflags_t get_wasi_oflags(int flags)
   {
      __wasi_oflags_t result = 0;
      if (flags & O_CREAT)
         result |= __WASI_OFLAGS_CREAT;
      if (flags & O_EXCL)
         result |= __WASI_OFLAGS_EXCL;
      if (flags & O_TRUNC)
         result |= __WASI_OFLAGS_TRUNC;
      return result;
   }
   __wasi_rights_t get_wasi_rights(int flags)
   {
      __wasi_rights_t result = 0;
      if ((flags & O_RDONLY) == O_RDONLY || (flags & O_RDWR) == O_RDWR)
         result |= __WASI_RIGHTS_FD_READ;
      if ((flags & O_WRONLY) == O_WRONLY || (flags & O_RDWR) == O_RDWR)
         result |= __WASI_RIGHTS_FD_WRITE;
      return result;
   }

}  // namespace

using psibase::tester::raw::selectedChain;
using namespace SystemService::AuthSig;

psibase::TransactionTrace psibase::tester::pushTransaction(std::uint32_t            chain,
                                                           const SignedTransaction& signedTrx)
{
   std::vector<char> packed_trx = psio::convert_to_frac(signedTrx);
   auto size = tester::raw::pushTransaction(chain, packed_trx.data(), packed_trx.size());
   return psio::from_frac<TransactionTrace>(getResult(size));
}

psibase::TransactionTrace psibase::tester::runAction(std::uint32_t chain,
                                                     RunMode       mode,
                                                     bool          head,
                                                     const Action& act)
{
   auto packedAction = psio::to_frac(act);
   auto traceSize =
       tester::raw::runAction(chain, mode, head, packedAction.data(), packedAction.size());
   return psio::from_frac<TransactionTrace>(psibase::getResult(traceSize));
}

psibase::TraceResult::TraceResult(TransactionTrace&& t) : _t(t) {}

bool psibase::TraceResult::succeeded()
{
   bool hasErrObj = (_t.error != std::nullopt);
   bool failed    = hasErrObj && (*_t.error) != "";
   if (failed)
   {
      UNSCOPED_INFO("transaction failed: " << *_t.error << "\n");
   }

   return !failed;
}

bool psibase::TraceResult::failed(std::string_view expected)
{
   bool failed = (_t.error != std::nullopt);
   if (!failed)
   {
      UNSCOPED_INFO("transaction succeeded, but was expected to fail");
      return false;
   }

   bool hasException = (failed && _t.error.has_value());
   if (hasException)
   {
      if (_t.error->find(expected.data()) != std::string::npos)
      {
         return true;
      }
      else
      {
         UNSCOPED_INFO("transaction was expected to fail with: \""
                       << expected << "\", but it failed with: \"" << *_t.error << "\"\n");
      }
   }

   return false;
}

void psibase::expect(TransactionTrace t, const std::string& expected, bool always_show)
{
   std::string error = t.error ? *t.error : "";
   bool bad = (expected.empty() && !error.empty()) || error.find(expected) == std::string::npos;
   if (bad || always_show)
      std::cout << prettyTrace(trimRawData(std::move(t))) << "\n";
   if (bad)
   {
      if (expected.empty())
         check(false, "transaction failed");
      else
         check(false, "transaction was expected to fail with " + expected);
   }
}

namespace
{
   void loadLocalServices(psibase::TestChain& self)
   {
      using namespace psibase;
      auto prefix = psio::convert_to_key(codePrefix());
      if (self.kvGreaterEqualRaw(DbId::nativeSubjective, prefix, prefix.size()))
         return;
      auto serviceRoot = std::getenv("PSIBASE_DATADIR");
      check(serviceRoot != nullptr, "Cannot find local service directory");
      auto                     packagesDir = std::string{serviceRoot} + "/packages";
      DirectoryRegistry        registry{packagesDir};
      std::vector<std::string> packageNames{"XDefault"};
      auto                     packages = registry.resolve(packageNames);
      std::vector<HttpRequest> requests;
      tester::raw::checkoutSubjective(self.nativeHandle());
      for (const auto& package : packages)
      {
         for (const auto& [account, header, serviceInfo] : package.services)
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
            self.kvPut(DbId::nativeSubjective, codeRow.key(), codeRow);
            CodeByHashRow codeByHashRow{
                .codeHash = codeHash,
                .code     = std::move(code),
            };
            self.kvPut(DbId::nativeSubjective, codeByHashRow.key(), codeByHashRow);
         }

         std::string rootHost = "psibase";

         for (const auto& [account, header] : package.data)
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
      }
      psibase::check(tester::raw::commitSubjective(self.nativeHandle()),
                     "Failed to commit changes");

      for (const auto& request : requests)
      {
         auto reply = self.http(request);
         if (reply.status != HttpStatus::ok)
         {
            auto message = std::format("PUT {} returned {}", request.target,
                                       static_cast<std::uint16_t>(reply.status));
            if (reply.contentType.starts_with("text/"))
            {
               message += ": ";
               message.append(reply.body.data(), reply.body.size());
            }
            abortMessage(message);
         }
      }
   }

   void startSession(psibase::TestChain& self)
   {
      using namespace psibase;
      HostConfigRow row{std::format("psitest-{}.{}.{}", PSIBASE_VERSION_MAJOR,
                                    PSIBASE_VERSION_MINOR, PSIBASE_VERSION_PATCH),
                        R"({"host":{"hosts":["psibase.io"]}})"};

      tester::raw::checkoutSubjective(self.nativeHandle());
      self.kvPut(row.db, row.key(), row);
      psibase::check(tester::raw::commitSubjective(self.nativeHandle()),
                     "Failed to commit changes");
      transactor<LocalService::XHttp> xhttp{AccountNumber{}, LocalService::XHttp::service};
      expect(tester::runAction(self.nativeHandle(), RunMode::rpc, true, xhttp.startSession()));
   }

}  // namespace

psibase::TestChain::TestChain(uint32_t chain_id, bool clone, bool pub, bool init, bool writable)
    : id{clone ? tester::raw::cloneChain(chain_id) : chain_id}, isPublicChain(pub)
{
   if (pub && numPublicChains++ == 0)
      psibase::tester::raw::selectedChain = id;
   if (init)
   {
      loadLocalServices(*this);
   }
   if (writable)
   {
      startSession(*this);
   }
}

psibase::TestChain::TestChain(const TestChain& other, bool pub)
    : TestChain{other.id, true, pub, false}
{
   status = other.status;
}

psibase::TestChain::TestChain(const DatabaseConfig& dbconfig, bool pub)
    : TestChain{tester::raw::createChain(dbconfig.hotBytes,
                                         dbconfig.warmBytes,
                                         dbconfig.coolBytes,
                                         dbconfig.coldBytes),
                false, pub}
{
}

psibase::TestChain::TestChain(uint64_t hot_bytes,
                              uint64_t warm_bytes,
                              uint64_t cool_bytes,
                              uint64_t cold_bytes)
    : TestChain(DatabaseConfig{hot_bytes, warm_bytes, cool_bytes, cold_bytes})
{
}

psibase::TestChain::TestChain(std::string_view path, int flags, const DatabaseConfig& cfg, bool pub)
    : TestChain(tester::raw::openChain(path.data(),
                                       path.size(),
                                       get_wasi_oflags(flags),
                                       get_wasi_rights(flags),
                                       &cfg),
                false,
                pub,
                (flags & (O_CREAT | O_TRUNC)) != 0,
                (get_wasi_rights(flags) & __WASI_RIGHTS_FD_WRITE) != 0)
{
}

psibase::TestChain::~TestChain()
{
   if (isPublicChain)
      --numPublicChains;
   tester::raw::destroyChain(id);
   if (selectedChain && *selectedChain == id)
      selectedChain.reset();
}

void psibase::TestChain::shutdown()
{
   tester::raw::shutdownChain(id);
}

void psibase::TestChain::setAutoBlockStart(bool enable)
{
   isAutoBlockStart = enable;
}

void psibase::TestChain::setAutoRun(bool enable)
{
   isAutoRun = enable;
}

void psibase::TestChain::startBlock(int64_t skip_miliseconds)
{
   if (producing)
      finishBlock();
   auto time = status ? status->head->header.time : TimePointSec{};
   startBlock(time + MicroSeconds{(1000 + skip_miliseconds) * 1000});
}

void psibase::TestChain::startBlock(std::string_view time)
{
   std::int64_t  sec;
   std::uint32_t nsec;
   if (!psio::parse_system_time(time, sec, nsec))
      abortMessage("bad time");
   startBlock(TimePointUSec{Seconds{sec} + MicroSeconds{nsec / 1000}});
}

void psibase::TestChain::startBlock(BlockTime tp)
{
   if (producing)
      finishBlock();

   auto producer = AccountNumber{"firstproducer"};
   if (status)
   {
      auto getFirstProducer = [&](const auto& c)
      {
         if (!c.producers.empty())
         {
            producer = c.producers.front().name;
         }
      };
      if (status->consensus.next)
         std::visit(getFirstProducer, status->consensus.next->consensus.data);
      if (!status->consensus.next || status->current.commitNum < status->consensus.next->blockNum)
         std::visit(getFirstProducer, status->consensus.current.data);
   }

   auto term      = status ? status->current.term : 0;
   auto commitNum = status ? status->head.value().header.blockNum : 0;

   // Guarantee that there is a recent block for fillTapos to use.
   if (status && status->head->header.time + Seconds(1) < tp)
   {
      tester::raw::startBlock(id, (tp - Seconds(1)).time_since_epoch().count(), producer.value,
                              term, commitNum);
      finishBlock();
      commitNum = status->head.value().header.blockNum;
   }
   tester::raw::startBlock(id, tp.time_since_epoch().count(), producer.value, term, commitNum);
   status    = kvGet<psibase::StatusRow>(psibase::StatusRow::db, psibase::statusKey());
   producing = true;
}

void psibase::TestChain::finishBlock()
{
   tester::raw::finishBlock(id);
   status    = kvGet<StatusRow>(StatusRow::db, statusKey());
   producing = false;
   if (isAutoRun)
      runAll();
}

void psibase::TestChain::setSignature(BlockNum blockNum, std::vector<char> sig)
{
   kvPut(DbId::blockProof, blockNum, std::move(sig));
   tester::raw::commitState(id);
}

void psibase::TestChain::fillTapos(Transaction& t, uint32_t expire_sec) const
{
   ScopedSelectChain s{id};
   t.tapos.expiration =
       (status ? std::chrono::time_point_cast<Seconds>(status->current.time) : TimePointSec{}) +
       Seconds(expire_sec);
   auto [index, suffix]   = SystemService::headTapos();
   t.tapos.refBlockIndex  = index;
   t.tapos.refBlockSuffix = suffix;
}

psibase::Transaction psibase::TestChain::makeTransaction(std::vector<Action>&& actions,
                                                         uint32_t              expire_sec) const
{
   Transaction t;
   fillTapos(t, expire_sec);
   t.actions = std::move(actions);
   return t;
}

psibase::SignedTransaction psibase::TestChain::signTransaction(Transaction trx, const KeyList& keys)
{
   for (auto& [pub, priv] : keys)
      trx.claims.push_back({
          .service = SystemService::VerifySig::service,
          .rawData = {pub.data.begin(), pub.data.end()},
      });
   SignedTransaction signedTrx;
   signedTrx.transaction = trx;
   auto hash             = sha256(signedTrx.transaction.data(), signedTrx.transaction.size());
   for (auto& [pub, priv] : keys)
   {
      auto proof = sign(priv, hash);
      signedTrx.proofs.push_back({proof.begin(), proof.end()});
   }
   return signedTrx;
}

namespace
{
   struct RunTokenData
   {
      bool                 success;
      psibase::RunMode     mode;
      psibase::Action      action;
      psibase::Checksum256 context;
      PSIO_REFLECT(RunTokenData, success, mode, action, context)
   };

   psibase::Checksum256 makeRunContext(psibase::TestChain&                      chain,
                                       psibase::RunMode                         mode,
                                       const std::optional<psibase::StatusRow>& status)
   {
      using namespace psibase;
      if (mode == RunMode::verify)
      {
         std::vector<BlockHeaderAuthAccount> result;
         if (status)
         {
            auto& consensus = status->consensus.next ? status->consensus.next->consensus
                                                     : status->consensus.current;
            for (auto service : consensus.services)
            {
               if (chain
                       .kvGet<CodeByHashRow>(
                           CodeByHashRow::db,
                           codeByHashKey(service.codeHash, service.vmType, service.vmVersion))
                       .has_value())
               {
                  result.push_back(service);
               }
            }
         }
         return sha256(result);
      }
      else
      {
         return Checksum256{};
      }
   }

   std::vector<std::optional<RunTokenData>> getRunTokens(psibase::TestChain&               chain,
                                                         const psibase::SignedTransaction& trx)
   {
      using namespace psibase;
      std::vector<std::optional<RunTokenData>> tokens;
      if (trx.proofs.empty())
         return tokens;
      if (auto row = chain.kvGet<NotifyRow>(DbId::nativeSubjective,
                                            notifyKey(NotifyType::preverifyTransaction)))
      {
         for (auto& act : row->actions)
         {
            check(act.sender == AccountNumber{} && act.rawData.empty(),
                  "Invalid preverifyTransaction callback");
            act.rawData = psio::to_frac(std::tuple(trx));
            auto trace  = tester::runAction(chain.nativeHandle(), RunMode::callback, false, act);
            if (trace.error)
               abortMessage("preverify failed: " + *trace.error);
            check(trace.actionTraces.size() == 1, "Wrong number of action traces");
            if (auto result = psio::from_frac<std::optional<std::vector<std::optional<RunToken>>>>(
                    trace.actionTraces.front().rawRetval))
            {
               for (const auto& token : *result)
               {
                  if (token)
                  {
                     tokens.push_back(psio::from_frac<RunTokenData>(*token));
                  }
                  else
                  {
                     tokens.emplace_back();
                  }
               }
               break;
            }
         }
      }
      tokens.resize(trx.proofs.size());
      return tokens;
   }

   void callRejectTransaction(psibase::TestChain&              chain,
                              const psibase::Checksum256&      id,
                              const psibase::TransactionTrace& trace)
   {
      using namespace psibase;
      if (auto row = chain.kvGet<NotifyRow>(DbId::native, notifyKey(NotifyType::rejectTransaction)))
      {
         for (auto& act : row->actions)
         {
            check(act.sender == AccountNumber{} && act.rawData.empty(),
                  "Invalid rejectTransaction callback");
            act.rawData = psio::to_frac(std::tie(id, trace));
            auto trace  = tester::runAction(chain.nativeHandle(), RunMode::callback, false, act);
            if (trace.error)
               abortMessage("onTransaction failed: " + *trace.error);
         }
      }
   }

   psibase::TransactionTrace verifySignatures(psibase::TestChain&                      chain,
                                              const std::optional<psibase::StatusRow>& status,
                                              const psibase::SignedTransaction&        trx)
   {
      using namespace psibase;
      auto trxId  = sha256(trx.transaction.data(), trx.transaction.size());
      auto claims = trx.transaction->claims();
      if (trx.proofs.size() != claims.size())
      {
         return TransactionTrace{.error = "proofs and claims must have same size"};
      }
      auto tokens        = getRunTokens(chain, trx);
      auto verifyContext = makeRunContext(chain, RunMode::verify, status);
      for (auto&& [claim, proof, token] : std::views::zip(claims, trx.proofs, tokens))
      {
         VerifyArgs args{trxId, claim, proof};
         Action     act{.sender  = AccountNumber{},
                        .service = claim.service(),
                        .method  = MethodNumber("verifySys"),
                        .rawData = psio::to_frac(args)};
         if (token && token->success && token->mode == RunMode::verify && token->action == act &&
             token->context == verifyContext)
         {
            // skip execution
         }
         else
         {
            auto trace = tester::runAction(chain.nativeHandle(), RunMode::verify, true, act);
            if (trace.error)
            {
               // We're not running pushTransaction, so we need
               // to run the failure callback ourselves.
               callRejectTransaction(chain, trxId, trace);
               return trace;
            }
         }
      }
      return {};
   }
}  // namespace

[[nodiscard]] psibase::TransactionTrace psibase::TestChain::pushTransaction(
    const SignedTransaction& signedTrx)
{
   if (!producing)
      startBlock();
   if (auto trace = verifySignatures(*this, status, signedTrx); trace.error)
   {
      return trace;
   }
   return tester::pushTransaction(id, signedTrx);
}

[[nodiscard]] psibase::TransactionTrace psibase::TestChain::pushTransaction(Transaction    trx,
                                                                            const KeyList& keys)
{
   return pushTransaction(signTransaction(std::move(trx), keys));
}

void psibase::TestChain::pushBlock(const SignedBlock& block)
{
   auto& header = block.block.header;
   tester::raw::getFork(id, block.block.header.previous);
   tester::raw::startBlock(id, header.time.time_since_epoch().count(), header.producer.value,
                           header.term, header.commitNum);
   status    = kvGet<psibase::StatusRow>(psibase::StatusRow::db, psibase::statusKey());
   producing = true;
   for (auto& trx : block.block.transactions)
   {
      expect(pushTransaction(trx));
   }
   finishBlock();
   BlockInfo info{header};
   if (info.blockId != status->head->blockId)
   {
      abortMessage(std::format("block header does not match: {} != {}",
                               psio::convert_to_json(info.header),
                               psio::convert_to_json(status->head->header)));
   }
}

std::optional<psibase::TransactionTrace> psibase::TestChain::pushNextTransaction()
{
   if (auto row = kvGet<NotifyRow>(DbId::nativeSubjective, notifyKey(NotifyType::nextTransaction)))
   {
      for (auto& act : row->actions)
      {
         check(act.sender == AccountNumber{} && act.rawData.empty(),
               "Invalid nextTransaction callback");
         act.rawData = psio::to_frac(std::tuple());
         auto trace  = tester::runAction(id, RunMode::callback, false, act);
         if (trace.error)
            abortMessage("nextTransaction failed:\n" + prettyTrace(trace));
         check(trace.actionTraces.size() == 1, "Wrong number of action traces");
         if (auto tx = psio::from_frac<std::optional<SignedTransaction>>(
                 trace.actionTraces.front().rawRetval))
         {
            return pushTransaction(*tx);
         }
      }
   }
   return {};
}

bool psibase::TestChain::runQueueItem()
{
   if (auto row = kvGreaterEqual<RunRow>(RunRow::db, runPrefix(),
                                         psio::convert_to_key(runPrefix()).size()))
   {
      auto trace = tester::runAction(id, row->mode, true, row->action);
      auto token = psio::to_frac(RunTokenData{!trace.error, row->mode, row->action,
                                              makeRunContext(*this, row->mode, status)});
      auto continuationArgs =
          psio::to_frac(std::tuple(row->id, std::move(trace), std::move(token)));
      auto continuation      = Action{.service = row->continuation.service,
                                      .method  = row->continuation.method,
                                      .rawData = std::move(continuationArgs)};
      auto continuationTrace = tester::runAction(id, RunMode::rpc, true, continuation);
      if (continuationTrace.error)
         abortMessage("Continuation failed: " + *continuationTrace.error);
      return true;
   }
   else
   {
      return false;
   }
}

void psibase::TestChain::runAll()
{
   while (pushNextTransaction() || runQueueItem())
   {
   }
}

psibase::AsyncHttpReply psibase::TestChain::asyncHttp(const HttpRequest& request)
{
   if (producing && isAutoBlockStart)
      finishBlock();

   std::vector<char> packed_request = psio::convert_to_frac(request);
   auto fd = tester::raw::httpRequest(id, packed_request.data(), packed_request.size());
   if (isAutoRun)
      runAll();

   return AsyncHttpReply{fd};
}

std::optional<psibase::HttpReply> psibase::AsyncHttpReply::poll()
{
   std::size_t size;
   if (auto err = tester::raw::socketRecv(fd, &size))
   {
      if (err == EAGAIN)
      {
         return {};
      }
      else
      {
         abortMessage("Could not read response: " + std::to_string(err));
      }
   }

   fd = -1;
   return psio::from_frac<HttpReply>(getResult(size));
}

psibase::HttpReply psibase::TestChain::http(const HttpRequest& request)
{
   return asyncHttp(request).get();
}

std::optional<std::vector<char>> psibase::TestChain::kvGetRaw(psibase::DbId      db,
                                                              psio::input_stream key)
{
   auto size = tester::raw::kvGet(id, db, key.pos, key.remaining());
   if (size == -1)
      return std::nullopt;
   return psibase::getResult(size);
}

std::optional<std::vector<char>> psibase::TestChain::kvGreaterEqualRaw(DbId               db,
                                                                       psio::input_stream key,
                                                                       uint32_t matchKeySize)
{
   auto size = tester::raw::kvGreaterEqual(id, db, key.pos, key.remaining(), matchKeySize);
   if (size == -1)
      return std::nullopt;
   return psibase::getResult(size);
}

void psibase::TestChain::kvPutRaw(DbId db, psio::input_stream key, psio::input_stream value)
{
   tester::raw::kvPut(id, db, key.pos, key.remaining(), value.pos, value.remaining());
}
