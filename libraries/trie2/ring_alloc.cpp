#include <trie/debug.hpp>
#include <trie/ring_alloc.hpp>

namespace trie
{
   managed_ring::header::header(uint64_t s)
   {
      total_free_bytes  = 0;
      total_alloc_bytes = 0;
      size              = s;
      auto header_size  = (sizeof(*this) + 7) & -8;
      begin             = reinterpret_cast<object_header*>((char*)this + header_size);
      //alloc_cursor      = begin;
      //swap_cursor       = begin;
      //end_free_cursor   = end;
      // alloc_cursor->set_free_area_size(size - header_size);
      end = reinterpret_cast<object_header*>((char*)this + size);

      alloc_area_size = size - header_size;
      alloc_p         = 0;
      swap_p          = 0;
      end_free_p      = alloc_area_size;
   }

   managed_ring::managed_ring(std::filesystem::path            filename,
                              uint64_t                         max_size,
                              ring_allocator::cache_level_type lev,
                              bool                             pin)
       : level(lev)
   {
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
         _head = new ((char*)_map_region->get_address()) header(file_size);
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
      } else {
         _cfile = fopen( filename.generic_string().c_str(), "rb" );
         if( not _cfile ) {
            WARN( "unable to open file ptr" );
         } else {
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
      std::filesystem::create_directories(dir);
      _obj_ids = std::make_unique<object_db>(dir / "objects", id{cfg.max_ids}, mode == read_write);

      _levels[hot_cache].reset(
          new managed_ring(dir / "hot", cfg.hot_pages * 4096, hot_cache, true));
      _levels[warm_cache].reset(
          new managed_ring(dir / "warm", cfg.warm_pages * 4096, warm_cache, true));
      _levels[cool_cache].reset(
          new managed_ring(dir / "cool", cfg.cool_pages * 4096, cool_cache, false));
      _levels[cold_cache].reset(
          new managed_ring(dir / "cold", cfg.cold_pages * 4096, cold_cache, false));
   }

   std::pair<object_id, char*> ring_allocator::alloc(size_t num_bytes)
   {
      auto new_id = _obj_ids->alloc();
      auto ptr    = alloc(hot(), new_id, num_bytes);
      return {new_id, ptr};
   }

   //=================================
   //   alloc
   //=================================
   template <bool CopyData>
   char* ring_allocator::alloc(managed_ring& ring, id nid, uint32_t num_bytes, char* data)
   {
      uint32_t round_size = (num_bytes + 7) & -8;  // data padding
      uint64_t used_size  = round_size + sizeof(object_header);

      //DEBUG( "used size: ", used_size, " num_bytes: ", num_bytes, "  round_size: ", round_size );
      ring._head->total_alloc_bytes += used_size;

      auto* cur        = ring.get_alloc_cursor();
      auto  max_contig = ring.max_contigous_alloc();
      if (max_contig < used_size)
      {
         if (ring.get_free_space() - max_contig < used_size)
         {
            if (ring.get_free_space() >= used_size)
               throw std::runtime_error("out of contigious space for object size: " +
                                        std::to_string(used_size));
            else
               throw std::runtime_error("out of space for object size: " +
                                        std::to_string(used_size));
         }
         cur->set_free_area_size(max_contig);
         ring._head->alloc_p += max_contig;
         cur        = ring.get_alloc_cursor();
         max_contig = ring.max_contigous_alloc();
      }

      /*
      if (max_contig > used_size)
      {
         assert( max_contig - used_size >= 8 );
         auto next_obj = reinterpret_cast<object_header*>(((char*)cur) + used_size);
         next_obj->set_free_area_size(max_contig - used_size);
      }
      */

      ring._head->alloc_p += used_size;
      //ring.alloc_cursor() = next_obj;

      assert(cur != ring._head->end.get());
      assert(num_bytes < 4096);
      cur->set(nid, num_bytes);
      if constexpr (CopyData)
      {
         memcpy(cur->data(), data, num_bytes);
      }

      _obj_ids->set(nid, (char*)cur - ring.begin_pos(), ring.level);

      return cur->data();
   }

   // moves data from higher levels to lower levels
   // can be run in any single thread because it doesn't modify the
   // source and it is the only modifies free areas of lower levels
   void ring_allocator::swap()
   {
      auto do_swap = [this](auto* from, auto* to)
      {
         SCOPE;
         auto fs     = from->get_free_space();
         auto maxs   = from->_head->alloc_area_size;
         auto target = maxs / 32;  // target a certain amount free

         if (target < fs)
            return;

   //      WARN("               ", "target: ", target, "  free space: ", fs, " from: ", from->level, " to: ", to->level);

         auto bytes = target - fs;

         uint64_t bytes_freed = 0;

         uint64_t sp     = from->_head->swap_p;
         uint64_t fp     = from->_head->end_free_p;
         uint64_t ap     = from->_head->alloc_p;

         auto     to_obj = [&](auto p)
         {
            return reinterpret_cast<object_header*>(((char*)from->_head->begin.get()) +
                                                    (p % from->_head->alloc_area_size));
         };

         auto p = sp;
         auto end = std::min<uint64_t>(ap, p + bytes);

         while (p < end)  //ap and bytes_freed <bytes )
         {
            auto o = to_obj(p);
            if (o->id == 0) // unused space
            {
               p += o->size;
               assert(o->size != 0);
            }
            else
            {
               uint16_t ref;
               auto     loc = _obj_ids->get(id{o->id}, ref);
               if (ref != 0 and from->get_object(loc.offset) == o and loc.cache == from->level) 
                  alloc<true>(*to, {o->id}, o->size, o->data());
               p += o->data_capacity() + 8;
            }
         }
         from->_head->swap_p = p;
      };

      do_swap(&hot(), &warm());
      do_swap(&warm(), &cool());
      do_swap(&cool(), &cold());
      //   do_swap(&cold(), &cold());
   }

   // updates the free range after swapping, this allows alloc to start
   // reusing this space. Must make sure any threads reading are done
   // before advancing free space.
   void ring_allocator::claim_free()
   {
      auto claim = [this](auto& ring)
      {
         // TODO: load relaxed and store relaxed if swapping is being managed by another thread
         //assert(ring._head->end_free_p <= ring._head->swap_p);
         ring._head->end_free_p = ring._head->alloc_area_size + ring._head->swap_p;
      };
      claim(hot());
      claim(warm());
      claim(cool());
      claim(cold());
   }

   void ring_allocator::retain(id i) { _obj_ids->retain(i); }
   void ring_allocator::release(id i) { _obj_ids->release(i); }

   //  pointer is valid until claim_free runs, reads can read it then check to see if
   //  the gc moved past char* while reading then read again at new location
   template <bool CopyToHot>
   char* ring_allocator::get_cache(id i)
   {
      auto loc = _obj_ids->get(i);

      if (loc.cache == hot_cache)
         return hot().get_object(loc.offset)->data();


      /*
      if( loc.cache == cool_cache ) {
          auto& ring = _levels[loc.cache];
          if( ring->_cfile ) {
             char temp_buffer[512];
             object_header* ob = reinterpret_cast<object_header*>(temp_buffer);;
             // TODO: this could fail at EOF?
             auto re = pread( ring->_cfileno,  temp_buffer, sizeof(temp_buffer), loc.offset + ((sizeof(managed_ring::header)+7)&-8) );
           //  assert( re == sizeof(ob) );

          //   assert( obj->id == ob.id );
          //   assert( obj->size == ob.size );

             char* ptr = alloc<false>(hot(), id{ob->id}, ob->size);

             if( ob->size < sizeof(temp_buffer)-8 ) {
                memcpy( ptr, temp_buffer+8, ob->size );
                return ptr;
             } else {
                re = pread( _levels[loc.cache]->_cfileno,  ptr, ob->size, 8+loc.offset + ((sizeof(managed_ring::header)+7)&-8) );
                assert( re == ob->size );
             return ptr;
             }
          }
      }
      */
      auto obj = _levels[loc.cache]->get_object(loc.offset);

      /// TODO: if size > X do not copy to hot, copy instead to warm


      if constexpr (CopyToHot)
      {
         if (obj->size > 4096)
            return obj->data();
         return alloc<true>(hot(), id{obj->id}, obj->size, obj->data());
      }
      else
      {
         return obj->data();
      }
   }
   char*                      ring_allocator::get(id i) { return get_cache<true>(i); }
   std::pair<uint16_t, char*> ring_allocator::get_ref_no_cache(id i)
   {
      return {ref(i), get_cache<false>(i)};
   }

   void managed_ring::dump(object_db& odb)
   {
      std::cerr << "file size: " << _head->size /1024/1024. << " MB  ";
      std::cerr << "free  space: " << _head->get_free_space()/1024/1024. << " Mb  ";
      std::cerr << "cache hits: " << _head->cache_hits << "   ";
      return;
      /*


      std::cerr << "alloc area size: " << _head->alloc_area_size << "   ";
      std::cerr << "alloc abs pos: " << _head->alloc_p << "   ";
      std::cerr << "max contig free space: " << _head->max_contigous_alloc() << "   ";
      std::cerr << "end free  abs pos: " << _head->end_free_p << "   ";
      std::cerr << "swap abs pos: " << _head->swap_p << "   ";
      std::cerr << "total alloced: " << _head->total_alloc_bytes << "\n";
      std::cerr << "total freed: " << _head->total_free_bytes << "\n";
      std::cerr << "total swapped: " << _head->total_swapped_bytes << "\n";
      std::cerr << "net : "
                << (_head->total_alloc_bytes - _head->total_free_bytes) / 1024 / 1024. / 1024
                << " GB\n";
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


      std::string_view red    = "\033[31m";
      std::string_view megenta= "\033[36m";
      std::string_view yellow = "\033[33m";
      std::string_view blue   = "\033[96m";
      std::string_view cyan   = "\033[36m";
      std::string_view def    = "\033[0m";
      switch( level ) {
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
                                                 (p % _head->alloc_area_size));
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
               std::cerr << megenta << "{ #" << o->id << ", " << o->size << ", r" << ref <<"}" << def;
            }
            else if (loc.cache != level)
            {
               std::cerr << blue << "( #" << o->id << ", " << o->size << ")" << def;
            }
            else if ( get_object( loc.offset ) !=  o )
            {
               std::cerr << red << "< #" << o->id << ", " << o->size << ">" << def;
            }
            else
            {
               std::cerr << def << "[ #" << o->id << ", " << o->size << ", r" << ref <<"]" << def;
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
         std::cerr << megenta<< "F" << def;

      _head->validate();
   }

   void ring_allocator::dump()
   {
      std::cerr << "============= HOT ================== \n";
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
