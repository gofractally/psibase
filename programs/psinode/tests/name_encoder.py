class NameCount:
    def __init__(self, with_sep, without_sep):
        self.with_sep = with_sep
        self.without_sep = without_sep

class NameEncoder:
    def __init__(self, maxlen, num_regular_chars):
        tail_counts = [NameCount(0, 0) for i in range(maxlen)]
        tail_counts[0].with_sep = 1
        tail_counts[0].without_sep = 0

        for i in range(1, maxlen):
            tail_counts[i].without_sep = num_regular_chars * tail_counts[i - 1].with_sep
            tail_counts[i].with_sep = tail_counts[i - 1].without_sep + tail_counts[i].without_sep + 1
        self.maxlen = maxlen
        self.num_regular_chars = num_regular_chars
        self.tail_counts = tail_counts

    def max(self):
        return self.num_regular_chars * self.tail_counts[self.maxlen - 1].with_sep

    def encode(self, s, sep_idx):
        result = 0
        maxlen = self.maxlen
        allows_sep = False;
        allows_end = True;
        for idx in s:
            if maxlen == 0 or idx < 0 or idx >= self.num_regular_chars + 1 or idx == sep_idx and not allows_sep:
                return -1
            # Count the prefix
            if allows_end:
                result += 1
            # Count names with lower chars in this position
            if idx <= sep_idx:
                result += idx * self.tail_counts[maxlen - 1].with_sep
            else:
                result += (idx - 1) * self.tail_counts[maxlen - 1].with_sep
                if allows_sep:
                    result += self.tail_counts[maxlen - 1].without_sep
            allows_sep = idx != sep_idx
            allows_end = allows_sep
            maxlen -= 1

        if allows_end:
            return result
        else:
            return -1

    def decode(self, value, sep_idx):
         if value > self.max():
            return
         maxlen = self.maxlen
         allows_sep = False;
         allows_end = True;
         while value != 0 or not allows_end:
            if allows_end:
               value -= 1;
            tail = self.tail_counts[maxlen - 1].with_sep
            idx  = 0
            if allows_sep:
               tail_sep = self.tail_counts[maxlen - 1].without_sep
               if value >= tail * sep_idx + tail_sep:
                  value -= tail_sep
                  idx += 1
            elif value >= tail * sep_idx:
               idx += 1
            idx += value // tail
            value %= tail
            allows_sep = idx != sep_idx
            allows_end = allows_sep
            maxlen -= 1
            yield idx
