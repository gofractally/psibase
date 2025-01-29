#pragma once
#include <arbtrie/block_allocator.hpp>
#include <arbtrie/config.hpp>
#include <arbtrie/debug.hpp>
#include <arbtrie/file_fwd.hpp>
#include <arbtrie/mapping.hpp>
#include <arbtrie/node_meta.hpp>
#include <arbtrie/object_id.hpp>
#include <arbtrie/util.hpp>

namespace arbtrie
{
   /**
    * The ID file will grow by 256mb (assuming id_page_size is 4096) 
    */
   static constexpr const uint32_t id_block_size = id_page_size << 16;
   static constexpr const uint32_t ids_per_page  = id_page_size / sizeof(uint64_t);

   /**
    *  @class id_alloc
    *  
    *  Manages the index of node_meta objects allocated by
    *  regions and returns id's to enable quick lookup of
    *  the meta objects.
    */
   class id_alloc
   {
     public:
      id_alloc(std::filesystem::path id_file);
      ~id_alloc();

      node_meta_type& get(fast_meta_address nid);

      id_region                                     get_new_region();
      std::pair<node_meta_type&, fast_meta_address> get_new_id(id_region r);
      void                                          free_id(fast_meta_address id);
      int64_t                                       free_release_count() const
      {
         return _state->free_release_count.load(std::memory_order_relaxed);
      }

      void print_region_stats();

      // @group recover_api
      //   These methods are used as part of recovery only
      // @{
      node_meta_type& get_or_alloc(fast_meta_address nid);

      // set all meta nodes to 0
      void clear_all();

      // release all refs, if prior was <= 1 move to free list
      void release_unreachable();

      // set all refs > 1 to 1, leave 0 alone
      void reset_all_refs();

      // return the number of modify bits that were set
      int64_t clear_lock_bits();
      // @}

     private:
      struct region_header
      {
         std::mutex            alloc_mutex;
         std::atomic<uint32_t> use_count;
         std::atomic<uint32_t> next_alloc;
         std::atomic<uint64_t> first_free;  
      };

      struct id_alloc_state
      {
         uint64_t              magic   = 0;  // TODO: identify this file type
         uint64_t              version = 0;
         std::atomic<uint16_t> next_region;
         std::atomic<uint64_t> free_release_count;
         std::atomic<bool>     clean_shutdown = 0;
         region_header         regions[1 << 16];
      };

      std::mutex            _grow_mutex;
      std::filesystem::path _data_dir;
      block_allocator       _block_alloc;
      mapping               _ids_state_file;
      id_alloc_state*       _state;
   };
   inline void id_alloc::print_region_stats()
   {
      uint64_t counts[32];
      memset(counts, 0, sizeof(counts));
      for (uint32_t i = 0; i < (1 << 16); ++i)
      {
         auto cnt = _state->regions[i].use_count.load();
         cnt /= 32;
         if (cnt < 32)
         {
            counts[cnt]++;
         }
         else
         {
            counts[31]++;
         }
      }
      std::cerr << "Region Stats (grouped by ranges of 32 ids) per region\n";
      for (uint32_t i = 0; i < 32; ++i)
      {
         std::cout << std::setw(4) << (i * 32) << ", " << counts[i] << "\n";
      }
   }

   inline node_meta_type& id_alloc::get_or_alloc(fast_meta_address nid) {
      uint64_t abs_pos        = nid.index * sizeof(node_meta_type);
      uint64_t block_num      = abs_pos / id_page_size;
      if( block_num > 0xffff )
         throw std::runtime_error( "block num out of range!" );
      if( block_num >= _block_alloc.num_blocks() )
         _block_alloc.reserve( block_num+1, true );
      return get(nid);
   }

   inline node_meta_type& id_alloc::get(fast_meta_address nid)
   {
      uint64_t abs_pos        = nid.index * sizeof(node_meta_type);
      uint64_t block_num      = abs_pos / id_page_size;
      uint64_t index_in_block = abs_pos & uint64_t(id_page_size - 1);

      auto ptr = ((char*)_block_alloc.get(block_num)) + nid.region * id_page_size + index_in_block;

      return reinterpret_cast<node_meta_type&>(*ptr);
   }

   inline id_region id_alloc::get_new_region()
   {
      // allocate regions in round-robin manner to ensure balanced loading,
      // leverages auto-wrapping of uint16_t
      auto r = _state->next_region.fetch_add(1, std::memory_order_relaxed);
      if (r == 0)
      {
         r = _state->next_region.fetch_add(1, std::memory_order_relaxed);
      }
      return {r};
   }

