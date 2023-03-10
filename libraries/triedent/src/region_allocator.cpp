#include <triedent/region_allocator.hpp>

namespace triedent
{

   region_allocator::region_allocator(gc_queue&                    gc,
                                      object_db&                   obj_ids,
                                      const std::filesystem::path& path,
                                      access_mode                  mode,
                                      std::uint64_t                initial_size)
       : _gc(gc), _obj_ids(obj_ids), _file(path, mode)
   {
      if (_file.size() == 0)
      {
         _file.resize(page_size + initial_size);
         new (_file.data()) header{.regions = {{.region_size    = initial_size,
                                                .alloc_pos      = 0,
                                                .num_regions    = 1,
                                                .current_region = 0,
                                                .next_region    = 1,
                                                .region_used    = {initial_size}},
                                               {}},
                                   .current = 0};
      }

      _header = reinterpret_cast<header*>(_file.data());
      _h      = &_header->regions[_header->current.load()];
      _base   = _header->base();
   }

   void* region_allocator::allocate_impl(std::uint32_t size, std::uint32_t used_size)
   {
      auto alloc_pos = _h->alloc_pos;
      auto available = (_h->current_region + 1) * _h->region_size - _h->alloc_pos;
      if (used_size > available)
      {
         // create a dummy object in the remaining space
         new (_base + alloc_pos) object_header{.size = available - sizeof(object_header), .id = 0};
         deallocate(_h->current_region, available);
         // switch to the next region
         auto next_index = _header->current.load() ^ 1;
         start_new_region(_h, &_header->regions[next_index]);
         _h        = &_header->regions[next_index];
         alloc_pos = _h->alloc_pos;
         _header->current.store(next_index);

         // Try to free some space
         auto [smallest, small_size] = get_smallest_region(_h);
         if (small_size < _h->region_size / 2)
         {
            // TODO: This can run concurrently if we preallocate the required memory.
            evacuate_region(smallest);
            struct make_region_available
            {
               ~make_region_available()
               {
                  std::lock_guard l{_self->_mutex};
                  if (_self->_h->region_size == region_size)
                  {
                     _self->_h->next_region = region;
                  }
               }
               region_allocator* _self;
               std::uint64_t     region;
               std::uint64_t     region_size;
            };
            _gc.push(std::make_shared<make_region_available>(this, smallest, _h->region_size));
         }
      }
      void* result = _base + _h->alloc_pos;
      auto  o      = new (result) object_header{.size = size};
      return o->data();
   }
   void region_allocator::deallocate(object_location loc)
   {
      std::lock_guard l{_mutex};
      assert(loc.cache == _level);
      auto region      = loc.offset / _h->region_size;
      auto object_used = sizeof(object_header) + get_object(loc)->data_capacity();
      deallocate(region, object_used);
   }
   void region_allocator::deallocate(std::uint64_t region, std::uint32_t used_size)
   {
      auto total_used = _h->region_used[region].load();
      assert(used_size <= total_used);
      _h->region_used[region].store(total_used - used_size);
   }
   std::pair<std::uint64_t, std::uint64_t> region_allocator::get_smallest_region(header::data* h)
   {
      std::uint64_t min     = h->region_size;
      std::uint64_t min_pos = 0;
      for (std::size_t i = 0; i < h->num_regions; ++i)
      {
         if (i != h->current_region)
         {
            if (h->region_used[i] < min)
            {
               min     = h->region_used[i];
               min_pos = i;
            }
         }
      }
      return {min_pos, min};
   }
   void region_allocator::start_new_region(header::data* old, header::data* next)
   {
      auto num_regions = old->num_regions;
      if (old->next_region == num_regions)
      {
         if (num_regions == max_regions)
         {
            double_region_size(old, next);
         }
         else
         {
            copy_header_data(old, next);
         }
         _gc.push(_file.resize(_file.size() + next->region_size));
         _header = reinterpret_cast<header*>(_file.data());
         _base   = _header->base();
         next->region_used[next->next_region].store(next->region_size);
         next->current_region = next->next_region;
         next->num_regions++;
      }
      else
      {
         copy_header_data(old, next);
         next->current_region = next->next_region;
         next->region_used[next->current_region].store(next->region_size);
      }
      next->alloc_pos   = next->current_region * next->region_size;
      next->next_region = next->num_regions;
   }
   void region_allocator::double_region_size(header::data* old_data, header::data* new_data)
   {
      auto num_regions = old_data->num_regions;
      assert(num_regions % 2 == 0);
      new_data->region_size    = old_data->region_size * 2;
      new_data->num_regions    = num_regions / 2;
      auto next_region         = old_data->next_region / 2;
      new_data->next_region    = next_region;
      new_data->current_region = next_region;
      for (std::size_t i = 0; i < num_regions / 2; ++i)
      {
         new_data->region_used[i].store(old_data->region_used[2 * i].load() +
                                        old_data->region_used[2 * i + 1].load());
      }
   }
   void region_allocator::copy_header_data(header::data* old, header::data* next)
   {
      next->region_size    = old->region_size;
      next->num_regions    = old->num_regions;
      next->current_region = old->current_region;
      next->next_region    = old->next_region;
      for (std::uint32_t i = 0; i < old->num_regions; ++i)
      {
         next->region_used[i].store(old->region_used[i].load());
      }
   }
   void region_allocator::evacuate_region(std::uint64_t region)
   {
      for (auto offset = 0; offset != _h->region_size;)
      {
         object_header*  p = get_object(region * _h->region_size + offset);
         object_location loc{.offset = region * _h->region_size + offset, .cache = _level};
         object_id       id{p->id};
         auto            info = _obj_ids.get(id);
         if (info.ref && info == loc)
         {
            auto lock = _obj_ids.lock(id);
            info      = _obj_ids.get(id);
            if (info.ref && info == loc)
            {
               auto  object_size  = sizeof(object_header) + p->data_capacity();
               void* new_location = _base + _h->alloc_pos;
               std::memcpy(new_location, p, object_size);
               _obj_ids.move(lock, object_location{.offset = _h->alloc_pos, .cache = _level});
               _h->alloc_pos += object_size;
            }
         }
         offset += (sizeof(object_header) + p->data_capacity());
      }
      _h->region_used[region].store(0);
   }

}  // namespace triedent
