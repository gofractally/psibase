#include <psibase/db.hpp>

#include <psibase/Socket.hpp>
#include <psibase/nativeTables.hpp>
#include <psitri/database.hpp>
#include <psitri/write_session_impl.hpp>

namespace psibase
{
   // ── Constants ────────────────────────────────────────────────────────

   // Root 0: consensus (objective) — all chain databases with DbId prefix
   // Root 1: subjective — subjective databases with DbId prefix
   // Root 2: meta — revision management (head, block revisions)
   static constexpr uint32_t consensusRootIndex  = 0;
   static constexpr uint32_t subjectiveRootIndex = 1;
   static constexpr uint32_t metaRootIndex       = 2;

   // Meta-tree key prefixes
   static constexpr char metaHeadPrefix       = 0;
   static constexpr char metaRevisionByPrefix = 1;

   static const char metaHeadKey[] = {metaHeadPrefix};

   // Reserved consensus key for prevAuthServices subtree
   static constexpr char prevAuthServicesKey[] = {'\xff', '\x00'};

   static constexpr std::size_t maxSubjectiveTransactionDepth = 8;

   static auto metaRevisionById(const Checksum256& blockId)
   {
      std::array<char, sizeof(Checksum256) + 1> result;
      result[0] = metaRevisionByPrefix;
      memcpy(result.data() + 1, blockId.data(), blockId.size());
      return result;
   }

   // ── SharedDatabaseImpl ──────────────────────────────────────────────

   struct SharedDatabaseImpl
   {
      psitri::database_ptr db;
      DatabaseCallbacks*   callbacks = nullptr;

      SharedDatabaseImpl(const std::filesystem::path&   dir,
                         const psitri::runtime_config&  config,
                         psitri::open_mode              mode)
      {
         db = psitri::database::open(dir, mode, config);
      }

      SharedDatabaseImpl(const SharedDatabaseImpl& other)
          : db(other.db)
      {
      }

      // Head is just root 0 — get_root uses RW locks internally, thread-safe.
      ConstRevisionPtr getHead(psitri::write_session& ws)
      {
         return ws.get_root(consensusRootIndex);
      }

      // Meta-tree operations use a write_cursor directly rather than
      // start_transaction(), because start_transaction() acquires a
      // per-root lock — and setHead + writeRevision are often called
      // together, which would deadlock on root 2.
      //
      // The meta tree (root 2) is only mutated by a single writer thread,
      // so no locking is required.

      void setHead(psitri::write_session& ws, ConstRevisionPtr newHead)
      {
         // Update meta tree: store head pointer as subtree value
         auto                 metaRoot = ws.get_root(metaRootIndex);
         psitri::write_cursor wc = metaRoot ? psitri::write_cursor(std::move(metaRoot))
                                            : psitri::write_cursor(ws.allocator_session());
         auto headKey = std::string_view(metaHeadKey, sizeof(metaHeadKey));
         wc.upsert(headKey, newHead);
         ws.set_root(metaRootIndex, wc.root(), ws.get_sync());

         // Publish to root 0 so readers can snapshot the consensus tree
         ws.set_root(consensusRootIndex, std::move(newHead), ws.get_sync());
      }

      void writeRevision(psitri::write_session& ws,
                         const Checksum256&     blockId,
                         ConstRevisionPtr       root)
      {
         auto                 metaRoot = ws.get_root(metaRootIndex);
         psitri::write_cursor wc = metaRoot ? psitri::write_cursor(std::move(metaRoot))
                                            : psitri::write_cursor(ws.allocator_session());
         auto key = metaRevisionById(blockId);
         wc.upsert(std::string_view(key.data(), key.size()), std::move(root));
         ws.set_root(metaRootIndex, wc.root(), ws.get_sync());
      }
   };

   // ── SharedDatabase ──────────────────────────────────────────────────

   SharedDatabase::SharedDatabase(const std::filesystem::path&   dir,
                                  const psitri::runtime_config&  config,
                                  psitri::open_mode              mode)
       : impl{std::make_shared<SharedDatabaseImpl>(dir, config, mode)}
   {
   }

   SharedDatabase SharedDatabase::clone() const
   {
      SharedDatabase result{*this};
      result.impl = std::make_shared<SharedDatabaseImpl>(*impl);
      return result;
   }

