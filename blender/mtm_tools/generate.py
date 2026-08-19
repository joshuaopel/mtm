# SPDX-License-Identifier: MIT
"""
A Python port of the game's terrain and road generation.

The runtime builds terrain from noise plus authored features, and lofts the
road ribbon along a re-splined curve. None of that exists as geometry in
Blender, which is why authoring a track used to mean editing a curve floating
in empty space and hoping.

This mirrors the TypeScript exactly — `src/core/Noise.ts`, `src/game/RoadPath.ts`
and `src/game/Terrain.ts`, plus three.js's `CatmullRomCurve3`, which is what
`RoadPath` re-splines the exported points with — so the preview it feeds is the
terrain you will actually drive on, not an impression of it. If you change a
formula there, change it here. `blender/tests/test_generate.py` pins the two
together with values printed from the running JavaScript.

"Exactly" is meant literally and was measured: over a 760m course with a hill,
a crater, a plateau and a ridge, the two implementations agree on every one of
10,201 heights to within 3 micrometres, which is the float32 the runtime stores
its heights in.

No Blender API is used in this module, so it can be tested standalone.
"""

import math

# ---------------------------------------------------------------------------
# Value noise — a port of ValueNoise2D
# ---------------------------------------------------------------------------

_UINT32 = 0xFFFFFFFF


def _imul(a, b):
    """
    JavaScript's Math.imul: 32-bit integer multiply with wraparound,
    returning a signed result. Python ints are arbitrary precision, so the
    truncation has to be explicit or the hash diverges immediately.
    """
    result = (a * b) & _UINT32
    return result - 0x100000000 if result >= 0x80000000 else result


def _to_int32(value):
    value &= _UINT32
    return value - 0x100000000 if value >= 0x80000000 else value


def _ushift(value, bits):
    """JavaScript's >>> — logical shift on the unsigned 32-bit pattern."""
    return (value & _UINT32) >> bits


def _smoothstep(t):
    return t * t * (3 - 2 * t)


class ValueNoise2D:
    """Hashed-lattice value noise, matching the runtime bit for bit."""

    def __init__(self, seed):
        self.seed = int(seed) & _UINT32

    def _hash(self, ix, iy):
        h = _to_int32(_imul(ix, 374761393) + _imul(iy, 668265263) + self.seed)
        h = _imul(h ^ _ushift(h, 13), 1274126177)
        return _ushift(h ^ _ushift(h, 16), 0) / 4294967296.0

    def sample(self, x, y):
        x0 = math.floor(x)
        y0 = math.floor(y)
        fx = _smoothstep(x - x0)
        fy = _smoothstep(y - y0)

        n00 = self._hash(x0, y0)
        n10 = self._hash(x0 + 1, y0)
        n01 = self._hash(x0, y0 + 1)
        n11 = self._hash(x0 + 1, y0 + 1)

        top = n00 + (n10 - n00) * fx
        bottom = n01 + (n11 - n01) * fx
        return top + (bottom - top) * fy

    def fbm(self, x, y, octaves=4, lacunarity=2.0, gain=0.5):
        amplitude = 1.0
        frequency = 1.0
        total = 0.0
        norm = 0.0
        for _ in range(octaves):
            total += self.sample(x * frequency, y * frequency) * amplitude
            norm += amplitude
            amplitude *= gain
            frequency *= lacunarity
        return total / norm


def clamp(value, low, high):
    return low if value < low else high if value > high else value


def smootherstep(edge0, edge1, x):
    t = clamp((x - edge0) / ((edge1 - edge0) or 1e-6), 0.0, 1.0)
    return t * t * t * (t * (t * 6 - 15) + 10)


# ---------------------------------------------------------------------------
# Centripetal Catmull-Rom — the spline the runtime re-builds from the exported
# road points. Matching it matters because the terrain is carved along it.
# ---------------------------------------------------------------------------


def _sub_add(a, b):
    """three's `a - b + a`, the reflection it uses to extrapolate an endpoint."""
    return tuple(a[i] - b[i] + a[i] for i in range(3))


