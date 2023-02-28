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

   gc_queue::size_type gc_queue::session::wait(size_type value)
   {
      auto old = _sequence.load();
      do
      {
         if (old != value)
         {
            return old;
         }
      } while (!_sequence.compare_exchange_weak(old, value | wait_bit));
      _sequence.wait(value | wait_bit);
      return _sequence.load();
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
      std::lock_guard l{_queue_mutex};
      auto            end   = _end.load();
      auto            start = (end + _queue.size() - _size) % _queue.size();
      // always leave one empty element, to ensure that
      // session._sequence == _end is unambiguous.
      if (_size == _queue.size() - 1)
      {
         do_run(start, wait(start, end));
      }
      _queue[end] = std::move(element);
      _end.store(next(end));
      ++_size;
   }

   void gc_queue::poll()
   {
      std::lock_guard l{_queue_mutex};
      auto            end   = _end.load();
      auto            start = (end + _queue.size() - _size) % _queue.size();
      // _queue.size() is distinct from any valid sequence
      do_run(start, wait(_queue.size(), end));
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
   gc_queue::size_type gc_queue::wait(size_type start, size_type end)
   {
      std::size_t     lowest_sequence = end;
      auto            order           = make_sequence_order(end);
      std::lock_guard l2{_session_mutex};
      for (const auto& session : _sessions)
      {
         auto seq = session->_sequence.load();
         if (seq == start)
         {
            seq = session->wait(start);
         }
         if (order(seq) < order(lowest_sequence))
         {
            lowest_sequence = seq;
         }
      }
      return lowest_sequence;
   }
}  // namespace triedent
