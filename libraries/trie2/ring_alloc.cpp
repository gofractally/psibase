#include <trie/debug.hpp>
#include <trie/ring_alloc.hpp>

namespace trie
{
   managed_ring::header::header(uint64_t s)
   {
      if( s > 38 ) {
         WARN( "size: ", s );
         throw std::runtime_error( "max rig size level = 38 or 2^40 bytes" );
      }
      auto data_size = 1ull<<s;
      auto header_size  = (sizeof(*this) + 7) & -8;
      size              = (1ull<<s) + header_size;
      begin             = reinterpret_cast<object_header*>((char*)this + header_size);
      end               = reinterpret_cast<object_header*>((char*)this + size);

      
      alloc_area_size = data_size;
      alloc_area_mask = data_size -1;
      alloc_p         = 0;
      swap_p          = 0;
      end_free_p      = alloc_area_size;
   }

   managed_ring::managed_ring(std::filesystem::path            filename,
                              uint64_t                         logsize,
                              ring_allocator::cache_level_type lev,
                              bool                             pin)
       : level(lev)
   {

      WARN( "log size: ", logsize );
      auto data_size = 1ull<<logsize;
      auto max_size  = data_size + (sizeof( header) + 7) &-8;

      DEBUG("Creating ", filename.generic_string(), " with size ", max_size / 1024 / 1024 / 1024.,
            " GB");
      uint64_t file_size = 0;
      bool     init      = false;
      if (not std::filesystem::exists(filename))
      {
         init = true;
         std::filesystem::create_directories(filename.parent_path());
         {
            std::ofstream file(filename.generic_string(), std::ofstream::trunc);
            file.close();
         }
      }

      file_size = std::filesystem::file_size(filename);
      if (file_size < max_size)
      {
         file_size = (max_size + 7) & -8;
         std::filesystem::resize_file(filename, file_size);
      }

      _file_map.reset(new bip::file_mapping(filename.generic_string().c_str(), bip::read_write));
      _map_region.reset(new bip::mapped_region(*_file_map, bip::read_write));

      if (init)
         _head = new ((char*)_map_region->get_address()) header(logsize);
      else
         _head = (header*)_map_region->get_address();

      _head->update_size(file_size);

      if (pin)
      {
         DEBUG("Pinning ", file_size / 1024 / 1024 / 1024., " GB");
         if (mlock(_map_region->get_address(), file_size) < 0)
         {
            WARN("Attempt to pin memory failed, performance may be impacted");
         }
      }
      else
      {
         _cfile = fopen(filename.generic_string().c_str(), "rb");
         if (not _cfile)
         {
            WARN("unable to open file ptr");
         }
         else
         {
            _cfileno = fileno(_cfile);
         }
      }
      _begin = _head->begin.get();
      _end   = _head->end.get();
   }

   void managed_ring::header::update_size(uint64_t new_size)
   {
      WARN("new size: ", new_size, "  cur size: ", size);
      if (new_size > size)
         throw std::runtime_error("cannot grow memory");

      if (new_size < size)
         throw std::runtime_error("cannot shrink memory");

      /*  TODO: figure out how to update cursors when alloc_area_size changes
      auto ap = get_alloc_pos();
      auto dsp = swap_p - alloc_p;
      auto def = end_free_p - alloc_p;

      auto new_end_pos    = file_begin_pos() + new_size;
      auto new_free_space = new_end_pos - end_pos();
      auto e              = end.get();
      e->size             = 0;
      e->id               = new_free_space;

      end = reinterpret_cast<object_header*>(new_end_pos);
      */
   }

   ring_allocator::ring_allocator(std::filesystem::path dir, access_mode mode, config cfg)
   {
      _try_claim_free = [&]() { claim_free(); };
      std::filesystem::create_directories(dir);
      _obj_ids = std::make_unique<object_db>(dir / "objects", id{cfg.max_ids}, mode == read_write);

      _levels[hot_cache].reset(
          new managed_ring(dir / "hot", cfg.hot_pages, hot_cache, true));
      _levels[warm_cache].reset(
          new managed_ring(dir / "warm", cfg.warm_pages, warm_cache, true));
      _levels[cool_cache].reset(
          new managed_ring(dir / "cool", cfg.cool_pages, cool_cache, false));
      _levels[cold_cache].reset(
          new managed_ring(dir / "cold", cfg.cold_pages, cold_cache, false));

      _swap_thread = std::make_unique<std::thread>(
          [=]()
          {
             thread_name("swap");
             swap_loop();
          });
   }