   ConstRevisionPtr SharedDatabase::getHead(Writer& writer)
   {
      return impl->getHead(writer);
   }

   ConstRevisionPtr SharedDatabase::getHead()
   {
      auto rs = impl->db->start_read_session();
      return rs->get_root(consensusRootIndex);
   }

   ConstRevisionPtr SharedDatabase::emptyRevision()
   {
      // null smart_ptr = empty revision
      return {};
   }

   WriteSessionPtr SharedDatabase::createWriter()
   {
      return impl->db->start_write_session();
   }

   void SharedDatabase::setHead(Writer& writer, ConstRevisionPtr revision)
   {
      impl->setHead(writer, std::move(revision));
   }

   ConstRevisionPtr SharedDatabase::getRevision(Writer& writer, const Checksum256& blockId)
   {
      auto metaRoot = writer.get_root(metaRootIndex);
      if (!metaRoot)
         return {};

      psitri::cursor c(metaRoot);
      auto           key = metaRevisionById(blockId);
      if (!c.seek(std::string_view(key.data(), key.size())))
         return {};
      if (c.is_subtree())
         return ConstRevisionPtr(c.subtree());
      return {};
   }

   void SharedDatabase::writeRevision(Writer& writer, const Checksum256& blockId, ConstRevisionPtr root)
   {
      impl->writeRevision(writer, blockId, std::move(root));
   }

   void SharedDatabase::removeRevisions(Writer& writer, const Checksum256& irreversible)
   {
      // Get nativeSubjective root for snapshot checks
      auto subjectiveRoot = writer.get_root(subjectiveRootIndex);

      // Use write_cursor directly (not start_transaction) — same thread
      // reasoning as setHead/writeRevision.
      auto metaRoot = writer.get_root(metaRootIndex);
      if (!metaRoot)
         return;

      psitri::write_cursor wc(std::move(metaRoot));
      auto cursor = wc.read_cursor();

      // Build the range prefix for revision-by-id entries
      std::string_view revPrefix(&metaRevisionByPrefix, 1);

      // Scan all revisionById entries
      bool hasIrreversible = false;

      if (!cursor.lower_bound(revPrefix))
         return;  // no revision entries (lower_bound returns false at end)

      // Collect keys to remove (can't modify during iteration with write_cursor)
      std::vector<std::vector<char>> keysToRemove;

      do
      {
         auto k = cursor.key();
         if (k.empty() || k[0] != metaRevisionByPrefix)
            break;
         if (k.size() != 1 + sizeof(Checksum256))
            break;

         Checksum256 id;
         std::memcpy(id.data(), k.data() + 1, id.size());

         if (memcmp(k.data() + 1, irreversible.data(), sizeof(BlockNum)) > 0)
            break;

         if (id == irreversible)
         {
            hasIrreversible = true;
         }
         else
         {
            // Check if this block is a saved snapshot (in subjective tree)
            bool isSnapshot = false;
            if (subjectiveRoot)
            {
               psitri::cursor sc(subjectiveRoot);
               std::vector<char> snKey;
               snKey.push_back(static_cast<char>(DbId::nativeSubjective));
               auto snapKey = psio::convert_to_key(snapshotKey(id));
               snKey.insert(snKey.end(), snapKey.begin(), snapKey.end());
               isSnapshot = sc.seek(std::string_view(snKey.data(), snKey.size()));
            }

            if (!isSnapshot)
               keysToRemove.push_back(std::vector<char>(k.begin(), k.end()));
         }
      } while (cursor.next());

      for (auto& key : keysToRemove)
         wc.remove(std::string_view(key.data(), key.size()));

      if (hasIrreversible)
      {
         // Remove forks that build on removed blocks
         auto irrevKey = metaRevisionById(irreversible);

         std::vector<char> searchKey(irrevKey.begin(), irrevKey.end());
         searchKey.push_back(0);

         keysToRemove.clear();
         auto cursor2 = wc.read_cursor();
         if (cursor2.lower_bound(std::string_view(searchKey.data(), searchKey.size())))
         {
            do
            {
               auto k = cursor2.key();
               if (k.empty() || k[0] != metaRevisionByPrefix)
                  break;
               if (k.size() != 1 + sizeof(Checksum256))
                  break;

               if (!cursor2.is_subtree())
                  continue;
               auto forkRoot = cursor2.subtree();
               if (!forkRoot)
                  continue;

               // Read StatusRow from the fork's consensus tree
               psitri::cursor fc(forkRoot);
               auto           sk = psio::convert_to_key(statusKey());

               // StatusRow lives in DbId::native — prefix with DbId byte
               std::vector<char> prefixedSk;
               prefixedSk.push_back(static_cast<char>(DbId::native));
               prefixedSk.insert(prefixedSk.end(), sk.begin(), sk.end());

               auto statusBytes = fc.get<std::vector<char>>(
                   std::string_view(prefixedSk.data(), prefixedSk.size()));
               if (!statusBytes)
                  throw std::runtime_error("Status row missing in fork");

               auto status = psio::from_frac<StatusRow>(
                   psio::prevalidated{statusBytes->data(),
                                     statusBytes->data() + statusBytes->size()});
               if (!status.head)
                  throw std::runtime_error(
                      "Status row is missing head information in fork");

               // Check if the previous block is still present in meta tree
               auto prevKey = metaRevisionById(status.head->header.previous);
               auto cursor3 = wc.read_cursor();
               if (!cursor3.seek(std::string_view(prevKey.data(), prevKey.size())))
               {
                  // previous block not found — mark for removal
                  keysToRemove.push_back(std::vector<char>(k.begin(), k.end()));
               }
            } while (cursor2.next());
         }

         for (auto& key : keysToRemove)
            wc.remove(std::string_view(key.data(), key.size()));
      }

      writer.set_root(metaRootIndex, wc.root(), writer.get_sync());
   }

