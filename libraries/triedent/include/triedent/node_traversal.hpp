#pragma once
#include <triedent/node.hpp>

namespace triedent
{
   struct maybe_unique;
   struct maybe_owned;
   struct mutating;

   template <typename Tracker>
   class node_ref;
   template <typename Tracker>
   class value_ref;
   template <typename Tracker>
   class inner_ref;

   // Transitions
   // ===========
   // no_track<CopyToHot>
   //    no outward transitions
   // maybe_owned
   //    -> no_track       To pass to tree query functions
   //    -> maybe_unique   To pass to tree mutation functions
   // maybe_unique
   //    -> maybe_owned    To return from tree mutation functions
   //    -> mutating       To edit in place
   // mutating
   //    -> maybe_owned    To return from tree mutation functions

   struct tracker_base
   {
      ring_allocator* ra;
      char*           ptr;
      bool            is_value;

      tracker_base(ring_allocator* ra = nullptr, char* ptr = nullptr, bool is_value = false)
          : ra(ra), ptr(ptr), is_value(is_value)
      {
      }
      tracker_base(const tracker_base&)            = default;
      tracker_base& operator=(const tracker_base&) = default;

      template <typename T>
      const T* as() const
      {
         return reinterpret_cast<const T*>(ptr);
      }

     protected:
      void clear()
      {
         ra       = nullptr;
         ptr      = nullptr;
         is_value = false;
      }
   };  // tracker_base

   // Use this when traversing trees without modification
   template <bool CopyToHot>
   struct no_track : tracker_base
   {
      object_id id;

      no_track(ring_allocator* ra       = nullptr,
               char*           ptr      = nullptr,
               bool            is_value = false,
               object_id       id       = {.id = 0})
          : tracker_base(ra, ptr, is_value), id(id)
      {
      }
      no_track(const no_track&)            = default;
      no_track& operator=(const no_track&) = default;

      object_id get_id() { return id; }

      template <bool CH>
      no_track<CH> as_no_track() const
      {
         return {ra, ptr, is_value, id};
      }

      no_track track_child(object_id id) const
      {
         auto [ptr, is_value, ref] = ra->get_cache<CopyToHot>(id);
         return {ra, ptr, is_value, id};
      }
   };  // no_track

   // Use this when traversing trees downward for modification;
   // it tracks whether nodes can be modified in place.
   struct maybe_unique : tracker_base
   {
      object_id id;
      bool      unique;

      maybe_unique(ring_allocator* ra       = nullptr,
                   char*           ptr      = nullptr,
                   bool            is_value = false,
                   object_id       id       = {.id = 0},
                   bool            unique   = false)
          : tracker_base(ra, ptr, is_value), id(id), unique(unique)
      {
      }
      maybe_unique(const maybe_unique&)            = default;
      maybe_unique& operator=(const maybe_unique&) = default;

      object_id get_id() { return id; }

      maybe_unique as_maybe_unique() const { return *this; }

      maybe_owned as_maybe_owned() const;
      maybe_owned into_maybe_owned() const;

      object_id into_or_copy() const;

      // If unique, then edit in place
      std::optional<mutating> edit() const;

      maybe_unique track_child(object_id id) const
      {
         auto [ptr, is_value, ref] = ra->get_cache<true>(id);
         return {ra, ptr, is_value, id, unique && ref == 1};
      }
   };  // maybe_unique

   // Use this to hold a root. Also use it when returning nodes
   // to insert back into parents.
   struct maybe_owned : tracker_base
   {
      shared_id shared;

      maybe_owned(ring_allocator* ra       = nullptr,
                  char*           ptr      = nullptr,
                  bool            is_value = false,
                  shared_id&&     shared   = {})
          : tracker_base(ra, ptr, is_value), shared(std::move(shared))
      {
      }
      maybe_owned(maybe_owned&& src) { *this = std::move(src); }

      maybe_owned& operator=(maybe_owned&& src)
      {
         if (&src == this)
            return *this;
         if (auto id = shared.try_into_if_owned())
            release_node(*ra, *id);
         tracker_base::operator=(src);
         shared = std::move(src.shared);
         src.clear();
         return *this;
      }

      ~maybe_owned()
      {
         if (auto id = shared.try_into_if_owned())
            release_node(*ra, *id);
      }

      object_id get_id() { return shared.get_id(); }

      bool is_unique() const
      {
         // TODO: cache the ref count inside shared
         return shared.get_owner() && shared.get_db()->ref(shared.get_id()) == 1;
      }