   std::pair<object_id, char*> ring_allocator::alloc(size_t num_bytes, object_db::object_location::object_type t)
   {
      auto new_id = _obj_ids->alloc();
      auto ptr    = alloc(hot(), new_id, num_bytes, nullptr, t);
      return {new_id, ptr};
   }

   //=================================
   //   alloc
   //=================================
   template <bool CopyData, bool RequireObjectLoc>
   char* ring_allocator::alloc(managed_ring& ring, id nid, uint32_t num_bytes, char* data, 
                               object_db::object_location::object_type t)
   {
      uint32_t round_size = (num_bytes + 7) & -8;  // data padding
      uint64_t used_size  = round_size + sizeof(object_header);
      if( num_bytes > 0xffffff )
         throw std::runtime_error( "obj too big" );

      //DEBUG( "used size: ", used_size, " num_bytes: ", num_bytes, "  round_size: ", round_size );

      auto max_contig = ring.max_contigous_alloc();

      if( max_contig < used_size ) {
         while ( (ring._head->get_potential_free_space()) < used_size) {
            WARN( "WAITING ON FREE SPACE: level: ", ring.level );
            using namespace std::chrono_literals;
            std::this_thread::sleep_for(10us);
            _try_claim_free();
            if( ring.level == 3 ) {
               dump();
               throw std::runtime_error( "database is out of space" );
            }
         }
         max_contig = ring.max_contigous_alloc();
      }

      bool trace      = false;

      if( max_contig < used_size ) {
    //     WARN( "too little space at end to use: ", max_contig, " needed: ", used_size, "  wait for claim free" );
         while ( (ring._head->get_potential_free_space()) > used_size)
         {
            _try_claim_free();
            if (ring.get_free_space() < used_size)
            {
               _debug.store(true);
               // there is potential free space, but a reader is blocking us?
               WARN("what happened here?!!  level: ", ring.level, "  ef: ", ring._head->end_free_p.load(),
                    "  ap: ", ring._head->alloc_p.load(), "  used_size: ", used_size,
                    " max c: ", max_contig,
                    " delta: ", ring._head->end_free_p.load() - ring._head->alloc_p.load(),
                    " swap p: ", ring._head->swap_p.load(),
                    " pot fre: ", ring._head->get_potential_free_space(),
                    " free: ", ring._head->get_free_space() );
               dump();
         //      throw std::runtime_error( "out of space" );

               using namespace std::chrono_literals;
               std::this_thread::sleep_for(100us);
            }
            max_contig = ring.max_contigous_alloc();
            if (max_contig < used_size)
            {
               if (max_contig > 0)
               {
      //            WARN( "too little space at end to use: ", max_contig, " needed: ", used_size, "  wait for claim free  max:", max_contig );
                  auto* cur = ring.get_alloc_cursor();
                  cur->set_free_area_size(max_contig);
                  ring._head->alloc_p += max_contig;
                  max_contig = ring.max_contigous_alloc();
               }
            }
            else
               break;
         } 
         // TODO: this can be removed because it should be impossible?
         /*if( ring._head->get_potential_free_space() < used_size ) {
             WARN( "level: ", ring.level, " potential free: ", ring._head->get_potential_free_space() );
             dump();
             throw std::runtime_error( "out of space" );
         }*/
      }
         
         /*
         if (ring.get_free_space() < used_size)
         {
            _debug.store( true );
            WARN("potential free space: ", ring._head->get_potential_free_space(), " used_size: ", used_size);

            WARN("what happened here?!!  ef: ", ring._head->end_free_p.load(),
                    " max c: ", max_contig,
                    " free space: ", ring._head->end_free_p.load() - ring._head->alloc_p.load(),
                    " pot fre: ", ring._head->get_potential_free_space(),
                    " ap: ", ring._head->alloc_p.load(), "  used_size: ", used_size,
                    " swap p: ", ring._head->swap_p.load(),
                    " end free p: ", ring._head->end_free_p.load(),
                    " ring: ", &ring,
                    " level: ", ring.level,
                    " act fre: ", ring._head->get_free_space() ) ;
            using namespace std::chrono_literals;
            DEBUG( "SLEEPING FOR 100ms" );
            std::this_thread::sleep_for(100ms);

            _try_claim_free();
            if (ring.get_free_space() >= used_size) {
                WARN( "RECOVERED  fs: ", ring.get_free_space(), "  used size: ", used_size );
            } else {
               std::this_thread::sleep_for(1000ms);
               WARN("potential free space: ", ring._head->get_potential_free_space(), " used_size: ", used_size);
               dump();
               DEBUG( "SLEEPING FOR 100ms" );
               std::this_thread::sleep_for(100ms);
               _try_claim_free();

                  WARN("what happened here?!!  ef: ", ring._head->end_free_p.load(),
                       "  ap: ", ring._head->alloc_p.load(), "  used_size: ", used_size,
                       " max c: ", max_contig,
                       " delta: ", ring._head->end_free_p.load() - ring._head->alloc_p.load(),
                       " swap p: ", ring._head->swap_p.load(),
                       " pot fre: ", ring._head->get_potential_free_space(),
                       " act fre: ", ring._head->get_free_space() ) ;


               dump();
            }
            if (ring.get_free_space() < used_size)
               throw std::runtime_error("out of space");
         }
         */
      auto* cur = ring.get_alloc_cursor();

      ring._head->alloc_p += used_size;

      assert(cur != ring._head->end.get());
      assert(num_bytes < 4096);
      cur->set(nid, num_bytes);
      if constexpr (CopyData)
      {
         memcpy(cur->data(), data, num_bytes);
      }

      /*
       *  There may be a race between main accessing an object and moving it to hot
       *  and swap moving the object to a lower level in the cache.       
       */
      while (not _obj_ids->set(nid, (char*)cur - ring.begin_pos(), ring.level, t))
      {
         // this could be caused by ref count increase or deref by main or swap
         WARN("contention in updating object loc detected, trying again");
      }

      return cur->data();
   }

