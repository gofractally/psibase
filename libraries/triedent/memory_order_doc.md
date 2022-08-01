Memory deallocation analysis:
Requirements:
- All accesses to an object happen before the free pointer is advanced past the object.
Algorithm:
This describes the minimum memory order required for correctness.  The proof below shows why each barrier is necessary.
swap thread:
a.1 copy object (non-atomic)
a.2 write object pointer (release)
a.3 advance swap pointer (release)
a.4 read saved swap pointer (seq_cst)
a.5 advance free pointer to min(swap pointer, saved swap pointer) (synchronizes with allocate)
read/write thread:
b.1 read swap pointer (acquire)
b.2 write saved swap pointer (seq_cst)
b.3 read object pointer (acquire)
b.4 read object (non-atomic)
b.5 clear saved swap pointer (release)
Additional constraints:
- the swap pointer advances monotonically
Proof:
1. If b.3 sees the value written by a.2, then a.1 happens before b.4 (acq/rel object pointer)
2.1. If b.1 sees the value written by a.3 or a later write, then a.2 happens before b.3 (acq/rel swap pointer) and we're home free.
2.2. If b.1 does not see the value written by a.3 or a later write, then it sees a lower value (constraint)
2.2.1. If a.4 sees the value written by b.5 or a later write then b.4 happens before a.5 (acq/rel saved swap pointer) and we're done accessing the object before it is freed
2.2.2. If a.4 sees the value written by b.2, then a.5 will not advance the free pointer past the object
2.2.3. If a.4 does not see the value written by b.2, b.5, or a later write, then a.2 happens before b.3 (seq_cst saved swap pointer) and b.4 accesses the copy, not the original object.
The cases above are exhaustive and the desired invariant is always preserved. QED

Making the object pointer seq_cst, allows the lock (b.2) to be relaxed, so that part of the old code was, in fact, correct.
