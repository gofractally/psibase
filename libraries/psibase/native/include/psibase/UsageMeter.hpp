#pragma once

// The node's usage meter (gofractally/psibase#2270): how much each identity
// used of this node. Phase 1 measures and reports; nothing is refused.
//
// Nothing here is consensus. The counters live in memory; a single thread
// writes them every few seconds to a native table of the node's own
// (subjective) storage, and loads them again when the node starts.
//
// Cost on the paths that already exist:
//  - find(): one hash lookup under the meter's own mutex, once per request
//    or per run. The mutex is shared with nothing else.
//  - UsageRecord::add(): one relaxed atomic add.
//  - No database access and no wasm call outside flush().
//
// See psibase/usage.hpp for identities, counters and the retention rule.

#include <psibase/db.hpp>
#include <psibase/nativeTables.hpp>
#include <psibase/usage.hpp>
#include <span>
#include <string_view>

#include <array>
#include <atomic>
#include <chrono>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <unordered_map>
#include <vector>

namespace psibase
{
   // The live record of one identity. Measuring points hold a
   // shared_ptr to it and add to its counters; everything else in it
   // belongs to the meter.
   struct UsageRecord
   {
      explicit UsageRecord(UsageIdentity identity) : identity(std::move(identity)) {}
      UsageRecord(const UsageRecord&)            = delete;
      UsageRecord& operator=(const UsageRecord&) = delete;

      const UsageIdentity identity;

      void add(UsageField field, std::uint64_t n) noexcept
      {
         counters[static_cast<std::size_t>(field)].fetch_add(n, std::memory_order_relaxed);
      }
      void add(UsageField field, std::chrono::nanoseconds time) noexcept
      {
         if (time.count() > 0)
            add(field, static_cast<std::uint64_t>(time.count()));
      }
      UsageCounters snapshot() const noexcept;

      // True once the meter no longer lists this record (it expired or was
      // evicted). Counts added to it afterwards are not lost, they go to
      // the aggregate it was folded into; but a holder that can look its
      // identity up again should.
      bool detached() const noexcept { return detachedFlag.load(std::memory_order_relaxed); }

     private:
      friend class UsageMeter;
      std::array<std::atomic<std::uint64_t>, numUsageFields> counters{};
      std::atomic<bool>                                      detachedFlag{false};

      // Owned by the meter (flushMutex)
      std::uint64_t firstSeen = 0;
      std::uint64_t lastSeen  = 0;
      std::uint64_t window    = 0;
      UsageCounters flushed;   // the totals at the last flush
      UsageCounters current;
      UsageCounters previous;
      bool          dirty = true;
      // Where this record's later counts go once it is detached
      std::shared_ptr<UsageRecord> foldInto;
   };
   using UsageHandle = std::shared_ptr<UsageRecord>;

   struct UsageSettings
   {
      // usage-metering. When off, find() returns null and every measuring
      // point does nothing.
      bool enabled = true;
      // usage-max-records: the hard bound on live records, per kind. The
      // anonymous tier is unauthenticated, so the table must not grow with
      // the number of addresses someone can use.
      std::size_t maxRecords = 4096;
      // usage-window: the length of the "recent use" windows.
      std::uint64_t windowSeconds = 3600;
      // usage-flush-interval: used by whoever calls flush(); published.
      std::uint64_t flushSeconds = 10;
      // usage-retention-base, usage-retention-per-unit, usage-retention-max
      UsageRetention retention;
      // usage-trusted-proxy
      std::vector<IPAddressPrefix> trustedProxies;
   };

   class UsageMeter
   {
     public:
      explicit UsageMeter(UsageSettings settings = {});
      // Replaces the settings. Only before the meter is used (the node
      // applies its configuration to the meter its shared state created).
      void configure(UsageSettings settings) { settings_ = std::move(settings); }

      bool                 enabled() const { return settings_.enabled; }
      const UsageSettings& settings() const { return settings_; }

