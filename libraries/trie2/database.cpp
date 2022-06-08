#include <boost/interprocess/file_mapping.hpp>
#include <boost/interprocess/mapped_region.hpp>
#include <boost/interprocess/offset_ptr.hpp>
#include <boost/interprocess/sync/interprocess_sharable_mutex.hpp>
#include <trie/debug.hpp>
#include <trie/trie.hpp>

namespace trie
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
                                      .warm_pages = cfg.hot_pages * 2,
                                      .cool_pages = cfg.cold_pages,
                                      .cold_pages = cfg.cold_pages * 2}));

      _ring->_try_claim_free = [this](){ claim_free(); };
      /*
      _arena.reset(new object_arena(
          dir / "arena", allow_write ? object_arena::read_write : object_arena::read_only,
          cfg.max_objects, 4096 * cfg.hot_pages, 4096 * cfg.cold_pages,
          cfg.big_hot_pages*4096, cfg.big_cold_pages*4096 ));
          */
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
         std::lock_guard<std::mutex> lock(_active_read_sessions_mutex);
    //     WARN( "_active_read_sessions: ", _active_read_sessions.size()   );
         for (auto s : _active_read_sessions)
         {
     //       DEBUG( "    swap_p[0] = min ", s->_hot_swap_p.load(), "  or  ", sp._swap_pos[0] );
            sp._swap_pos[0] =
                std::min<uint64_t>(s->_hot_swap_p.load(std::memory_order_relaxed), sp._swap_pos[0]);
            sp._swap_pos[1] = std::min<uint64_t>(s->_warm_swap_p.load(std::memory_order_relaxed),
                                                 sp._swap_pos[1]);
            sp._swap_pos[2] = std::min<uint64_t>(s->_cool_swap_p.load(std::memory_order_relaxed),
                                                 sp._swap_pos[2]);
            sp._swap_pos[3] = std::min<uint64_t>(s->_cold_swap_p.load(std::memory_order_relaxed),
                                                 sp._swap_pos[3]);
         }
         _ring->claim_free(sp);
      }
   }
   void database::print_stats() { _ring->dump(); }
}  // namespace trie

#if 0

read thread
   - all the objects it is reading are constant
   - the objects may move while being read, but the old data cannot be not updated until
     the alloc pointer moves past the position of the swap pointer at the start of the read
     the main thread will not move the alloc pointer past the position of the swap pointer
     at the start of the read.

main thread (writer)
   - only thread that can start new write revisions
   - only thread that can advance last_readable_version
   - when it needs more alloc space in the hot area
        it moves the end_free pointer for all levels to the min swap_ptr location of active reads
             - the active read threads can aggregate this value at the end of each read
    
   - a long-running read will block memory from being allocated, therefore the swap_ptr locations
        for each thread are read at the start of each find/get/etc and at the end of each operation
        are set to "infinity". 

   - if main needs memory it will spin-lock waiting for read threads to advance their swap_ptr locations
        to a value equal to or greater than the ring's swap_ptr location        

version gc thread
   - waits for last_readable_version to change  (using notify_one)
      then iterates over all read threads to find the min acitve read
      then releases all root nodes from oldest_read_version to min(last_readable_version, min_active_read) -1
         - these releases are atomic decrements of the reference counts which are thread safe

swap thread(s)
   - 1 thread that reads hot's alloc pointer and moves hots swap pointer
   - 1 thread that reads warms alloc pointer and moves cools swap pointer
   - 1 thread that reads cools alloc pointer and moves colds swap pointer
   - waits for alloc_pos to change (using polling with sleep so main doesn't have to notify)
      then advances swap pointer moving from src->dstuntil free space buffer is restored


cold's memory allocation:
   - needs a way to ensure it doesn't reuse memory which may be read
   - cannot be a ring because most of this data should never move

   - space divided into 128 GB buckets which comprise a "empty free list"
   - allocator starts putting data into a bucket until full
   - swap thread finds bucket with highest % free by object id
        and moves the objects into the current alloc bucket (defraging in the process)
        once all objects are moved this bucket is added to a pending free list circular buffer
        swap thread continues until there are no buckets with more than 20% free space

   - reader threads note the position of the pending free list when they start reading
   - swap checks teh reader threads locations and once they have all moved past a pending
     free list position, it adds those blocks back to the "empty free list" at which point
     they can be used by the allocator.
   - there are two alloc positions (which comprise a block num and offset)
         a. one for the cool swap thread to move to cold 
         b. one for the cold swap thread to defrag to
             - this prevents interleaving of objects changing their relative locality 
   - when cool thread or cold thread needs a new empty block it uses an atomic Compare / Exchange
       to pop the head of the empty free list

#endif