   void SharedDatabase::kvPutSubjective(Writer&               writer,
                                        DbId                  db,
                                        std::span<const char> key,
                                        std::span<const char> value)
   {
      auto tx = writer.start_transaction(subjectiveRootIndex, psitri::tx_mode::batch);

      // Prefix key with DbId
      std::vector<char> prefixedKey;
      prefixedKey.reserve(1 + key.size());
      prefixedKey.push_back(static_cast<char>(db));
      prefixedKey.insert(prefixedKey.end(), key.begin(), key.end());

      tx.upsert(std::string_view(prefixedKey.data(), prefixedKey.size()),
                std::string_view(value.data(), value.size()));
      tx.commit();
   }

   void SharedDatabase::kvRemoveSubjective(Writer& writer, DbId db, std::span<const char> key)
   {
      auto tx = writer.start_transaction(subjectiveRootIndex, psitri::tx_mode::batch);

      std::vector<char> prefixedKey;
      prefixedKey.reserve(1 + key.size());
      prefixedKey.push_back(static_cast<char>(db));
      prefixedKey.insert(prefixedKey.end(), key.begin(), key.end());

      tx.remove(std::string_view(prefixedKey.data(), prefixedKey.size()));
      tx.commit();
   }

   std::optional<std::vector<char>> SharedDatabase::kvGetSubjective(Writer&               writer,
                                                                    DbId                  db,
                                                                    std::span<const char> key)
   {
      auto root = writer.get_root(subjectiveRootIndex);
      if (!root)
         return std::nullopt;

      std::vector<char> prefixedKey;
      prefixedKey.reserve(1 + key.size());
      prefixedKey.push_back(static_cast<char>(db));
      prefixedKey.insert(prefixedKey.end(), key.begin(), key.end());

      psitri::cursor c(root);
      return c.get<std::vector<char>>(
          std::string_view(prefixedKey.data(), prefixedKey.size()));
   }

   sal::allocator_session_ptr SharedDatabase::readAllocatorSession() const
   {
      auto rs = impl->db->start_read_session();
      return rs->allocator_session();
   }

   bool SharedDatabase::isSlow() const
   {
      // psitri doesn't have a "slow" mode indicator
      return false;
   }

   std::vector<std::span<const char>> SharedDatabase::span() const
   {
      // psitri doesn't expose raw memory spans the same way triedent did
      return {};
   }

   void SharedDatabase::setCallbacks(DatabaseCallbacks* callbacks)
   {
      impl->callbacks = callbacks;
   }

   DatabaseCallbacks* SharedDatabase::getCallbacks() const
   {
      return impl->callbacks;
   }

   // ── KVStore helpers ─────────────────────────────────────────────────