class _CubicPoly:
    """
    A port of three's CubicPoly, including its non-uniform tangent scaling.

    It is tempting to evaluate a non-uniform Catmull-Rom with the textbook
    Barry-Goldman recursion instead. Don't: the two agree only where the knot
    spacing is well behaved, and they part company exactly at the repeated and
    near-repeated control points that three special-cases below. The preview
    has to bend the way the game bends, so this follows three line for line.
    """

    __slots__ = ("c0", "c1", "c2", "c3")

    def __init__(self):
        self.c0 = self.c1 = self.c2 = self.c3 = 0.0

    def _init(self, x0, x1, t0, t1):
        self.c0 = x0
        self.c1 = t0
        self.c2 = -3 * x0 + 3 * x1 - 2 * t0 - t1
        self.c3 = 2 * x0 - 2 * x1 + t0 + t1

    def init_nonuniform(self, x0, x1, x2, x3, dt0, dt1, dt2):
        t1 = (x1 - x0) / dt0 - (x2 - x0) / (dt0 + dt1) + (x2 - x1) / dt1
        t2 = (x2 - x1) / dt1 - (x3 - x1) / (dt1 + dt2) + (x3 - x2) / dt2
        # Rescale the tangents for a parameterisation over [0, 1].
        self._init(x1, x2, t1 * dt1, t2 * dt1)

    def calc(self, t):
        return self.c0 + self.c1 * t + self.c2 * t * t + self.c3 * t * t * t


class CatmullRomCurve3:
    """
    A port of three.js `CatmullRomCurve3` in centripetal mode, plus the arc
    length machinery `Curve` provides.

    The runtime builds one of these from the exported road points and samples
    it with `getSpacedPoints`, so anything Blender previews has to come from
    the same curve. Notably: an open curve extrapolates a reflected point past
    each end rather than repeating the endpoint, which changes where the road
    actually goes near the start and finish line.
    """

    ARC_LENGTH_DIVISIONS = 200

    def __init__(self, points, closed=False):
        self.points = [tuple(float(v) for v in p) for p in points]
        self.closed = bool(closed)
        self._lengths = None

    # -- position -----------------------------------------------------------

    def get_point(self, t):
        points = self.points
        count = len(points)
        if count < 2:
            return points[0] if points else (0.0, 0.0, 0.0)

        p = (count - (0 if self.closed else 1)) * t
        int_point = math.floor(p)
        weight = p - int_point

        if self.closed:
            if int_point <= 0:
                int_point += (math.floor(abs(int_point) / count) + 1) * count
        elif weight == 0 and int_point == count - 1:
            int_point = count - 2
            weight = 1.0

        if self.closed or int_point > 0:
            p0 = points[(int_point - 1) % count]
        else:
            p0 = _sub_add(points[0], points[1])

        p1 = points[int_point % count]
        p2 = points[(int_point + 1) % count]

        if self.closed or int_point + 2 < count:
            p3 = points[(int_point + 2) % count]
        else:
            p3 = _sub_add(points[count - 1], points[count - 2])

        # Centripetal: the fourth root of the squared distance, i.e. sqrt(d).
        dt0 = _distance_squared(p0, p1) ** 0.25
        dt1 = _distance_squared(p1, p2) ** 0.25
        dt2 = _distance_squared(p2, p3) ** 0.25

        # Repeated control points would divide by zero; three substitutes
        # neighbouring spacings instead, and the substitution is visible in the
        # result, so it has to be reproduced rather than approximated.
        if dt1 < 1e-4:
            dt1 = 1.0
        if dt0 < 1e-4:
            dt0 = dt1
        if dt2 < 1e-4:
            dt2 = dt1

        out = []
        poly = _CubicPoly()
        for axis in range(3):
            poly.init_nonuniform(p0[axis], p1[axis], p2[axis], p3[axis], dt0, dt1, dt2)
            out.append(poly.calc(weight))
        return tuple(out)

    # -- arc length ---------------------------------------------------------

    def get_lengths(self, divisions=None):
        divisions = self.ARC_LENGTH_DIVISIONS if divisions is None else divisions
        if self._lengths is not None and len(self._lengths) == divisions + 1:
            return self._lengths

        cache = [0.0]
        last = self.get_point(0.0)
        total = 0.0
        for i in range(1, divisions + 1):
            current = self.get_point(i / divisions)
            total += math.dist(current, last)
            cache.append(total)
            last = current

        self._lengths = cache
        return cache

    def get_length(self):
        return self.get_lengths()[-1]

    def u_to_t(self, u, distance=None):
        arc = self.get_lengths()
        count = len(arc)
        target = distance if distance else u * arc[count - 1]

        low, high, i = 0, count - 1, 0
        while low <= high:
            i = low + (high - low) // 2
            comparison = arc[i] - target
            if comparison < 0:
                low = i + 1
            elif comparison > 0:
                high = i - 1
            else:
                high = i
                break

        i = high
        if i < 0:
            return 0.0
        if arc[i] == target:
            return i / (count - 1)

        span = arc[i + 1] - arc[i]
        fraction = (target - arc[i]) / span if span else 0.0
        return (i + fraction) / (count - 1)

    def get_spaced_points(self, divisions):
        return [self.get_point(self.u_to_t(d / divisions)) for d in range(divisions + 1)]