      // The record to charge for this identity; null if metering is off.
      // If the identity's kind already has maxRecords records, the result is
      // that kind's overflow record until a flush has made room. An invalid
      // identity is charged to `local:unknown`.
      UsageHandle find(const UsageIdentity& identity);
      // find(), keeping `cached` if it is still the live record of `identity`.
      UsageHandle find(const UsageIdentity& identity, const UsageHandle& cached);
      // Work that no connection caused.
      UsageHandle node() { return find(UsageIdentity::local("node")); }

      // The identity that posted a run, remembered in memory from the write
      // of its row until the row is removed. At most maxRunOrigins are
      // remembered; beyond that the oldest is forgotten. A run with no
      // remembered origin (posted before a restart, or forgotten) is
      // charged to `local:unknown`; a run posted by work that had no
      // identity to `local:node`.
      static constexpr std::size_t maxRunOrigins = 65536;
      void                         setRunOrigin(std::uint64_t run, const UsageHandle& origin);
      void                         clearRunOrigin(std::uint64_t run);
      UsageHandle                  runOrigin(std::uint64_t run);

      // PHASE 2 HOOK. Called where work for an identity is about to start
      // (a request before it is served, a posted run before it executes).
      // Phase 1 never refuses: quotas are stored settings of the x-usage
      // service that nothing reads here. Enforcement goes in this function.
      void enforceQuota(const UsageHandle& /*who*/) {}

      // Storage. All three must run on the thread that owns `writer`, and
      // flush() on one thread at a time. That thread must be one that uses
      // the database anyway (psinode: the chain thread): the engine has a
      // fixed number of session slots, one per thread, and metering must
      // not take one (gofractally/psibase#2273).
      //
      // load: reads the stored records; call once, before use.
      // publishSettings: writes UsageConfigRow for the reporting service.
      // flush: applies what was counted since the last flush to the windows,
      //   drops expired records, evicts down to the bound, and writes every
      //   changed row (absolute values, so a repeated or interrupted flush
      //   is harmless and a crash loses at most one interval).
      void load(SharedDatabase& db, Writer& writer);
      void publishSettings(SharedDatabase& db, Writer& writer);
      //
      // A flush has two halves, so that the thread that owns the database
      // session is held as briefly as possible:
      //
      // prepareFlush: gathers what changed and serializes it. Uses no
      //   storage and may run on any one thread. Does nothing while rows
      //   of an earlier flush are still unwritten. Returns how many rows
      //   wait to be written.
      // writeFlush: writes at most maxRows of them, in batches of 128 (one
      //   acquisition of the subjective write lock each), and says how
      //   many are left. psinode writes one batch per task of the chain
      //   thread, so the chain thread is never held for more than a batch.
      // flush: both, everything.
      struct FlushResult
      {
         std::size_t written   = 0;
         std::size_t remaining = 0;
         std::size_t batches   = 0;
         // prepareFlush (no storage, no subjective lock); set by flush()
         std::chrono::nanoseconds collectTime{0};
         // Writing: all batches, and the longest one. A batch holds the
         // subjective write lock for its whole duration.
         std::chrono::nanoseconds writeTime{0};
         std::chrono::nanoseconds maxBatchTime{0};
      };
      static constexpr std::size_t allRows   = ~std::size_t{0};
      static constexpr std::size_t batchRows = 128;
      std::size_t prepareFlush(std::chrono::nanoseconds* time = nullptr);
      FlushResult writeFlush(SharedDatabase& db, Writer& writer, std::size_t maxRows = allRows);
      FlushResult flush(SharedDatabase& db, Writer& writer);

      // The same without storage (tests): returns the rows a flush would
      // write and the identities it would remove.
      struct Changes
      {
         std::vector<UsageRow>      rows;
         std::vector<UsageIdentity> removed;
      };
      Changes collect();

