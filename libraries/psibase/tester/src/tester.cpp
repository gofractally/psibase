#include <psibase/tester.hpp>
#include <psibase/testerApi.hpp>

#include <services/system/Transact.hpp>
#include <services/system/VerifySig.hpp>

#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

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

std::vector<char> psibase::readWholeFile(std::string_view filename)
{
   auto fail = [&] { check(false, "read " + std::string(filename) + " failed"); };
   int  fd   = ::open(std::string(filename).c_str(), O_RDONLY);
   if (fd < 0)
      fail();
   struct stat stat;
   if (::fstat(fd, &stat) < 0)
      fail();
   if (stat.st_size > std::numeric_limits<std::size_t>::max())
      fail();
   std::vector<char> result(static_cast<std::size_t>(stat.st_size));
   char*             pos       = result.data();
   std::size_t       remaining = result.size();
   while (remaining)
   {
      auto count = ::read(fd, pos, remaining);
      if (count < 0)
         fail();
      remaining -= count;
      pos += count;
   }
   ::close(fd);
   return result;
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

psibase::TestChain::TestChain(uint32_t chain_id, bool clone, bool pub)
    : id{clone ? tester::raw::cloneChain(chain_id) : chain_id}, isPublicChain(pub)
{
   if (pub && numPublicChains++ == 0)
      psibase::tester::raw::selectedChain = id;
}

psibase::TestChain::TestChain(const TestChain& other, bool pub) : TestChain{other.id, true, pub}
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
                pub)
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

void psibase::TestChain::startBlock(int64_t skip_miliseconds)
{
   auto time = status ? status->current.time : TimePointSec{};
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
   // Guarantee that there is a recent block for fillTapos to use.
   if (status && status->current.time + Seconds(1) < tp)
      tester::raw::startBlock(id, (tp - Seconds(1)).time_since_epoch().count());
   tester::raw::startBlock(id, tp.time_since_epoch().count());
   status    = kvGet<psibase::StatusRow>(psibase::StatusRow::db, psibase::statusKey());
   producing = true;
}

void psibase::TestChain::finishBlock()
{
   tester::raw::finishBlock(id);
   producing = false;
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

[[nodiscard]] psibase::TransactionTrace psibase::TestChain::pushTransaction(
    const SignedTransaction& signedTrx)
{
   if (!producing)
      startBlock();
   std::vector<char> packed_trx = psio::convert_to_frac(signedTrx);
   auto              size = tester::raw::pushTransaction(id, packed_trx.data(), packed_trx.size());
   return psio::from_frac<TransactionTrace>(getResult(size));
}

[[nodiscard]] psibase::TransactionTrace psibase::TestChain::pushTransaction(Transaction    trx,
                                                                            const KeyList& keys)
{
   return pushTransaction(signTransaction(std::move(trx), keys));
}

psibase::HttpReply psibase::TestChain::http(const HttpRequest& request)
{
   if (producing && isAutoBlockStart)
      finishBlock();

   std::vector<char> packed_request = psio::convert_to_frac(request);
   auto        fd = tester::raw::httpRequest(id, packed_request.data(), packed_request.size());
   std::size_t size;
   if (auto err = tester::raw::socketRecv(fd, &size))
   {
      if (err == EAGAIN)
      {
         abortMessage("Query did not return a synchronous response");
      }
      else
      {
         abortMessage("Could not read response: " + std::to_string(err));
      }
   }

   return psio::from_frac<HttpReply>(getResult(size));
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