   // moves data from higher levels to lower levels
   // can be run in any single thread because it doesn't modify the
   // source and it is the only modifies free areas of lower levels
   bool ring_allocator::swap()
   {
      auto do_swap = [this](auto* from, auto* to)
      {
         SCOPE;
         auto fs     = from->_head->get_potential_free_space();
         auto maxs   = from->_head->alloc_area_size;
         auto target = 1024*1024*64; //maxs / 32;  // target a certain amount free

         if (target < fs) {
            if( _debug.load() ) {
               DEBUG( "target: ", target , " < potential_free_space: ", fs, " NOTHING TO SWAP  from: ", from->level );
               using namespace std::chrono_literals;
            }
            return false;
         }

         if(  _debug.load() ) {
           WARN("               ", "target: ", target, "b  free space: ", fs, 
                                  " from: ", from->level, " to: ", to->level);
           DEBUG( "potential free space: ", from->_head->get_potential_free_space() );
           DEBUG( "free space: ", from->_head->get_free_space() );
         }

         auto bytes = target - fs;

         uint64_t bytes_freed = 0;

         uint64_t sp = from->_head->swap_p.load(std::memory_order_relaxed);
         uint64_t fp = from->_head->end_free_p.load(std::memory_order_relaxed);
         uint64_t ap = from->_head->alloc_p.load(std::memory_order_relaxed);
         if (fp < ap)
         {
            WARN("SHOULD NOT HAPPEN FP: ", fp, "  ap: ", ap);
            throw std::runtime_error("end should never be beyond alloc!");
         }

         auto to_obj = [&](auto p)
         {
            return reinterpret_cast<object_header*>(((char*)from->_head->begin.get()) +
                                                    (p & from->_head->alloc_area_mask));
         };

         auto p   = sp;
         auto end = std::min<uint64_t>(ap, p + bytes);

         while (p < end)  //ap and bytes_freed <bytes )
         {
            auto o = to_obj(p);
            if (o->id == 0)  // unused space
            {
               p += o->size;
               assert(o->size != 0);
            }
            else
            {
               using obj_type = object_db::object_location::object_type;
               uint16_t ref;
               auto     loc = _obj_ids->get(id{o->id}, ref);
               if (ref != 0 and from->get_object(loc.offset) == o and loc.cache == from->level)
                  alloc<true, false>(*to, {o->id}, o->size, o->data(), (obj_type)loc.type);
               p += o->data_capacity() + 8;
            }
         }
         if(_debug.load() ) {
            WARN( "before moved swap by: ", p - from->_head->swap_p.load() );
           DEBUG( "potential free space: ", from->_head->get_potential_free_space() );
           DEBUG( "free space: ", from->_head->get_free_space(), "  from: ", from );
         }
         from->_head->swap_p.store(p, std::memory_order_release);
         if( _debug.load() ) {
            WARN( "after moved swap" );
           DEBUG( "potential free space: ", from->_head->get_potential_free_space() );
           DEBUG( "free space: ", from->_head->get_free_space() );
         }
         return true;
      };

      bool did_work = false;
      did_work |= do_swap(&hot(), &warm());
      did_work |= do_swap(&warm(), &cool());
      did_work |= do_swap(&cool(), &cold());
      return did_work;
      //   do_swap(&cold(), &cold());
   }