def _distance_squared(a, b):
    return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2


def road_polyline(control, closed, resolution=1.5):
    """
    The road centreline exactly as `RoadPath` builds it.

    Returns `(points, step, length)`: arc-length-uniform samples, the spacing
    between them, and the total curve length. A closed loop drops the final
    sample because it duplicates the first, which would otherwise leave one
    short segment at the start/finish line.
    """
    if len(control) < 2:
        return [tuple(p) for p in control], 0.0, 0.0

    curve = CatmullRomCurve3(control, closed)
    length = curve.get_length()
    count = max(8, round(length / resolution))
    spaced = curve.get_spaced_points(count)
    sample_count = count if closed else count + 1
    return spaced[:sample_count], length / count, length


# ---------------------------------------------------------------------------
# Terrain — a port of Terrain.generateHeights
# ---------------------------------------------------------------------------


def _distance_to_polyline_2d(x, z, points):
    best = math.inf
    for i in range(len(points) - 1):
        ax, az = points[i]
        bx, bz = points[i + 1]
        dx = bx - ax
        dz = bz - az
        length_sq = dx * dx + dz * dz
        t = clamp(((x - ax) * dx + (z - az) * dz) / length_sq, 0.0, 1.0) if length_sq > 0 else 0.0
        px = ax + dx * t
        pz = az + dz * t
        best = min(best, math.hypot(x - px, z - pz))
    return best


class RoadSamples:
    """Resampled centreline with a bucket grid for nearest-point queries."""

    def __init__(self, points, width, shoulder, step):
        self.points = points
        self.width = width
        self.shoulder = shoulder
        self.step = step
        self.cell = max(8.0, width * 0.5 + shoulder + 4.0)
        self.buckets = {}
        for i, p in enumerate(points):
            key = (math.floor(p[0] / self.cell), math.floor(p[2] / self.cell))
            self.buckets.setdefault(key, []).append(i)

    def closest(self, x, z):
        """Returns (index, lateral distance) or (None, inf) when far away."""
        cx = math.floor(x / self.cell)
        cz = math.floor(z / self.cell)
        best = None
        best_sq = math.inf
        for dx in (-1, 0, 1):
            for dz in (-1, 0, 1):
                for i in self.buckets.get((cx + dx, cz + dz), ()):
                    p = self.points[i]
                    d = (p[0] - x) ** 2 + (p[2] - z) ** 2
                    if d < best_sq:
                        best_sq = d
                        best = i
        if best is None:
            return None, math.inf
        return best, math.sqrt(best_sq)