      // The current rows, including what has not been flushed yet. An
      // aggregate appears a second time for counts that are still on their
      // way to it; add the rows of one identity together.
      std::vector<UsageRow> rows();
      // Per kind (aggregates added to the kind they belong to): what the
      // metrics endpoint exports.
      struct KindTotal
      {
         UsageKind     kind;
         std::size_t   records = 0;
         UsageCounters total;
      };
      std::vector<KindTotal> totals();

      // Seconds since the Unix epoch. Replaceable in tests.
      std::function<std::uint64_t()> clock;

     private:
      struct IdentityHash
      {
         std::size_t operator()(const UsageIdentity& id) const noexcept
         {
            return std::hash<std::string>{}(id.id) * 31 + static_cast<std::size_t>(id.kind);
         }
      };
      using Map = std::unordered_map<UsageIdentity, UsageHandle, IdentityHash>;

      UsageHandle  findLocked(const UsageIdentity& identity);
      UsageHandle  aggregateLocked(UsageKind aggregateKind, UsageKind of);
      std::size_t& liveCount(UsageKind kind);
      UsageRow     toRow(const UsageRecord& record, const UsageCounters& total) const;
      void         detach(const UsageHandle& record, UsageKind into, Changes& changes);

      UsageSettings settings_;

      // Guards records_, liveCounts_. Never held while storage is used.
      std::mutex                       mutex_;
      Map                              records_;
      std::map<UsageKind, std::size_t> liveCounts_;

      // Guards the flush state of every record and detached_.
      std::mutex               flushMutex_;
      std::vector<UsageHandle> detached_;
      // Rows prepared and not yet written
      std::mutex                                   pendingMutex_;
      std::vector<SharedDatabase::SubjectiveWrite> pending_;

      std::mutex                                     runMutex_;
      // Ordered: run ids grow, so the first entry is the oldest.
      std::map<std::uint64_t, UsageHandle> runOrigins_;
   };

   // The identity of one client connection, resolved once and kept with the
   // connection (the HTTP session), so that a request costs no lookup, no
   // lock, no allocation and no system call:
   //
   //  - The transport peer is looked at once: its address, whether its
   //    forwarding headers are believed, and its own record.
   //  - Behind a trusted proxy the client is named by the request's
   //    forwarding headers. The record found for one set of header values
   //    is kept, and the next request is compared with those values; only a
   //    request whose headers differ is resolved again.
   //  - A kept record is looked up again if it was dropped or evicted in
   //    the meantime, or if it is an overflow record (the table was full).
   //
   // Not thread-safe: a connection handles one request at a time.
   class UsageConnection
   {
     public:
      struct ForwardedHeader
      {
         std::string_view name;   // "Forwarded" or "X-Forwarded-For"
         std::string_view value;
      };

      // First: whether the request's forwarding headers are to be passed to
      // record(). `endpoint()` is called once per connection and returns
      // the transport peer (std::optional<SocketEndpoint>).
      template <typename F>
      bool trusted(UsageMeter& meter, F&& endpoint)
      {
         if (!resolved_)
         {
            endpoint_ = endpoint();
            trusted_  = endpoint_ && isTrustedUsageProxy(*endpoint_, meter.settings().trustedProxies);
            resolved_ = true;
         }
         return trusted_;
      }
      // Then: the record this request is charged to (null if metering is
      // off). `forwarded` are the request's Forwarded and X-Forwarded-For
      // headers in order, empty if the peer is not trusted or sent none.
      const UsageHandle& record(UsageMeter& meter, std::span<const ForwardedHeader> forwarded);

     private:
      static bool usable(const UsageHandle& handle)
      {
         return handle && !handle->detached() && !isAggregate(handle->identity.kind);
      }
      bool                                             resolved_ = false;
      bool                                             trusted_  = false;
      std::optional<SocketEndpoint>                    endpoint_;
      UsageHandle                                      direct_;
      // What forwarded_ was resolved from
      std::vector<std::pair<std::string, std::string>> forwardedKey_;
      UsageHandle                                      forwarded_;
   };
}  // namespace psibase