   // updates the free range after swapping, this allows alloc to start
   // reusing this space. Must make sure any threads reading are done
   // before advancing free space.
   void ring_allocator::claim_free(swap_position sp)
   {
      auto claim = [this](auto& ring, uint64_t mp)
      {
         
         if( _debug.load() )
         WARN("claim free  end_free_p: ", ring._head->end_free_p.load(), " min_swap_p: ", mp,
              " swap_p: ", ring._head->swap_p.load(),
              " currently free: ", ring._head->get_free_space(),
              " alloc_p: ", ring._head->alloc_p.load());
         // TODO: load relaxed and store relaxed if swapping is being managed by another thread
         //assert(ring._head->end_free_p <= ring._head->swap_p);
         ring._head->end_free_p.store(
             ring._head->alloc_area_size + std::min<uint64_t>(ring._head->swap_p.load(), mp)
);

         if( _debug.load() )
         WARN("claim free  end_free_p: ", ring._head->end_free_p.load(), " min_swap_p: ", mp,
              " swap_p: ", ring._head->swap_p.load(),
              " currently free: ", ring._head->get_free_space(),
              " alloc_p: ", ring._head->alloc_p.load());

         /*
         WARN("now free: ", ring._head->get_free_space(), "  alloc_p: ", ring._head->alloc_p.load(),
              "  ef: ", ring._head->end_free_p.load());
         if (ring._head->end_free_p < ring._head->alloc_p)
            throw std::runtime_error("end should never be beyond alloc!");
              */
      };
      claim(hot(), sp._swap_pos[0]);
      claim(warm(), sp._swap_pos[1]);
      claim(cool(), sp._swap_pos[2]);
      claim(cold(), sp._swap_pos[3]);
   }

   void ring_allocator::retain(id i) { _obj_ids->retain(i); }

   std::pair<char*,object_db::object_location::object_type> ring_allocator::release(id i)
   {
      auto l = _obj_ids->release(i);
      return {(l.second > 0 ? nullptr
                          : (char*)_levels[l.first.cache]->get_object(l.first.offset)->data()), (object_db::object_location::object_type)l.first.type};
   }

   char*                      ring_allocator::get(id i) { return get_cache<true>(i); }
   std::pair<uint16_t, char*> ring_allocator::get_ref_no_cache(id i)
   {
      return {ref(i), get_cache<false>(i)};
   }