   std::string_view KVStore::prefixKey(DbId db, std::span<const char> key)
   {
      _prefixedKey.clear();
      _prefixedKey.reserve(1 + key.size());
      _prefixedKey.push_back(static_cast<char>(db));
      _prefixedKey.insert(_prefixedKey.end(), key.begin(), key.end());
      return {_prefixedKey.data(), _prefixedKey.size()};
   }

   static bool isEphemeral(DbId db)
   {
      return db >= DbId::endPersistent;
   }

   static bool isSubjective(DbId db)
   {
      // All independent databases (subjective, nativeSubjective, session, nativeSession)
      // are stored in psitri root 1.  Session databases are "not preserved when the server
      // exits" but must persist during a running session — they live in the same subjective
      // tree and are cleared on startup rather than stored in ephemeral maps.
      return db >= DbId::beginIndependent && db < DbId::endIndependent;
   }

   KVStore::MemoryKV* kvStoreEphemeral(KVStore& store, DbId db)
   {
      switch (db)
      {
         case DbId::temporary: return &store.temporary;
         default: return nullptr;
      }
   }

   // ── Ephemeral helpers ───────────────────────────────────────────────

   std::optional<psio::input_stream> KVStore::ephemeralGet(MemoryKV&          m,
                                                           psio::input_stream key)
   {
      auto it = m.find(std::vector<char>(key.pos, key.end));
      if (it == m.end())
         return {};
      return psio::input_stream{it->second};
   }

   std::optional<KVStore::KVResult> KVStore::ephemeralGreaterEqual(MemoryKV&          m,
                                                                   psio::input_stream key,
                                                                   size_t matchKeySize)
   {
      auto it = m.lower_bound(std::vector<char>(key.pos, key.end));
      if (it == m.end())
         return {};
      if (matchKeySize &&
          (it->first.size() < matchKeySize ||
           memcmp(it->first.data(), key.pos, matchKeySize) != 0))
         return {};
      return KVResult{{it->first}, {it->second}};
   }

   std::optional<KVStore::KVResult> KVStore::ephemeralLessThan(MemoryKV&          m,
                                                               psio::input_stream key,
                                                               size_t matchKeySize)
   {
      auto it = m.lower_bound(std::vector<char>(key.pos, key.end));
      if (it == m.begin())
         return {};
      --it;
      if (matchKeySize &&
          (it->first.size() < matchKeySize ||
           memcmp(it->first.data(), key.pos, matchKeySize) != 0))
         return {};
      return KVResult{{it->first}, {it->second}};
   }

   std::optional<KVStore::KVResult> KVStore::ephemeralMax(MemoryKV&          m,
                                                          psio::input_stream key)
   {
      // key is the prefix — find the last entry with this prefix
      auto keyVec = std::vector<char>(key.pos, key.end);
      // Upper bound of prefix: increment last byte
      auto upper = keyVec;
      while (!upper.empty() && static_cast<unsigned char>(upper.back()) == 0xffu)
         upper.pop_back();
      if (upper.empty())
      {
         // prefix is all 0xff — everything matches, get last
         if (m.empty())
            return {};
         auto it = m.end();
         --it;
         if (it->first.size() < keyVec.size() ||
             memcmp(it->first.data(), keyVec.data(), keyVec.size()) != 0)
            return {};
         return KVResult{{it->first}, {it->second}};
      }
      ++upper.back();
      auto it = m.lower_bound(upper);
      if (it == m.begin())
         return {};
      --it;
      if (it->first.size() < keyVec.size() ||
          memcmp(it->first.data(), keyVec.data(), keyVec.size()) != 0)
         return {};
      return KVResult{{it->first}, {it->second}};
   }

   // Returns a read cursor for the given db.
   // For subjective dbs, if no transaction is active, reads directly from
   // the writer's current subjective root — readers don't block writers.
   psitri::cursor KVStore::readCursorForDb(DbId db)
   {
      if (isSubjective(db))
      {
         if (subjective_tx)
            return subjective_tx->read_cursor();
         // Read-only fallback: cursor from current subjective root.
         // Readers don't need checkout — they just snapshot the current root.
         check(_writer != nullptr, "no writer for subjective read");
         return psitri::cursor(_writer->get_root(subjectiveRootIndex));
      }
      check(consensus_tx != nullptr, "no consensus transaction active");
      return consensus_tx->read_cursor();
   }

   // ── KV operations ───────────────────────────────────────────────────