      template <bool CopyToHot>
      no_track<CopyToHot> as_no_track() const
      {
         return {ra, ptr, is_value, shared.get_id()};
      }

      maybe_unique as_maybe_unique() const
      {
         return {ra, ptr, is_value, shared.get_id(), is_unique()};
      }

      // Move ownership of id to caller. Bump reference count if needed
      // (!shared.owner). Copy if the refcount would overflow. Clears
      // maybe_owned unless a copy was made.
      object_id into_or_copy() &&
      {
         if (!shared.get_id())
            return {};
         if (auto x = shared.try_into())
         {
            clear();
            return *x;
         }
         return copy_node(*ra, shared.get_id(), ptr, is_value);
      }
   };  // maybe_owned

   inline maybe_owned maybe_unique::as_maybe_owned() const
   {
      // Result isn't owned since maybe_unique borrows from elsewhere
      return {ra, ptr, is_value, ra->preserve_count(id)};
   }

   inline maybe_owned maybe_unique::into_maybe_owned() const
   {
      return as_maybe_owned();
   }

   inline object_id maybe_unique::into_or_copy() const
   {
      return as_maybe_owned().into_or_copy();
   }

   // Use while mutating
   struct mutating : tracker_base
   {
      location_lock2 lock;

      mutating(ring_allocator* ra       = nullptr,
               char*           ptr      = nullptr,
               bool            is_value = false,
               location_lock2  lock     = {})
          : tracker_base(ra, ptr, is_value), lock(std::move(lock))
      {
      }
      mutating(mutating&& src) { *this = std::move(src); }

      mutating& operator=(mutating&& src)
      {
         if (&src == this)
            return *this;
         if (auto id = lock.into_unlock().try_into_if_owned())
            release_node(*ra, *id);
         tracker_base::operator=(src);
         lock = std::move(src.lock);
         src.clear();
         return *this;
      }

      ~mutating()
      {
         if (auto id = lock.into_unlock().try_into_if_owned())
            release_node(*ra, *id);
      }

      object_id get_id() { return lock.get_id(); }

      template <typename T>
      T* as() const
      {
         return reinterpret_cast<T*>(ptr);
      }

      template <typename Tr>
      void set_child(object_id& id, Tr&& src) const
      {
         if (id == src.get_id())
            return;
         auto prev = id;
         id        = std::move(src).into_or_copy();
         release_node(*ra, prev);
      }

      maybe_owned into_maybe_owned() &&
      {
         maybe_owned result = {ra, ptr, is_value, lock.into_unlock()};
         clear();
         return result;
      }

      inline object_id into_or_copy() &&
      {
         return std::move(*this).into_maybe_owned().into_or_copy();
      }
   };  // mutating

   inline std::optional<mutating> maybe_unique::edit() const
   {
      return mutating{ra, ptr, is_value, ra->spin_lock(id).into_lock2_editing_unchecked()};
   }

   template <typename Tracker>
   class node_ref;

   template <typename Tracker, template <typename Tr> typename Derived>
   class ref_base
   {
     protected:
      Tracker tracker;

     public:
      ref_base() = default;
      ref_base(const Tracker& tracker) : tracker(tracker) {}
      ref_base(Tracker&& tracker) : tracker(std::move(tracker)) {}
      ref_base(const ref_base&)            = default;
      ref_base(ref_base&&)                 = default;
      ref_base& operator=(const ref_base&) = default;
      ref_base& operator=(ref_base&&)      = default;

      operator bool() const { return tracker.ptr; }

      friend bool operator==(const ref_base& a, const ref_base& b)
      {
         return a.tracker.get_id() == b.tracker.get_id();
      }
      friend bool operator!=(const ref_base& a, const ref_base& b) { return !(a == b); }

      bool is_value() const { return tracker.is_value; }

      template <bool CopyToHot>
      Derived<no_track<CopyToHot>> as_no_track() const
      {
         return {tracker.template as_no_track<CopyToHot>()};
      }

      Derived<maybe_unique> as_maybe_unique() const { return {tracker.as_maybe_unique()}; }
      Derived<maybe_owned>  as_maybe_owned() const { return {tracker.as_maybe_owned()}; }

      // If unique, then edit in place
      std::optional<Derived<mutating>> edit() const
      {
         if (auto tr = tracker.edit())
            return Derived<mutating>{std::move(*tr)};
         else
            return std::nullopt;
      }

      // This unlocks and consumes mutating, but leaves maybe_unique intact.
      // Named `ret` since it's used at the return point of tree manipulation functions
      // in database.hpp.
      node_ref<maybe_owned> ret();