   void managed_ring::dump(object_db& odb)
   {
      std::cerr << "file size: " << _head->size / 1024 / 1024. << " MB  ";
      std::cerr << "free  space: " << _head->get_free_space() / 1024. / 1024. << " Mb   "
                << "free  space bytes: " << _head->get_free_space() << " b  "
                << " end_free_p: " << _head->end_free_p.load()
                << " swap_p: " << _head->swap_p.load()
                << "  alloc_p: " << _head->alloc_p.load() << "  ";
      std::cerr << "cache hits: " << _head->cache_hits << "   ";
      return;
      /*


      std::cerr << "alloc area size: " << _head->alloc_area_size << "   ";
      std::cerr << "alloc abs pos: " << _head->alloc_p << "   ";
      std::cerr << "max contig free space: " << _head->max_contigous_alloc() << "   ";
      std::cerr << "end free  abs pos: " << _head->end_free_p << "   ";
      std::cerr << "swap abs pos: " << _head->swap_p << "   ";
      std::cerr << "total freed: " << _head->total_free_bytes << "\n";
      std::cerr << "cache hits: " << _head->cache_hits << "\n";
      */

      auto s = _head->get_swap_pos();
      auto a = _head->get_alloc_pos();
      auto f = _head->get_end_free_pos();
      auto e = _head->end.get();
      auto b = _head->begin.get();

      //      return;
      //   assert((char*)_head->get_alloc_pos() - begin_pos() == _head->alloc_p);

      WARN("*end - *begin: ", (char*)e - (char*)b);
      DEBUG("alloc - swap: ", _head->alloc_p - _head->swap_p);
      DEBUG("*alloc - *swap: ", (char*)a - (char*)s);

      auto totals = (_head->alloc_p - _head->swap_p);

      std::string_view red     = "\033[31m";
      std::string_view megenta = "\033[36m";
      std::string_view yellow  = "\033[33m";
      std::string_view blue    = "\033[96m";
      std::string_view cyan    = "\033[36m";
      std::string_view def     = "\033[0m";
      switch (level)
      {
         case 0:
            std::cerr << red << "HOT:  " << def;
            break;
         case 1:
            std::cerr << yellow << "WARM: " << def;
            break;
         case 2:
            std::cerr << blue << "COOL: " << def;
            break;
         case 3:
            std::cerr << blue << "COOL: " << def;
            break;
      }

      uint64_t sp = _head->swap_p;
      uint64_t fp = _head->end_free_p;
      uint64_t ap = _head->alloc_p;

      // sp -> ap = valid objects
      // ap -> fp = free space
      // fp -> sp = claim space

      auto to_obj = [&](auto p)
      {
         return reinterpret_cast<object_header*>(((char*)_head->begin.get()) +
                                                 (p & _head->alloc_area_mask));
      };

      assert(_head->get_swap_pos() == to_obj(sp));
      auto p = sp;
      while (p != ap)
      {
         if (p == sp)
            std::cerr << blue << "S" << def;
         if (p == ap)
            std::cerr << red << "A" << def;
         if (p == fp)
            std::cerr << megenta << "F" << def;
         auto o = to_obj(p);
         if (o->id == 0)
         {
            std::cerr << yellow << "[#0, " << o->size << "]" << def;
            p += o->size;
            assert(o->size != 0);
         }
         else
         {
            uint16_t ref = 5;
            auto     loc = odb.get({o->id}, ref);

            if (ref == 0)
            {
               std::cerr << megenta << "{ #" << o->id << ", " << o->size << ", r" << ref << "}"
                         << def;
            }
            else if (loc.cache != level)
            {
               std::cerr << blue << "( #" << o->id << ", " << o->size << ")" << def;
            }
            else if (get_object(loc.offset) != o)
            {
               std::cerr << red << "< #" << o->id << ", " << o->size << ">" << def;
            }
            else
            {
               std::cerr << def << "[ #" << o->id << ", " << o->size << ", r" << ref << "]" << def;
            }
            if (o->size == 0)
            {
               WARN(" 0 SIZE");
               return;
            }
            p += o->data_capacity() + 8;
         }
      }
      if (p == sp)
         std::cerr << blue << "S" << def;
      if (p == ap)
         std::cerr << red << "A" << def;
      std::cerr << "[FREE " << fp - ap << "]";
      p += fp - ap;
      if (p == fp)
         std::cerr << megenta << "F" << def;

      _head->validate();
   }

   void ring_allocator::dump()
   {
    //  _obj_ids->print_stats();
      std::cerr << "============= HOT "<<  &hot() << " ================== \n";
      hot().dump(*_obj_ids);
      std::cerr << "\n============= WARM ================== \n";
      warm().dump(*_obj_ids);
      std::cerr << "\n============= COOL ================== \n";
      cool().dump(*_obj_ids);
      std::cerr << "\n============= COLD ================== \n";
      cold().dump(*_obj_ids);
      //      std::cerr << "================================= \n";
   }

}  // namespace trie