def generate_heights(terrain, road_samples, segments=None):
    """
    Build the height grid the runtime will build.

    `terrain` is a dict with size/segments/amplitude/frequency/seed/features,
    matching the track JSON. Returns a flat list indexed as
    `iz * (segments + 1) + ix`, the same layout the runtime uses.
    """
    size = terrain["size"]
    n = int(segments if segments is not None else terrain["segments"])
    element = size / n
    amplitude = terrain["amplitude"]
    frequency = terrain["frequency"]
    noise = ValueNoise2D(terrain["seed"])

    def world_x(ix):
        return -size / 2 + ix * element

    def world_z(iz):
        return -size / 2 + iz * element

    heights = [0.0] * ((n + 1) * (n + 1))

    # Pass 1: background fractal terrain, with the rim lifted so the world
    # reads as a bowl rather than ending at a visible cliff.
    for iz in range(n + 1):
        for ix in range(n + 1):
            x = world_x(ix)
            z = world_z(iz)
            base = noise.fbm(x * frequency, z * frequency, 4)
            h = (base - 0.5) * 2 * amplitude
            edge = max(abs(x), abs(z)) / (size / 2)
            h += smootherstep(0.72, 1.0, edge) * amplitude * 3.5
            heights[iz * (n + 1) + ix] = h

    # Pass 2: authored features.
    for feature in terrain.get("features", []):
        _apply_feature(heights, feature, n, size, element, world_x, world_z)

    # Pass 3: carve the road last so it always wins over the scenery.
    if road_samples is not None:
        _flatten_along_road(heights, road_samples, n, world_x, world_z)

    return heights


def _apply_feature(heights, feature, n, size, element, world_x, world_z):
    kind = feature["type"]

    if kind == "ridge":
        half = feature["width"] * 0.5
        pts = [tuple(p) for p in feature["points"]]
        for iz in range(n + 1):
            for ix in range(n + 1):
                d = _distance_to_polyline_2d(world_x(ix), world_z(iz), pts)
                if d > half:
                    continue
                t = 1 - smootherstep(0, half, d)
                heights[iz * (n + 1) + ix] += feature["height"] * t
        return

    fx, fz = feature["pos"]
    radius = feature["radius"]
    min_x = int(clamp(math.floor((fx - radius + size / 2) / element), 0, n))
    max_x = int(clamp(math.ceil((fx + radius + size / 2) / element), 0, n))
    min_z = int(clamp(math.floor((fz - radius + size / 2) / element), 0, n))
    max_z = int(clamp(math.ceil((fz + radius + size / 2) / element), 0, n))

    for iz in range(min_z, max_z + 1):
        for ix in range(min_x, max_x + 1):
            x = world_x(ix)
            z = world_z(iz)
            d = math.hypot(x - fx, z - fz)
            if d > radius:
                continue
            i = iz * (n + 1) + ix
            t = 1 - smootherstep(0, radius, d)

            if kind == "hill":
                heights[i] += feature["height"] * t * t
            elif kind == "crater":
                rim = math.exp(-(((d / radius) - 0.85) ** 2) / 0.01)
                heights[i] -= feature["depth"] * t * t
                heights[i] += feature["depth"] * 0.35 * rim
            elif kind == "plateau":
                blend = 1 - smootherstep(radius * (1 - feature["falloff"]), radius, d)
                heights[i] += (feature["height"] - heights[i]) * blend


def _flatten_along_road(heights, road, n, world_x, world_z):
    half_width = road.width * 0.5
    outer = half_width + road.shoulder

    for iz in range(n + 1):
        for ix in range(n + 1):
            x = world_x(ix)
            z = world_z(iz)
            index, lateral = road.closest(x, z)
            if index is None or lateral > outer:
                continue
            road_y = road.points[index][1]
            i = iz * (n + 1) + ix
            blend = 1 - smootherstep(half_width, outer, lateral)
            heights[i] += (road_y - heights[i]) * blend