   void KVStore::kvPutRaw(DbId db, psio::input_stream key, psio::input_stream value)
   {
      if (auto* mem = kvStoreEphemeral(*this, db))
      {
         (*mem)[{key.pos, key.end}] = {value.pos, value.end};
         return;
      }

      psitri::transaction* tx;
      if (isSubjective(db))
      {
         check(subjective_tx != nullptr, "subjective checkout required");
         tx = subjective_tx;
      }
      else
      {
         check(consensus_tx != nullptr, "no consensus transaction active");
         tx = consensus_tx;
      }

      auto pk = prefixKey(db, {key.pos, static_cast<size_t>(key.end - key.pos)});
      tx->upsert(pk, std::string_view(value.pos, value.end - value.pos));
   }

   void KVStore::kvRemoveRaw(DbId db, psio::input_stream key)
   {
      if (auto* mem = kvStoreEphemeral(*this, db))
      {
         mem->erase(std::vector<char>(key.pos, key.end));
         return;
      }

      psitri::transaction* tx;
      if (isSubjective(db))
      {
         check(subjective_tx != nullptr, "subjective checkout required");
         tx = subjective_tx;
      }
      else
      {
         check(consensus_tx != nullptr, "no consensus transaction active");
         tx = consensus_tx;
      }

      auto pk = prefixKey(db, {key.pos, static_cast<size_t>(key.end - key.pos)});
      tx->remove(pk);
   }

   std::optional<psio::input_stream> KVStore::kvGetRaw(DbId db, psio::input_stream key)
   {
      if (auto* mem = kvStoreEphemeral(*this, db))
         return ephemeralGet(*mem, key);

      auto pk = prefixKey(db, {key.pos, static_cast<size_t>(key.end - key.pos)});

      // Fast path: use transaction::get() for point lookups when checked out
      psitri::transaction* tx = nullptr;
      if (isSubjective(db))
         tx = subjective_tx;
      else
         tx = consensus_tx;

      if (tx)
      {
         auto result = tx->get(pk, &_valueBuffer);
         if (result < 0)
            return {};
         return psio::input_stream{_valueBuffer};
      }

      // Read-only fallback for subjective reads without checkout
      check(_writer != nullptr, "no writer or transaction for read");
      auto cursor = psitri::cursor(_writer->get_root(subjectiveRootIndex));
      if (!cursor.seek(pk))
         return {};
      auto val = cursor.value<std::vector<char>>();
      if (!val)
         return {};
      _valueBuffer = std::move(*val);
      return psio::input_stream{_valueBuffer};
   }

   std::optional<KVStore::KVResult> KVStore::kvGreaterEqualRaw(DbId               db,
                                                               psio::input_stream key,
                                                               size_t             matchKeySize)
   {
      if (auto* mem = kvStoreEphemeral(*this, db))
         return ephemeralGreaterEqual(*mem, key, matchKeySize);

      auto pk     = prefixKey(db, {key.pos, static_cast<size_t>(key.end - key.pos)});
      auto cursor = readCursorForDb(db);

      // lower_bound returns true = positioned at valid key, false = at end
      if (!cursor.lower_bound(pk))
         return {};

      auto foundKey = cursor.key();

      // Verify we're still within this DbId's prefix
      if (foundKey.empty() || foundKey[0] != static_cast<char>(db))
         return {};

      // Strip the 1-byte DbId prefix for the result
      auto strippedKey = foundKey.substr(1);

      // Check matchKeySize (against unprefixed key)
      if (strippedKey.size() < matchKeySize ||
          (matchKeySize && memcmp(strippedKey.data(), key.pos, matchKeySize) != 0))
         return {};

      // Read value
      auto val = cursor.value<std::vector<char>>();
      if (!val)
         return {};

      _keyBuffer.assign(strippedKey.begin(), strippedKey.end());
      _valueBuffer = std::move(*val);
      return KVResult{{_keyBuffer}, {_valueBuffer}};
   }

