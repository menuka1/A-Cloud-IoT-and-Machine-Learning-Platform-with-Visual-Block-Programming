import json as _j, urllib.request as _u, urllib.error as _e
class _R:
    def __init__(self, code, body): self.status_code = code; self._b = body
    def json(self): return _j.loads(self._b)
    def close(self): pass
def _do(method, url, data=None, headers=None):
    r = _u.Request(url, data=data.encode() if data else None, method=method, headers=headers or {})
    try:
        with _u.urlopen(r, timeout=10) as resp: return _R(resp.status, resp.read().decode())
    except _e.HTTPError as e: return _R(e.code, e.read().decode())
def post(url, data=None, headers=None): return _do("POST", url, data, headers)
def get(url, headers=None): return _do("GET", url, None, headers)
