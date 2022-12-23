Memory deallocation analysis:
Requirements:
- All accesses to an object happen before the free pointer is advanced past the object.
Algorithm:
This describes the minimum memory order required for correctness.  The proof below shows why each barrier is necessary.
swap thread:
a.1 copy object (non-atomic)
a.2 write object pointer (seq_cst)
a.3 advance swap pointer (release)
a.4 read saved swap pointer (seq_cst)
a.5 advance free pointer to min(swap pointer, saved swap pointer) (synchronizes with allocate)
read/write thread:
b.1 read swap pointer (acquire)
b.2 write saved swap pointer (seq_cst)
b.3 read object pointer (seq_cst)
b.4 read object (non-atomic)
b.5 clear saved swap pointer (release)
Additional constraints:
- the swap pointer advances monotonically
- Only a single thread writes to each saved swap pointer
- Any other writes to the object pointer happen before the swap thread processes it.
Proof:
1.1. If b.3 sees the value written by a.2, then a.1 happens before b.4 (acq/rel object pointer) and b.4 accesses the copy, not the original object.
1.2. If b.3 does not see the value written by a.2 or a later write, then b.3 is before a.2 in the seq_cst total ordering.

2.1. If b.1 sees the value written by a.3 or a later write, then a.2 happens before b.3 and we're in case 1.1.
2.2. If b.1 does not see the value written by a.3 or a later writer, then it sees a lower value (constraint)
2.2.1. If a.4 sees the value written by b.5 or a later write then b.4 happens before a.5 (acq/rel saved swap pointer) and we're done accessing the object before it is freed (2.2 guarantees that the value stored in the saved swap pointer is sufficient to protect the object)
2.2.2. If a.4 sees the value written by b.2, then a.5 will not advance the free pointer past the object.
2.2.3. If a.4 does not see the value written by b.2, b.5, or a later write, then a.4 must be before b.2 in the seq_cst total ordering.

The only problematic cases are 1.2 and 2.2.3 and they cannot happen simultaneously as that would require the following, which is not a total ordering: b.2 < b.3, b.3 < a.2, a.2 < a.4, and a.4 < b.2.
