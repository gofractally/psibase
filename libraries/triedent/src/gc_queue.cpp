#include <triedent/gc_queue.hpp>

#include <algorithm>

namespace triedent
{
   gc_queue::session::session(gc_queue& q) : _sequence(npos), _queue(&q)
   {
      std::lock_guard l{_queue->_session_mutex};
      _queue->_sessions.push_back(this);
   }
   gc_queue::session::~session()
   {
      std::lock_guard l{_queue->_session_mutex};
      _queue->_sessions.erase(std::find(_queue->_sessions.begin(), _queue->_sessions.end(), this));
   }

   auto gc_queue::make_sequence_order(size_type end)
   {
      return [this, end](size_type sequence) -> size_type
      {
         if (sequence == npos)
         {
            return sequence;
         }
         else if (sequence <= end)
         {
            return sequence + _queue.size();
         }
         else
         {
            return sequence;
         }
      };
   }

   void gc_queue::push(std::shared_ptr<void> element)
   {
      std::unique_lock l{_queue_mutex};
      auto             end   = _end.load();
      auto             start = (end + _queue.size() - _size) % _queue.size();
      // always leave one empty element, to ensure that
      // session._sequence == _end is unambiguous.
      while (_size == _queue.size() - 1)
      {
         auto end_ready = start_wait(start, end);
         if (end_ready == start)
         {
            assert(_waiting);
            _queue_cond.wait(l);
            end   = _end.load();
            start = (end + _queue.size() - _size) % _queue.size();
         }
         else
         {
            do_run(start, end_ready);
            break;
         }
      }
      _queue[end] = std::move(element);
      _end.store(next(end));
      ++_size;
      if (_size == 1)
      {
         _queue_cond.notify_one();
      }
   }

   void gc_queue::poll()
   {
      std::lock_guard l{_queue_mutex};
      auto            end   = _end.load();
      auto            start = (end + _queue.size() - _size) % _queue.size();
      // _queue.size() is distinct from any sequence that
      // a session can hold (including npos)
      do_run(start, start_wait(_queue.size(), end));
   }

   void gc_queue::flush()
   {
      assert(_sessions.empty());
      std::lock_guard l{_queue_mutex};
      auto            end   = _end.load();
      auto            start = (end + _queue.size() - _size) % _queue.size();
      do_run(start, end);
   }

   void gc_queue::run(std::atomic<bool>* done)
   {
      std::unique_lock l{_queue_mutex};
      while (!done->load())
      {
         _queue_cond.wait(l, [&] { return done->load() || _size != 0; });
         auto end   = _end.load();
         auto start = (end + _queue.size() - _size) % _queue.size();
         end        = start_wait(start, end);
         if (!_waiting)
         {
            do_run(start, end);
         }
         else
         {
            _queue_cond.wait(l, [&] { return done->load(); });
         }
      }
   }

   void gc_queue::notify_run()
   {
      std::lock_guard{_queue_mutex};
      _queue_cond.notify_all();
   }

   // returns the (circular) index after pos.
   // the result is in [0, _queue.size())
   gc_queue::size_type gc_queue::next(size_type pos)
   {
      ++pos;
      if (pos == _queue.size())
      {
         pos = 0;
      }
      return pos;
   }

   // \pre _queue_mutex is locked
   // \pre start is the beginning of the queue
   // \pre end is the result of a call to wait
   void gc_queue::do_run(size_type start, size_type end)
   {
      for (; start != end; start = next(start))
      {
         _queue[start].reset();
         --_size;
      }
   }

   // \post
   // for each index in [start, R):
   //   either U happens before W or P happens before L
   gc_queue::size_type gc_queue::start_wait(size_type start, size_type end)
   {
      std::size_t     lowest_sequence = end;
      auto            order           = make_sequence_order(end);
      std::lock_guard l2{_session_mutex};
      for (const auto& session : _sessions)
      {
         // if wait sees the value written by L
         // - R is before the value written by L
         // if wait sees the value written by U or a later lock or unlock,
         // - U happens before W
         // if wait sees a value written before L,
         // - W is before L's store in seq_cst
         // - therefore P happens before L (see lock)
         auto seq = session->_sequence.load();
         if (seq == start)
         {
            if (_waiting)
            {
               return start;
            }
            if (session->_sequence.compare_exchange_strong(seq, start | wait_bit))
            {
               _waiting = true;
               return start;
            }
         }
         if (order(seq) < order(lowest_sequence))
         {
            lowest_sequence = seq;
         }
      }
      return lowest_sequence;
   }
}  // namespace triedent