      auto track_child(object_id id) const;
   };

   template <typename Tracker = no_track<false>>
   class node_ref : public ref_base<Tracker, node_ref>
   {
      template <typename Tr>
      friend class inner_ref;

     public:
      using base = ref_base<Tracker, node_ref>;

      using base::base;

      value_ref<Tracker> as_value_node() const;
      inner_ref<Tracker> as_inner_node() const;
      value_ref<Tracker> into_value_node() &&;
      inner_ref<Tracker> into_inner_node() &&;
   };

   template <typename Tracker, template <typename Tr> typename Derived>
   auto ref_base<Tracker, Derived>::track_child(object_id id) const
   {
      return node_ref<decltype(tracker.track_child(id))>{tracker.track_child(id)};
   }

   template <typename Tracker, template <typename Tr> typename Derived>
   node_ref<maybe_owned> ref_base<Tracker, Derived>::ret()
   {
      return {std::move(tracker).into_maybe_owned()};
   }

   template <typename Tracker = no_track<false>>
   class value_ref : public ref_base<Tracker, value_ref>
   {
      template <typename Tr>
      friend class node_ref;

      template <typename Tr>
      friend class inner_ref;

     private:
      auto ptr() const { return this->tracker.template as<value_node>(); }

     public:
      using base = ref_base<Tracker, value_ref>;
      using base::base;

      static value_ref<mutating> make(ring_allocator& ra, key_view key, value_view val)
      {
         auto [lock, ptr] = value_node::make(ra, key, val);
         return {mutating{&ra, (char*)ptr, true, lock.into_lock2_alloced_unchecked()}};
      }

      uint32_t key_size() const { return ptr()->key_size(); }
      key_view key() const { return ptr()->key(); }

      uint32_t   data_size() const { return ptr()->data_size(); }
      value_view data() const { return ptr()->data(); }
      auto       data_ptr() const { return ptr()->data_ptr(); }
   };  // value_ref

   template <typename Tracker>
   value_ref<Tracker> node_ref<Tracker>::as_value_node() const
   {
      return {this->tracker};
   }

   template <typename Tracker>
   value_ref<Tracker> node_ref<Tracker>::into_value_node() &&
   {
      return {std::move(this->tracker)};
   }

   template <typename Tracker = no_track<false>>
   class inner_ref : public ref_base<Tracker, inner_ref>
   {
      template <typename Tr>
      friend class node_ref;

      template <typename Tr>
      friend class value_ref;

      template <typename Tr>
      friend class inner_ref;

     private:
      auto ptr() const { return this->tracker.template as<inner_node>(); }

     public:
      using base = ref_base<Tracker, inner_ref>;
      using base::base;

      template <typename Tr1, typename Tr2>
      static inner_ref<mutating> make(ring_allocator&       ra,
                                      const inner_ref<Tr1>& src,
                                      key_view              key,
                                      value_ref<Tr2>&&      value,
                                      uint64_t              branches)
      {
         // TODO: remove incorrect version
         auto [lock, ptr] = inner_node::make(  //
             ra, *src.ptr(), key, std::move(value.tracker).into_or_copy(), branches,
             src.ptr()->version());
         return {mutating{&ra, (char*)ptr, false, lock.into_lock2_alloced_unchecked()}};
      }

      uint32_t key_size() const { return ptr()->key_size(); }
      key_view key() const { return ptr()->key(); }

      auto value() const { return this->track_child(ptr()->value()).into_value_node(); }

      template <typename Tr>
      void set_value(value_ref<Tr>&& src)
      {
         this->tracker.set_child(ptr()->value(), std::move(src.tracker));
      }

      uint32_t num_branches() const { return ptr()->num_branches(); }
      bool     has_branch(uint32_t b) const { return ptr()->has_branch(b); }
      uint64_t branches() const { return ptr()->branches(); }
      auto     child(uint32_t i) const { return this->track_child(ptr()->children()[i]); }

      auto branch(uint8_t b) const { return this->track_child(ptr()->branch(b)); }
      void set_branch(uint8_t b, node_ref<maybe_owned>&& src) const
      {
         this->tracker.set_child(ptr()->branch(b), std::move(src.tracker));
      }
   };  // inner_ref

   template <typename Tracker>
   inner_ref<Tracker> node_ref<Tracker>::as_inner_node() const
   {
      return {this->tracker};
   }

   template <typename Tracker>
   inner_ref<Tracker> node_ref<Tracker>::into_inner_node() &&
   {
      return {std::move(this->tracker)};
   }
}  // namespace triedent