   std::optional<KVStore::KVResult> KVStore::kvLessThanRaw(DbId               db,
                                                           psio::input_stream key,
                                                           size_t             matchKeySize)
   {
      if (auto* mem = kvStoreEphemeral(*this, db))
         return ephemeralLessThan(*mem, key, matchKeySize);

      auto pk     = prefixKey(db, {key.pos, static_cast<size_t>(key.end - key.pos)});
      auto cursor = readCursorForDb(db);

      // Position at or after key, then go back one
      // lower_bound returns true = positioned at valid key, false = at end
      if (cursor.lower_bound(pk))
      {
         // Positioned at a key >= pk — go to previous
         if (!cursor.prev())
            return {};  // nothing before
      }
      else
      {
         // At end — go to last key
         if (!cursor.seek_last())
            return {};  // tree is empty
      }

      auto foundKey = cursor.key();

      // Verify still within this DbId's prefix
      if (foundKey.empty() || foundKey[0] != static_cast<char>(db))
         return {};

      auto strippedKey = foundKey.substr(1);

      if (strippedKey.size() < matchKeySize ||
          (matchKeySize && memcmp(strippedKey.data(), key.pos, matchKeySize) != 0))
         return {};

      auto val = cursor.value<std::vector<char>>();
      if (!val)
         return {};

      _keyBuffer.assign(strippedKey.begin(), strippedKey.end());
      _valueBuffer = std::move(*val);
      return KVResult{{_keyBuffer}, {_valueBuffer}};
   }

   std::optional<KVStore::KVResult> KVStore::kvMaxRaw(DbId db, psio::input_stream key)
   {
      if (auto* mem = kvStoreEphemeral(*this, db))
         return ephemeralMax(*mem, key);

      // key is the prefix — find last entry with this prefix under DbId
      auto pk     = prefixKey(db, {key.pos, static_cast<size_t>(key.end - key.pos)});
      auto cursor = readCursorForDb(db);

      // Find end of prefix range: upper_bound on the prefix
      // Build the next-prefix key by incrementing the last byte
      std::string_view pkView(pk);
      std::vector<char> upperKey(pkView.begin(), pkView.end());
      while (!upperKey.empty() && static_cast<unsigned char>(upperKey.back()) == 0xffu)
         upperKey.pop_back();
      if (upperKey.empty())
      {
         // prefix is all 0xff — seek to last
         if (!cursor.seek_last())
            return {};
      }
      else
      {
         ++upperKey.back();
         // lower_bound returns true = positioned at valid key, false = at end
         if (cursor.lower_bound(std::string_view(upperKey.data(), upperKey.size())))
         {
            // Positioned at key >= upper — go to previous
            if (!cursor.prev())
               return {};
         }
         else
         {
            // At end — seek to last
            if (!cursor.seek_last())
               return {};
         }
      }

      auto foundKey = cursor.key();

      // Verify still in this DbId's prefix
      if (foundKey.empty() || foundKey[0] != static_cast<char>(db))
         return {};

      auto strippedKey = foundKey.substr(1);

      // Check that the stripped key starts with the original prefix
      auto prefixLen = static_cast<size_t>(key.end - key.pos);
      if (strippedKey.size() < prefixLen ||
          memcmp(strippedKey.data(), key.pos, prefixLen) != 0)
         return {};

      auto val = cursor.value<std::vector<char>>();
      if (!val)
         return {};

      _keyBuffer.assign(strippedKey.begin(), strippedKey.end());
      _valueBuffer = std::move(*val);
      return KVResult{{_keyBuffer}, {_valueBuffer}};
   }

   // ── prevAuthServices ────────────────────────────────────────────────

   ConstRevisionPtr KVStore::getPrevAuthServices()
   {
      check(consensus_tx != nullptr, "no consensus transaction active");
      auto prevKey = std::string_view(prevAuthServicesKey, sizeof(prevAuthServicesKey));
      return ConstRevisionPtr(consensus_tx->get_subtree(prevKey));
   }

   void KVStore::setPrevAuthServices(ConstRevisionPtr revision)
   {
      check(consensus_tx != nullptr, "no consensus transaction active");
      auto prevKey = std::string_view(prevAuthServicesKey, sizeof(prevAuthServicesKey));
      if (revision)
         consensus_tx->upsert(prevKey, std::move(revision));
      else
         consensus_tx->remove(prevKey);
   }

   // ── Revision access ─────────────────────────────────────────────────

   ConstRevisionPtr KVStore::getModifiedRevision() const
   {
      if (consensus_tx)
         return ConstRevisionPtr(consensus_tx->read_cursor().get_root());
      return _base_root;
   }

   // ── Subjective management ───────────────────────────────────────────

