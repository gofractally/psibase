#include <boost/interprocess/file_mapping.hpp>
#include <boost/interprocess/mapped_region.hpp>
#include <boost/interprocess/offset_ptr.hpp>
#include <boost/interprocess/sync/interprocess_sharable_mutex.hpp>
#include <triedent/debug.hpp>
#include <triedent/database.hpp>

namespace triedent
{

   namespace bip = boost::interprocess;
   template <typename T>
   using bip_offset_ptr = bip::offset_ptr<T>;

   std::atomic<int>      database::_read_thread_number = 0;
   thread_local uint32_t database::_thread_num         = 0;

   database::database(std::filesystem::path dir, config cfg, access_mode allow_write)
   {
      bool init = false;
      auto rev  = dir / "revisions";
      if (not std::filesystem::exists(dir))
      {
         if (not allow_write)
            throw std::runtime_error("directory does not exist: '" + dir.generic_string() + "'");
         std::filesystem::create_directories(dir);
      }
      if (not std::filesystem::exists(rev))
      {
         init = true;
         std::ofstream f(rev.generic_string(), std::ofstream::trunc);
         f.close();
         std::filesystem::resize_file(rev, sizeof(database_memory));
      }
      auto md = allow_write == read_write ? bip::read_write : bip::read_only;
      _file   = std::make_unique<bip::file_mapping>(rev.generic_string().c_str(), md);
      _region = std::make_unique<bip::mapped_region>(*_file, md);
      if (init)
         _dbm = new (_region->get_address()) database_memory();
      else
         _dbm = reinterpret_cast<database_memory*>(_region->get_address());

      _ring.reset(new ring_allocator(dir / "ring", ring_allocator::read_write,
                                     {.max_ids    = cfg.max_objects,
                                      .hot_pages  = cfg.hot_pages,
                                      .warm_pages = cfg.warm_pages,
                                      .cool_pages = cfg.cool_pages,
                                      .cold_pages = cfg.cold_pages}));

      _ring->_try_claim_free = [this](){ claim_free(); };
   }
   database::~database() {}

   void database::swap()
   {
      _ring->swap();
   }
   void database::claim_free()const
   {
      ring_allocator::swap_position sp;
      {
         std::lock_guard<std::mutex> lock(_active_sessions_mutex);
         for (auto s : _active_sessions)
         {
            sp._swap_pos[0] =
                std::min<uint64_t>(s->_hot_swap_p.load(std::memory_order_relaxed), sp._swap_pos[0]);
            sp._swap_pos[1] = std::min<uint64_t>(s->_warm_swap_p.load(std::memory_order_acquire),
                                                 sp._swap_pos[1]);
            sp._swap_pos[2] = std::min<uint64_t>(s->_cool_swap_p.load(std::memory_order_acquire),
                                                 sp._swap_pos[2]);
            sp._swap_pos[3] = std::min<uint64_t>(s->_cold_swap_p.load(std::memory_order_acquire),
                                                 sp._swap_pos[3]);
         }
      }
      _ring->claim_free(sp);
   }
   void database::print_stats() { _ring->dump(); }
}  // namespace trie

