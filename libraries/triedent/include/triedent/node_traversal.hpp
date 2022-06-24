#pragma once
#include <triedent/node.hpp>

namespace triedent
{
   struct maybe_unique;

   inline void release_node(ring_allocator& ra, object_id obj)
   {
      if (!obj)
         return;
      if (auto [ptr, is_value] = ra.release(obj); ptr && !is_value)
      {
         auto& in = *reinterpret_cast<inner_node*>(ptr);
         release_node(ra, in.value());
         auto nb  = in.num_branches();
         auto pos = in.children();
         auto end = pos + nb;
         while (pos != end)
         {
            assert(*pos);
            release_node(ra, *pos);
            ++pos;
         }
      }
   }

   object_id bump_refcount_or_copy(ring_allocator& ra, object_id id);

   inline object_id copy_node(ring_allocator& ra, object_id id, char* ptr, bool is_value)
   {
      if (is_value)
      {
         auto src          = reinterpret_cast<value_node*>(ptr);
         auto [lock, dest] = value_node::make(ra, src->key(), src->data());
         return lock.into_unlock_unchecked();
      }
      else
      {
         // TODO: drop incorrect version value
         auto src = reinterpret_cast<inner_node*>(ptr);
         auto [lock, dest] =
             inner_node::make(ra, src->key(), bump_refcount_or_copy(ra, src->value()),
                              src->branches(), src->version());
         auto src_children  = src->children();
         auto dest_children = dest->children();
         auto dest_end      = dest_children + dest->num_branches();
         while (dest_children != dest_end)
         {
            *dest_children = bump_refcount_or_copy(ra, *src_children);
            ++dest_children;
            ++src_children;
         }
         return lock.into_unlock_unchecked();
      }
   }

   inline object_id bump_refcount_or_copy(ring_allocator& ra, object_id id)
   {
      if (!id)
         return id;
      if (auto shared = ra.bump_count(id))
         return shared->into_unchecked();
      auto [ptr, is_value] = ra.get_cache<false>(id);
      return copy_node(ra, id, ptr, is_value);
   }

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

      // Not implemented; this must be `mutating`, id must be non-const,
      // and Tr must be `maybe_owned`.
      template <typename Tr>
      void set_child(const object_id& id, Tr&& src);
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

      // Not implemented; mutation requires `mutating`
      template <typename T>
      T* mut() const;

      template <bool CH>
      no_track<CH> track_no_track() const
      {
         return {ra, ptr, is_value, id};
      }

      // Not implemented; can't start tracking unique from here
      maybe_unique track_maybe_unique() const;