   void KVStore::checkoutSubjective(Writer& ws, SharedDatabase& shared)
   {
      if (_subjective_tx_storage.has_value())
      {
         // Nested checkout: create a sub-transaction savepoint
         _subjective_frames.emplace_back(_subjective_tx_storage->sub_transaction());
         return;
      }
      _subjective_shared = &shared;
      _subjective_tx_storage.emplace(ws.start_transaction(subjectiveRootIndex, psitri::tx_mode::batch));
      subjective_tx  = &*_subjective_tx_storage;
      _callbackFlags = 0;
   }

   void KVStore::checkoutEmptySubjective(Writer& ws)
   {
      if (_subjective_tx_storage.has_value())
      {
         _subjective_frames.emplace_back(_subjective_tx_storage->sub_transaction());
         return;
      }
      _subjective_tx_storage.emplace(
          ws.allocator_session(),
          sal::smart_ptr<sal::alloc_header>{},  // null = empty tree
          [](sal::smart_ptr<sal::alloc_header>) {},  // no-op commit
          []() {},  // no-op rollback
          psitri::tx_mode::batch);
      subjective_tx  = &*_subjective_tx_storage;
      _callbackFlags = 0;
   }

   bool KVStore::commitSubjective(Sockets& sockets, SocketAutoCloseSet& closing)
   {
      check(_subjective_tx_storage.has_value(),
            "commitSubjective requires checkoutSubjective");

      if (!_subjective_frames.empty())
      {
         _subjective_frames.back().commit();
         _subjective_frames.pop_back();
         return true;
      }

      _subjective_tx_storage->commit();
      _subjective_tx_storage.reset();
      subjective_tx = nullptr;

      if (_callbackFlags && _subjective_shared && _subjective_shared->impl->callbacks)
      {
         _subjective_shared->impl->callbacks->run(_callbackFlags);
      }
      _subjective_shared = nullptr;
      return true;
   }

   void KVStore::abortSubjective()
   {
      if (!_subjective_frames.empty())
      {
         // Nested abort: roll back just the innermost sub-transaction
         // (destructor without commit = abort)
         _subjective_frames.pop_back();
         return;
      }

      // Top-level abort
      if (_subjective_tx_storage.has_value())
      {
         _subjective_tx_storage->abort();
         _subjective_tx_storage.reset();
         subjective_tx = nullptr;
      }
      _subjective_shared = nullptr;
   }

   std::int32_t KVStore::socketSetFlags(std::int32_t        socket,
                                        std::uint32_t       mask,
                                        std::uint32_t       value,
                                        Sockets&            sockets,
                                        SocketAutoCloseSet& closing)
   {
      return sockets.setFlags(socket, mask, value, &closing, nullptr);
   }

   std::int32_t KVStore::socketEnableP2P(std::int32_t        socket,
                                         Sockets&            sockets,
                                         SocketAutoCloseSet& closing)
   {
      const auto* callbacks = _subjective_shared ? _subjective_shared->getCallbacks() : nullptr;
      if (!callbacks || !callbacks->socketP2P)
         abortMessage("P2P not supported");
      return sockets.enableP2P(socket, &closing, nullptr, callbacks->socketP2P);
   }

   std::size_t KVStore::saveSubjective()
   {
      auto result      = _subjectiveLimit;
      _subjectiveLimit = _subjective_tx_storage.has_value()
                             ? 1 + _subjective_frames.size()
                             : 0;
      return result;
   }

   void KVStore::restoreSubjective(std::size_t depth)
   {
      auto currentDepth = _subjective_tx_storage.has_value()
                              ? 1 + _subjective_frames.size()
                              : std::size_t(0);
      // Roll back to saved depth
      while (currentDepth > _subjectiveLimit)
      {
         if (!_subjective_frames.empty())
         {
            _subjective_frames.pop_back();  // destructor aborts
         }
         else if (_subjective_tx_storage.has_value())
         {
            _subjective_tx_storage->abort();
            _subjective_tx_storage.reset();
            subjective_tx      = nullptr;
            _subjective_shared = nullptr;
         }
         currentDepth = _subjective_tx_storage.has_value()
                            ? 1 + _subjective_frames.size()
                            : std::size_t(0);
      }
      _subjectiveLimit = depth;
   }

   void KVStore::setCallbackFlags(DatabaseCallbacks::Flags flags)
   {
      _callbackFlags |= flags;
   }

}  // namespace psibase
