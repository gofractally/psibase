# Minimal uploader for the node's file store: one file, 1 MiB parts.
import hashlib, base64, sys, time, urllib.request
host, path = sys.argv[1], sys.argv[2]
PART = 1 << 20
def vi(n):
    o = b''
    while n >= 0x80: o += bytes([n & 0x7f | 0x80]); n >>= 7
    return o + bytes([n])
def cid(codec, digest): return 'b' + base64.b32encode(bytes([1, codec, 0x12, 0x20]) + digest).decode().lower().rstrip('=')
def req(method, url, data=None):
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header('Host', 'x-ipfs.psibase.localhost:8099')
    try:
        with urllib.request.urlopen(r) as f: return f.status, f.read()
    except urllib.error.HTTPError as e: return e.code, e.read()
data = open(path, 'rb').read()
t0 = time.time()
if len(data) <= PART:
    c = cid(0x55, hashlib.sha256(data).digest())
    print(req('PUT', f'{host}/block/{c}', data)); print(c); sys.exit()
parts = [data[i:i + PART] for i in range(0, len(data), PART)]
node = b''
for p in parts:
    lc = bytes([1, 0x55, 0x12, 0x20]) + hashlib.sha256(p).digest()
    link = b'\x0a' + vi(len(lc)) + lc + b'\x12\x00' + b'\x18' + vi(len(p))
    node += b'\x12' + vi(len(link)) + link
fs = b'\x08\x02' + b'\x18' + vi(len(data)) + b''.join(b'\x20' + vi(len(p)) for p in parts)
node += b'\x0a' + vi(len(fs)) + fs
c = cid(0x70, hashlib.sha256(node).digest())
print('root', req('PUT', f'{host}/block/{c}', node))
s, body = req('GET', f'{host}/file/{c}')
start = 0 if body == b'complete' else int(body)
if body != b'complete':
    for i in range(start, len(parts)):
        s, body = req('PUT', f'{host}/file/{c}/{i}', parts[i])
        if s not in (200, 201): print('part', i, s, body); sys.exit(1)
print('uploaded', len(data), 'bytes in', round(time.time() - t0, 2), 's ->', body)
print(c)
