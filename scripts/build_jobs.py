"""How many worker processes a build may start: sized by free memory as well as CPUs.

The release builds fork a pool of workers (build-release.sh's file scan, build-voice-packs.sh's pack splits). A pool
sized by CPU count alone is fine for one build and fatal for several: six build-voice-packs.sh runs started together
(10/25) took 16 workers each, about 330 MB apiece, and used all 24 GB and the swap until the OOM killer ended the
release candidate. So each pool starts

    workers = max(1, min(CPUs, tasks, CAP, (MemAvailable - claimed - RESERVE) / per_worker))

MemAvailable is read from /proc/meminfo; where there is none (macOS) the memory limit is skipped. Builds started at
the same moment would all read the same free memory, since none of them has taken any yet. So the sizing runs under a
machine-wide flock, and a build that gets a pool writes it on a small list (pid, workers, MB each); the next sizing
counts what those pools have yet to take (their share less their children's memory now) as already spent. A pool that
is gone (its process ended, or released it) or more than RAMP_S old counts for nothing: by then it is in MemAvailable.

  LORE_BUILD_JOBS=N   use exactly N workers (still no more than there are tasks); the memory reading is skipped
  LORE_BUILD_JOBS_LOCK  the lock file (tests); the list sits beside it

One line says how many and why, e.g. "build-release: 12 workers (16.9 GB free, ~400 MB each)". The lock is held for the
sizing only, never while the workers run.
"""

import os
import sys
import time
from pathlib import Path

try:
    import fcntl
except ImportError:   # Windows
    fcntl = None

CAP = 32            # no more workers than this, however many CPUs
RESERVE_MB = 1024   # kept free for the parent, the shell and whatever else is running
RAMP_S = 300        # a pool counts as still filling up for this long after it started
LOCK_WAIT_S = 30    # then size without the lock rather than hang
LOCK = Path(os.environ.get("LORE_BUILD_JOBS_LOCK") or Path.home() / ".cache" / "lore-forever" / "build-jobs.lock")


def available_mb(meminfo="/proc/meminfo"):
    """MemAvailable in MB, or None when the file isn't there or doesn't say."""
    try:
        for line in Path(meminfo).read_text().splitlines():
            if line.startswith("MemAvailable:"):
                return int(line.split()[1]) / 1024
    except (OSError, ValueError, IndexError):
        pass
    return None


def children_rss_mb(pid):
    """Resident MB of the processes whose parent is `pid`, or None when `pid` is gone."""
    try:
        os.kill(pid, 0)   # (not /proc/<pid>: macOS has no /proc, and its builds still list their pools)
    except ProcessLookupError:
        return None
    except OSError:
        pass
    total = 0.0
    for status in Path("/proc").glob("[0-9]*/status"):
        try:
            fields = dict(line.split(":", 1) for line in status.read_text().splitlines() if ":" in line)
            if int(fields["PPid"]) == pid:
                total += int(fields.get("VmRSS", "0 kB").split()[0]) / 1024
        except (OSError, ValueError, KeyError, IndexError):
            continue
    return total


def claimed_mb(runs, now, children=children_rss_mb):
    """What pools started lately have yet to take (their share less their children's memory now), and the list lines
    still going."""
    total, live = 0.0, []
    try:
        entries = runs.read_text().splitlines()
    except OSError:
        entries = []
    for line in entries:
        try:
            pid, at, n, per = line.split()
            have = children(int(pid))
            if have is None or now - float(at) > RAMP_S:
                continue
            total += max(0.0, int(n) * float(per) - have)
        except ValueError:
            continue
        live.append(line)
    return total, live


class Slot:
    """A pool's place on the list: `workers` is its size. Release it when the pool is done (or use `with`)."""

    def __init__(self, workers, runs=None, line=None, lock=None):
        self.workers, self.runs, self.line, self.lock = workers, runs, line, lock

    def release(self):
        runs, self.runs = self.runs, None
        if runs is None:
            return
        with _locked(self.lock) as held:
            try:
                keep = [x for x in runs.read_text().splitlines() if x != self.line]
                runs.write_text("".join(x + "\n" for x in keep))
            except OSError:
                pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.release()


class _locked:
    """The machine-wide lock for as long as the `with` lasts; no lock (fcntl missing, file unwritable, or busy for
    LOCK_WAIT_S) is not an error, the sizing just goes ahead."""

    def __init__(self, path, wait=LOCK_WAIT_S):
        self.path, self.wait, self.fd = path, wait, None

    def __enter__(self):
        if fcntl is None:
            return False
        try:
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
            self.fd = os.open(self.path, os.O_RDWR | os.O_CREAT | os.O_CLOEXEC, 0o666)   # not inherited by workers
        except OSError:
            return False
        end = time.monotonic() + self.wait
        while True:
            try:
                fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                return True
            except OSError:
                if time.monotonic() >= end:
                    return False
                time.sleep(0.05)

    def __exit__(self, *exc):
        if self.fd is not None:
            os.close(self.fd)   # closing drops the flock
            self.fd = None


def reserve(label, per_worker_mb, *, tasks=None, cpus=None, cap=CAP, env=os.environ, meminfo="/proc/meminfo",
            lock=None, say=None, clock=time.time, children=children_rss_mb):
    """Size a pool and put it on the list; returns a Slot (slot.workers). label: who is asking, for the one line it
    says. per_worker_mb: what one worker's memory peaks at. tasks: how much work there is (no more workers than it)."""
    say = say or (lambda s: print(s, file=sys.stderr, flush=True))   # stderr: build-voice-packs --sizes prints rows to stdout
    cpus = cpus or os.cpu_count() or 1
    hard = min(cpus, cap)
    if tasks is not None:
        hard = min(hard, tasks)
    hard = max(1, hard)
    lock = Path(lock or LOCK)
    runs = lock.with_suffix(".runs")
    raw = (env.get("LORE_BUILD_JOBS") or "").strip()
    override = None
    if raw:
        try:
            override = max(1, int(raw))
        except ValueError:
            say(f"{label}: LORE_BUILD_JOBS must be a whole number, got '{raw}'; sizing by memory")
    with _locked(lock) as held:
        free = available_mb(meminfo)
        claimed, live = claimed_mb(runs, clock(), children) if free is not None and held else (0.0, [])
        if override is not None:
            n = override if tasks is None else min(override, max(1, tasks))
            why = "LORE_BUILD_JOBS"
        elif free is None:
            n, why = hard, "no memory reading here, one per CPU"
        else:
            fit = int((free - claimed - RESERVE_MB) // per_worker_mb)
            n = max(1, min(hard, fit))
            why = f"{free / 1024:.1f} GB free, ~{per_worker_mb:g} MB each"
            if claimed:
                why += f", {claimed / 1024:.1f} GB of it going to builds just started"
            if n < hard:
                why += ", limited by memory"
        line = None
        if free is not None and held and (tasks is None or tasks > 0):
            line = f"{os.getpid()} {clock():.0f} {n} {per_worker_mb:g}"
            try:
                runs.parent.mkdir(parents=True, exist_ok=True)
                runs.write_text("".join(x + "\n" for x in live + [line]))
            except OSError:
                line = None
    say(f"{label}: {n} workers ({why})")
    return Slot(n, runs if line else None, line, lock)