      no_track track_child(object_id id) const
      {
         auto [ptr, is_value] = ra->get_cache<CopyToHot>(id);
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

      // Not implemented; mutation requires `mutating`
      template <typename T>
      T* mut() const;

      template <bool CopyToHot>
      no_track<CopyToHot> track_no_track() const
      {
         return {ra, ptr, is_value, id};
      }

      maybe_unique track_maybe_unique() const { return *this; }

      maybe_unique track_child(object_id id) const
      {
         auto [ptr, is_value] = ra->get_cache<true>(id);
         return {ra, ptr, is_value, id, unique && ra->ref(id) == 1};
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
                  shared_id       shared   = {})
          : tracker_base(ra, ptr, is_value), shared(std::move(shared))
      {
      }
      maybe_owned(maybe_owned&& src) { *this = std::move(src); }

      maybe_owned& operator=(maybe_owned&& src)
      {
         if (&src == this)
            return *this;
         if (auto id = shared.try_into_exclusive())
            release_node(*ra, *id);
         tracker_base::operator=(src);
         shared = std::move(src.shared);
         return *this;
      }

      ~maybe_owned()
      {
         if (auto id = shared.try_into_exclusive())
            release_node(*ra, *id);
      }

      bool is_unique() const { return shared.get_db()->ref(shared.get_id()) == 1; }

      // Not implemented; mutation requires `mutating`
      template <typename T>
      T* mut() const;

      template <bool CopyToHot>
      no_track<CopyToHot> track_no_track() const
      {
         return {ra, ptr, is_value, shared.get_id()};
      }

      maybe_unique track_maybe_unique() const
      {
         return {ra, ptr, is_value, shared.get_id(), is_unique()};
      }

      // Not implemented; use track_no_track() or track_maybe_unique()
      // to traverse down.
      tracker_base track_child(object_id id) const;

      // Move ownership of id to caller. Bump reference count if needed
      // (!shared.owner). Copy if the refcount would overflow. Clears
      // maybe_owned unless a copy was made.
      object_id into_or_copy()
      {
         if (auto x = shared.try_into())
            return *x;
         return copy_node(*ra, shared.get_id(), ptr, is_value);
      }
   };  // maybe_owned

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
         if (auto id = lock.into_unlock().try_into_exclusive())
            release_node(*ra, *id);
         tracker_base::operator=(src);
         lock = std::move(src.lock);
         return *this;
      }

      ~mutating()
      {
         if (auto id = lock.into_unlock().try_into_exclusive())
            release_node(*ra, *id);
      }

      template <typename T>
      T* as()
      {
         return reinterpret_cast<T*>(ptr);
      }

      template <typename T>
      T* mut()
      {
         return reinterpret_cast<T*>(ptr);
      }

      void set_child(object_id& id, maybe_owned&& src)
      {
         if (id == src.shared.get_id())
            return;
         auto prev = id;
         id        = src.into_or_copy();
         release_node(*ra, prev);
      }

      // Not implemented
      template <bool CopyToHot>
      no_track<CopyToHot> track_no_track() const;

      // Not implemented; can't start tracking unique from here
      maybe_unique track_maybe_unique() const;

      // Not implemented; use track_no_track() to traverse down.
      tracker_base track_child(object_id id) const;
   };  // mutating

   template <typename Tracker>
   class node_ref;

   template <typename Tracker, template <typename Tr> typename Derived>
   class ref_base
   {
     protected:
      Tracker tracker;

     public:
      ref_base(Tracker&& tracker) : tracker(std::move(tracker)) {}
      ref_base(const ref_base&)            = default;
      ref_base(ref_base&&)                 = default;
      ref_base& operator=(const ref_base&) = default;
      ref_base& operator=(ref_base&&)      = default;

      bool is_value() { return tracker.is_value; }

      template <bool CopyToHot>
      Derived<no_track<CopyToHot>> track_no_track() const
      {
         return {tracker.template track_no_track<CopyToHot>()};
      }

      Derived<maybe_unique> track_maybe_unique() const  //
      {
         return {tracker.track_maybe_unique()};
      }

      auto track_child(object_id id) const -> node_ref<decltype(tracker.track_child(this->ra, id))>;
   };

   template <typename Tracker>
   class value_ref : public ref_base<Tracker, value_ref>
   {
     private:
      auto ptr() { return this->tracker.template as<value_node>(); }

     public:
      using base = ref_base<Tracker, value_ref>;

      value_ref(Tracker&& tracker) : base(std::move(tracker)) {}
      value_ref(const value_ref&)            = default;
      value_ref(value_ref&&)                 = default;
      value_ref& operator=(const value_ref&) = default;
      value_ref& operator=(value_ref&&)      = default;
   };

   template <typename Tracker>
   class inner_ref : public ref_base<Tracker, inner_ref>
   {
     private:
      auto ptr() { return this->tracker.template as<inner_node>(); }

     public:
      using base = ref_base<Tracker, inner_ref>;

      inner_ref(Tracker&& tracker) : base(std::move(tracker)) {}
      inner_ref(const inner_ref&)            = default;
      inner_ref(inner_ref&&)                 = default;
      inner_ref& operator=(const inner_ref&) = default;
      inner_ref& operator=(inner_ref&&)      = default;
   };

   template <typename Tracker>
   class node_ref : public ref_base<Tracker, node_ref>
   {
     public:
      using base = ref_base<Tracker, node_ref>;

      node_ref(Tracker&& tracker) : base(std::move(tracker)) {}
      node_ref(const node_ref&)            = default;
      node_ref(node_ref&&)                 = default;
      node_ref& operator=(const node_ref&) = default;
      node_ref& operator=(node_ref&&)      = default;

      value_ref<Tracker> as_value() { return {this->tracker}; }
      inner_ref<Tracker> as_inner() { return {this->tracker}; }
   };

   template <typename Tracker, template <typename Tr> typename Derived>
   auto ref_base<Tracker, Derived>::track_child(object_id id) const
       -> node_ref<decltype(tracker.track_child(this->ra, id))>
   {
      return {tracker.track_child(this->ra, id)};
   }
}  // namespace triedent