   /**
    *  This function is designed to be thread safe, it will lock a mutex
    *  if it must grab from the free list, but will use atomic inc allocate
    *  until the free list must be consulted
    *
    *  There is one free list per region and 2^16 regions, therefore a good
    *  chance there is no contention. A future allocation scheme will replace
    *  the free list with a bit-per-slot to optimize placement and eliminate
    *  locks. (free lists thrash locality)
    */
   inline std::pair<node_meta_type&, fast_meta_address> id_alloc::get_new_id(id_region r)
   {
      if constexpr (debug_memory)
         _state->free_release_count.fetch_add(1, std::memory_order_relaxed);

      if (r.region == 0)
      {
         // TODO: allow region 0 once we have caught all places where 
         // region is uninitilized and therefore overflowing region 0
         TRIEDENT_WARN("who is alloc to region 0!\n");
      }

      const uint32_t ids_per_page = id_page_size / sizeof(node_meta_type);

      auto  num_pages = _block_alloc.num_blocks();
      auto& rhead     = _state->regions[r.region];

      auto prior_ucount = rhead.use_count.fetch_add(1, std::memory_order_acquire);
      if (prior_ucount >= num_pages * ids_per_page)
      {
         // reserve() is thread safe and if two threads both try to alloc then
         // only one will actually do the work.
         if( num_pages > 3 ) {
            TRIEDENT_WARN("growing all id regions because use count(", prior_ucount, ") of region(",
                          r.region, ") exceeded cap: numpages: ", num_pages, " -> ", num_pages + 1);
            // TODO: calculate a load factor before warning
         }
         num_pages = _block_alloc.reserve(num_pages + 1, true);
      }
      auto na = rhead.next_alloc.load(std::memory_order_relaxed);

      //TRIEDENT_WARN( "num_pages: ", num_pages, "  region: ", r.region ," next alloc: ", na );
      if (na < num_pages * ids_per_page)
      {
         // TODO: change to C & E 
         // then skip the free list, and grab a new one!
         auto nid = rhead.next_alloc.fetch_add(1, std::memory_order_relaxed);

         if (nid < num_pages * id_page_size) [[likely]]
         {
            assert(nid != 0);
            auto nadr = r + id_index(nid);
            assert(get(nadr).ref() == 0 and get(nadr).loc().aligned_index() == 0);
            //     TRIEDENT_WARN( "alloc: ", nadr );
            return {get(nadr), nadr};
         }
         else
         {
            // race condition caused attempt to allocate beyond end of page,
            // must undo the add to restore balance... then consult free list
            rhead.next_alloc.fetch_sub(1, std::memory_order_relaxed);
            TRIEDENT_WARN( "id alloc race condition detected, should be fine, just letting you know" );
         }
      }
      // there must be something in the free list because if use count implied no
      // free then it would have grown() and returned.

      // TODO: ff_index must init to node_meta::location_mask == end of list
      uint64_t ff_index = 0;

      fast_meta_address alloced_id;
      node_meta_type*   ffa;

      // TODO: make this compile time constant
      static const uint64_t eofl = temp_meta_type().set_location(end_of_freelist).to_int();
      {  // lock scope, must lock to alloc because of race between
         // reading last free and storing, conviently there are
         // 65k different regions so should be little contention
         std::unique_lock<std::mutex> l{rhead.alloc_mutex};
         ff_index = rhead.first_free.load(std::memory_order_seq_cst);

         //     TRIEDENT_DEBUG("reg: ", r.region, " alloc from ff_index: ", ff_index, " idx: ", (ff_index >> 18),
         //                   "  tmd: ", temp_meta_type(ff_index).loc().to_aligned(), "  eofl: ", eofl);
         uint64_t next_free = get(r + id_index(temp_meta_type(ff_index).loc().to_aligned()))
                                  .to_int(std::memory_order_seq_cst);

         assert(temp_meta_type(next_free).ref() == 0);
         assert(temp_meta_type(next_free).type() == node_type::freelist);
         do
         {
            if (ff_index == eofl)  //end_of_freelist.to_aligned())
               throw std::runtime_error("reached end of free list, that shouldn't happen!");
            alloced_id = r + id_index(ff_index >> node_meta<>::location_offset);
            ffa        = &get(alloced_id);

            next_free = ffa->to_int(std::memory_order_seq_cst);

            assert(temp_meta_type(next_free).ref() == 0);
            assert(temp_meta_type(next_free).type() == node_type::freelist);
         } while (rhead.first_free.compare_exchange_weak(ff_index, next_free));
         // , std::memory_order_relaxed));
         assert(temp_meta_type(next_free).ref() == 0);
         assert(temp_meta_type(next_free).type() == node_type::freelist);
      }

      temp_meta_type tmeta;
      tmeta.set_ref(1).set_location(null_node);

      // store 1 = ref count 1 prevents object as being interpreted as unalloc
      ffa->store(tmeta.to_int(), std::memory_order_relaxed);

      //     std::cerr << "   post alloc free list: ";
      //    print_free_list();
      //      TRIEDENT_WARN( "fl alloc: ", alloced_id);
      return {*ffa, alloced_id};
   }

   inline void id_alloc::free_id(fast_meta_address adr)
   {
      if constexpr (debug_memory) {
         _state->free_release_count.fetch_sub(1, std::memory_order_relaxed);
      }

      auto& rhead     = _state->regions[adr.region];
      auto& next_free = get(adr);
      auto  new_head =
          temp_meta_type().set_location(node_location::from_aligned(adr.index)).to_int();

      {
         {
            std::unique_lock<std::mutex> l{rhead.alloc_mutex};
            uint64_t cur_head = rhead.first_free.load();  //std::memory_order_relaxed);
            //      uint64_t  cur_head = rhead.first_free.load(std::memory_order_relaxed);
            do
            {
               next_free.store(cur_head);  //, std::memory_order_release);
            } while (not rhead.first_free.compare_exchange_weak(cur_head, new_head));
         }
      }
      rhead.use_count.fetch_sub(1, std::memory_order_release);
   }

}  // namespace arbtrie
