-- Willo's sky (LOR-416): how Live game info shows. Rings of stars round Willo in a blue mist over the minimap, which
-- the companion app on this PC reads the 45 bytes of Strip.Payload from, by which stars shine
-- (companion/lore_companion/sky.py has the format). Strip.lua decides when it shows (Strip.Showing) and drives the
-- repaints; it replaced the block of coloured squares in the corner in 0.18.0.
--
-- The sky is a disc U sky units across; a unit is a whole number of screen pixels (Sky.Place: as big as the minimap
-- allows, at least 2), and the sky sits on whole pixels, so every core is exact:
--   GUIDES  3 sparkles of 3 x 3 units on the rim, a white cross with black corners: the companion finds the sky by them
--   SLOTS   488 star spots on 10 rings round the wisp, each a 1 x 1 unit core at (X, Y) hundredths of a unit: a white
--           star for 1, nothing (the mist) for 0. The 45 bytes, then PARITY Reed-Solomon bytes (GF(256), polynomial
--           0x11D), XORed with WHITEN, high bit first
-- On or off, not colours, so the game's colour-blind filter, gamma and HDR can't change what's read. The mist, the
-- wisp and the stars' halos are drawn under the cores and animate; the cores only change when the bytes do.

local _, ns = ...
local Sky = {}
ns.Sky = Sky

Sky.U = 60
Sky.GUIDES = { { 28, 1 }, { 52, 42 }, { 5, 42 } }
Sky.SLOTS = {
  { 3690, 2950 }, { 3660, 3158 }, { 3573, 3350 }, { 3435, 3509 }, { 3257, 3623 }, { 3055, 3682 }, { 2845, 3682 },
  { 2643, 3623 }, { 2465, 3509 }, { 2327, 3350 }, { 2240, 3158 }, { 2210, 2950 }, { 2240, 2742 }, { 2327, 2550 },
  { 2465, 2391 }, { 2643, 2277 }, { 2845, 2218 }, { 3055, 2218 }, { 3257, 2277 }, { 3435, 2391 }, { 3573, 2550 },
  { 3660, 2742 }, { 3677, 3562 }, { 3522, 3708 }, { 3339, 3817 }, { 3136, 3882 }, { 2925, 3900 }, { 2714, 3870 },
  { 2515, 3795 }, { 2338, 3677 }, { 2192, 3522 }, { 2083, 3339 }, { 2018, 3136 }, { 2000, 2925 }, { 2030, 2714 },
  { 2105, 2515 }, { 2223, 2338 }, { 2378, 2192 }, { 2561, 2083 }, { 2764, 2018 }, { 2975, 2000 }, { 3186, 2030 },
  { 3385, 2105 }, { 3562, 2223 }, { 3708, 2378 }, { 3817, 2561 }, { 3882, 2764 }, { 3900, 2975 }, { 3870, 3186 },
  { 3795, 3385 }, { 3147, 4093 }, { 2934, 4110 }, { 2721, 4087 }, { 2516, 4026 }, { 2326, 3928 }, { 2157, 3796 },
  { 2015, 3636 }, { 1904, 3452 }, { 1830, 3252 }, { 1794, 3041 }, { 1797, 2827 }, { 1839, 2617 }, { 1919, 2418 },
  { 2034, 2238 }, { 2181, 2082 }, { 2353, 1955 }, { 2546, 1863 }, { 2753, 1807 }, { 2966, 1790 }, { 3179, 1813 },
  { 3384, 1874 }, { 3574, 1972 }, { 3743, 2104 }, { 3885, 2264 }, { 3996, 2448 }, { 4070, 2648 }, { 4106, 2859 },
  { 4103, 3073 }, { 4061, 3283 }, { 3981, 3482 }, { 3866, 3662 }, { 3719, 3818 }, { 3547, 3945 }, { 3354, 4037 },
  { 2258, 4133 }, { 2082, 4010 }, { 1927, 3861 }, { 1797, 3690 }, { 1695, 3500 }, { 1625, 3297 }, { 1587, 3086 },
  { 1582, 2871 }, { 1612, 2658 }, { 1674, 2452 }, { 1767, 2258 }, { 1890, 2082 }, { 2039, 1927 }, { 2210, 1797 },
  { 2400, 1695 }, { 2603, 1625 }, { 2814, 1587 }, { 3029, 1582 }, { 3242, 1612 }, { 3448, 1674 }, { 3642, 1767 },
  { 3818, 1890 }, { 3973, 2039 }, { 4103, 2210 }, { 4205, 2400 }, { 4275, 2603 }, { 4313, 2814 }, { 4318, 3029 },
  { 4288, 3242 }, { 4226, 3448 }, { 4133, 3642 }, { 4010, 3818 }, { 3861, 3973 }, { 3690, 4103 }, { 3500, 4205 },
  { 3297, 4275 }, { 3086, 4313 }, { 2871, 4318 }, { 2658, 4288 }, { 2452, 4226 }, { 1461, 3479 }, { 1404, 3276 },
  { 1374, 3067 }, { 1373, 2856 }, { 1399, 2647 }, { 1454, 2443 }, { 1535, 2248 }, { 1641, 2065 }, { 1770, 1899 },
  { 1921, 1751 }, { 2090, 1625 }, { 2274, 1522 }, { 2471, 1444 }, { 2676, 1394 }, { 2886, 1371 }, { 3097, 1377 },
  { 3305, 1410 }, { 3507, 1471 }, { 3699, 1559 }, { 3878, 1671 }, { 4040, 1806 }, { 4183, 1962 }, { 4303, 2135 },
  { 4400, 2322 }, { 4471, 2521 }, { 4514, 2728 }, { 4530, 2938 }, { 4517, 3149 }, { 4477, 3356 }, { 4409, 3556 },
  { 4315, 3745 }, { 4197, 3920 }, { 4057, 4078 }, { 3897, 4215 }, { 3720, 4330 }, { 3529, 4420 }, { 3328, 4484 },
  { 3120, 4521 }, { 2909, 4529 }, { 2699, 4510 }, { 2493, 4462 }, { 2296, 4388 }, { 2110, 4288 }, { 1939, 4164 },
  { 1786, 4018 }, { 1654, 3854 }, { 1545, 3673 }, { 1274, 2322 }, { 1360, 2128 }, { 1468, 1946 }, { 1597, 1778 },
  { 1745, 1626 }, { 1910, 1493 }, { 2090, 1380 }, { 2282, 1289 }, { 2483, 1222 }, { 2691, 1179 }, { 2902, 1161 },
  { 3114, 1168 }, { 3324, 1199 }, { 3528, 1256 }, { 3724, 1336 }, { 3910, 1439 }, { 4082, 1563 }, { 4238, 1707 },
  { 4376, 1868 }, { 4494, 2044 }, { 4590, 2233 }, { 4663, 2432 }, { 4713, 2638 }, { 4737, 2849 }, { 4737, 3061 },
  { 4711, 3271 }, { 4661, 3477 }, { 4586, 3676 }, { 4489, 3865 }, { 4370, 4040 }, { 4231, 4200 }, { 4074, 4343 },
  { 3901, 4466 }, { 3715, 4568 }, { 3519, 4647 }, { 3314, 4703 }, { 3104, 4733 }, { 2892, 4739 }, { 2681, 4720 },
  { 2473, 4675 }, { 2273, 4607 }, { 2081, 4515 }, { 1902, 4401 }, { 1738, 4267 }, { 1591, 4115 }, { 1463, 3946 },
  { 1355, 3763 }, { 1270, 3569 }, { 1209, 3366 }, { 1172, 3157 }, { 1160, 2945 }, { 1173, 2733 }, { 1211, 2525 },
  { 1969, 1207 }, { 2160, 1113 }, { 2360, 1039 }, { 2567, 987 }, { 2777, 957 }, { 2990, 950 }, { 3202, 966 },
  { 3412, 1004 }, { 3616, 1064 }, { 3813, 1146 }, { 4000, 1248 }, { 4175, 1369 }, { 4336, 1508 }, { 4481, 1663 },
  { 4609, 1834 }, { 4719, 2016 }, { 4808, 2210 }, { 4876, 2411 }, { 4922, 2619 }, { 4946, 2830 }, { 4948, 3043 },
  { 4927, 3255 }, { 4883, 3464 }, { 4817, 3666 }, { 4731, 3861 }, { 4624, 4045 }, { 4498, 4216 }, { 4355, 4374 },
  { 4195, 4515 }, { 4022, 4638 }, { 3836, 4743 }, { 3641, 4827 }, { 3437, 4890 }, { 3228, 4931 }, { 3016, 4949 },
  { 2803, 4945 }, { 2592, 4918 }, { 2385, 4869 }, { 2184, 4798 }, { 1992, 4706 }, { 1811, 4594 }, { 1643, 4464 },
  { 1489, 4316 }, { 1352, 4153 }, { 1234, 3977 }, { 1134, 3788 }, { 1055, 3591 }, { 998, 3386 }, { 963, 3176 },
  { 950, 2963 }, { 960, 2750 }, { 992, 2540 }, { 1047, 2334 }, { 1123, 2136 }, { 1220, 1946 }, { 1337, 1768 },
  { 1472, 1603 }, { 1623, 1454 }, { 1790, 1321 }, { 3362, 779 }, { 3567, 828 }, { 3766, 896 }, { 3957, 983 },
  { 4140, 1088 }, { 4311, 1209 }, { 4471, 1346 }, { 4616, 1498 }, { 4747, 1663 }, { 4861, 1840 }, { 4958, 2026 },
  { 5036, 2221 }, { 5096, 2423 }, { 5137, 2629 }, { 5157, 2839 }, { 5158, 3049 }, { 5138, 3258 }, { 5099, 3465 },
  { 5040, 3667 }, { 4963, 3862 }, { 4867, 4050 }, { 4754, 4227 }, { 4624, 4393 }, { 4480, 4545 }, { 4321, 4683 },
  { 4150, 4806 }, { 3968, 4911 }, { 3777, 4999 }, { 3579, 5069 }, { 3374, 5119 }, { 3166, 5149 }, { 2956, 5160 },
  { 2746, 5151 }, { 2538, 5121 }, { 2333, 5072 }, { 2134, 5004 }, { 1943, 4917 }, { 1760, 4812 }, { 1589, 4691 },
  { 1429, 4554 }, { 1284, 4402 }, { 1153, 4237 }, { 1039, 4060 }, { 942, 3874 }, { 864, 3679 }, { 804, 3477 },
  { 763, 3271 }, { 743, 3061 }, { 742, 2851 }, { 762, 2642 }, { 801, 2435 }, { 860, 2233 }, { 937, 2038 },
  { 1033, 1850 }, { 1146, 1673 }, { 1276, 1507 }, { 1420, 1355 }, { 1579, 1217 }, { 1750, 1094 }, { 1932, 989 },
  { 2123, 901 }, { 2321, 831 }, { 2526, 781 }, { 2734, 751 }, { 2944, 740 }, { 3154, 749 }, { 4827, 1422 },
  { 4953, 1592 }, { 5064, 1771 }, { 5158, 1960 }, { 5236, 2156 }, { 5297, 2359 }, { 5339, 2565 }, { 5364, 2775 },
  { 5370, 2986 }, { 5357, 3197 }, { 5327, 3406 }, { 5278, 3611 }, { 5211, 3812 }, { 5128, 4005 }, { 4911, 4368 },
  { 4780, 4533 }, { 4635, 4687 }, { 4478, 4827 }, { 4308, 4953 }, { 4129, 5064 }, { 3940, 5158 }, { 3744, 5236 },
  { 3541, 5297 }, { 3335, 5339 }, { 3125, 5364 }, { 2914, 5370 }, { 2703, 5357 }, { 2494, 5327 }, { 2289, 5278 },
  { 2088, 5211 }, { 1895, 5128 }, { 1709, 5027 }, { 1532, 4911 }, { 1367, 4780 }, { 1213, 4635 }, { 1073, 4478 },
  { 947, 4308 }, { 742, 3940 }, { 664, 3744 }, { 603, 3541 }, { 561, 3335 }, { 536, 3125 }, { 530, 2914 },
  { 543, 2703 }, { 573, 2494 }, { 622, 2289 }, { 689, 2088 }, { 772, 1895 }, { 873, 1709 }, { 989, 1532 },
  { 1120, 1367 }, { 1265, 1213 }, { 1422, 1073 }, { 1592, 947 }, { 1771, 836 }, { 1960, 742 }, { 2156, 664 },
  { 2359, 603 }, { 2565, 561 }, { 2775, 536 }, { 2986, 530 }, { 3197, 543 }, { 3406, 573 }, { 3611, 622 },
  { 3812, 689 }, { 4005, 772 }, { 4191, 873 }, { 4368, 989 }, { 4533, 1120 }, { 4687, 1265 }, { 5580, 2994 },
  { 5568, 3206 }, { 5538, 3415 }, { 5493, 3622 }, { 5430, 3825 }, { 5026, 4565 }, { 4889, 4727 }, { 4740, 4877 },
  { 4579, 5015 }, { 4407, 5139 }, { 4227, 5249 }, { 4037, 5345 }, { 3841, 5424 }, { 3639, 5488 }, { 3433, 5535 },
  { 3223, 5566 }, { 3012, 5579 }, { 2800, 5576 }, { 2589, 5555 }, { 2381, 5518 }, { 2176, 5464 }, { 1976, 5393 },
  { 1783, 5307 }, { 1597, 5205 }, { 1420, 5089 }, { 1253, 4959 }, { 1097, 4816 }, { 952, 4661 }, { 513, 3940 },
  { 442, 3741 }, { 386, 3536 }, { 347, 3328 }, { 325, 3118 }, { 320, 2906 }, { 332, 2694 }, { 362, 2485 },
  { 407, 2278 }, { 470, 2075 }, { 548, 1879 }, { 642, 1689 }, { 751, 1507 }, { 874, 1335 }, { 1011, 1173 },
  { 1160, 1023 }, { 1321, 885 }, { 1493, 761 }, { 1673, 651 }, { 1863, 555 }, { 2059, 476 }, { 2261, 412 },
  { 2467, 365 }, { 3311, 345 }, { 3519, 382 }, { 3724, 436 }, { 3924, 507 }, { 4117, 593 }, { 4303, 695 },
  { 4480, 811 }, { 4647, 941 }, { 4803, 1084 }, { 4948, 1239 }, { 5079, 1406 }, { 5196, 1582 }, { 5299, 1767 },
  { 5387, 1960 }, { 5458, 2159 }, { 5514, 2364 }, { 5553, 2572 }, { 5575, 2782 }
}
Sky.PAYLOAD, Sky.PARITY = 45, 16   -- Strip.Payload's bytes, then the repair bytes: 488 bits, one a star
Sky.WHITEN = {
  38, 234, 85, 3, 117, 160, 176, 103, 233, 230, 118, 195, 161, 147, 97, 166, 223, 51, 198, 1, 120, 105, 75, 229,
  165, 138, 12, 41, 213, 231, 58, 9, 147, 243, 215, 231, 53, 140, 93, 206, 253, 73, 168, 83, 205, 242, 179, 161,
  252, 191, 183, 57, 137, 44, 209, 80, 149, 50, 229, 134, 104
}
Sky.WHITE_CELLS = { { 1, 0 }, { 0, 1 }, { 1, 1 }, { 2, 1 }, { 1, 2 } }
Sky.BLACK_CELLS = { { 0, 0 }, { 2, 0 }, { 0, 2 }, { 2, 2 } }
local U = Sky.U
local MIN_UNIT, MAX_UNIT, FILL = 2, 8, 0.9   -- FILL: the share of the minimap's round map the sky covers
local GLOW = "Interface\\GLUES\\Models\\UI_Draenei\\GenericGlow64"
local DISC = "Interface\\CHARACTERFRAME\\TempPortraitAlphaMask"
local FPS = 20

local xor = ns.Strip.xor

-- Reed-Solomon over GF(256): exp and log tables, the generator's coefficients (highest power first).
local EXP, LOG = {}, {}
do
  local x = 1
  for i = 0, 254 do
    EXP[i], LOG[x] = x, i
    x = x * 2
    if x >= 256 then x = xor(x, 0x11D) end
  end
  for i = 255, 509 do EXP[i] = EXP[i - 255] end
end
local function mul(a, b)
  if a == 0 or b == 0 then return 0 end
  return EXP[LOG[a] + LOG[b]]
end
local GEN = { 1 }
for i = 0, Sky.PARITY - 1 do
  local g = {}
  for j = 1, #GEN + 1 do
    g[j] = xor(GEN[j] or 0, mul(GEN[j - 1] or 0, EXP[i]))
  end
  GEN = g
end

-- The bytes followed by their PARITY Reed-Solomon bytes.
function Sky.Encode(bytes)
  local out = {}
  for i, b in ipairs(bytes) do out[i] = b end
  local n = #bytes
  for i = n + 1, n + Sky.PARITY do out[i] = 0 end
  for i = 1, n do
    local c = out[i]
    if c ~= 0 then
      for j = 2, #GEN do out[i + j - 1] = xor(out[i + j - 1], mul(GEN[j], c)) end
    end
  end
  for i, b in ipairs(bytes) do out[i] = b end   -- the division used them as scratch: the bytes themselves go first
  return out
end

-- Which star spots shine (1) or not (0), SLOTS' order, for the 45 bytes (fewer are padded with zeros).
function Sky.Bits(bytes)
  local padded = {}
  for i = 1, Sky.PAYLOAD do padded[i] = bytes[i] or 0 end
  bytes = padded
  local out = {}
  for i, b in ipairs(Sky.Encode(bytes)) do
    b = xor(b, Sky.WHITEN[i])
    for k = 7, 0, -1 do out[#out + 1] = math.floor(b / 2 ^ k) % 2 end
  end
  return out
end

-- A core's offset in whole pixels from the sky's corner (sky.py's corner()).
local function corner(v100, unit) return math.floor((v100 * unit + 50) / 100) end
Sky.Corner = corner

local function try(fn, ...)
  if type(fn) ~= "function" then return nil end
  local ok, a, b = pcall(fn, ...)
  if ok then return a, b end
end

-- Where the sky goes, in whole screen pixels: (left, top measured from the bottom, unit, UIParent units a pixel).
-- Centred on the minimap's round map and as big as fits in it; where there's no minimap on screen (another add-on
-- hid it), the top-right corner.
function Sky.Place()
  local _, h = try(GetPhysicalScreenSize)
  if type(h) ~= "number" or h <= 0 then h = 1080 end
  local uh, uw = try(UIParent.GetHeight, UIParent), try(UIParent.GetWidth, UIParent)
  if type(uh) ~= "number" or uh <= 0 or type(uw) ~= "number" then return nil end
  local px = uh / h
  local m = _G.Minimap
  local cx, cy, mw
  if m then
    cx, cy = try(m.GetCenter, m)
    mw = try(m.GetWidth, m)
  end
  if m and try(m.IsVisible, m) and type(cx) == "number" and type(cy) == "number" and type(mw) == "number" and mw > 0 then
    local k = (try(m.GetEffectiveScale, m) or 1) / (try(UIParent.GetEffectiveScale, UIParent) or 1)
    cx, cy = cx * k / px, cy * k / px
    local unit = math.floor(mw * k / px * FILL / U)
    unit = math.max(MIN_UNIT, math.min(MAX_UNIT, unit))
    return math.floor(cx - U * unit / 2 + 0.5), math.floor(cy + U * unit / 2 + 0.5), unit, px
  end
  local unit = math.max(MIN_UNIT, math.min(MAX_UNIT, math.floor(h / 540)))
  local wpx = math.floor(uw / px + 0.5)
  return wpx - U * unit - 16, h - 16, unit, px
end

local frame, cores, halos, guides, clouds, wisp, motes = nil, {}, {}, {}, {}, {}, {}
local placed, shown, lit = nil, {}, {}
local seeds = {}

local function glow(layer, sub, r, g, b, a, blend)
  local t = frame:CreateTexture(nil, layer, nil, sub)
  t:SetTexture(GLOW)
  t:SetVertexColor(r, g, b)
  t:SetAlpha(a)
  pcall(t.SetBlendMode, t, blend or "ADD")
  return t
end

local function create()
  frame = CreateFrame("Frame", "LoreForeverLiveSky", UIParent)
  frame:SetFrameStrata("TOOLTIP")
  pcall(frame.SetFrameLevel, frame, 10000)
  frame:EnableMouse(false)
  if frame.SetIgnoreParentAlpha then frame:SetIgnoreParentAlpha(true) end
  -- The mist: a deep blue disc the map shows faintly through, and lighter wisps of it drifting round.
  local disc = frame:CreateTexture(nil, "BACKGROUND", nil, -8)
  disc:SetTexture(DISC)
  disc:SetVertexColor(0.05, 0.11, 0.29)
  disc:SetAlpha(0.82)
  disc:SetAllPoints(frame)
  local rng = 7
  local function rand()   -- a fixed sequence: the same sky every time
    rng = (rng * 1103515245 + 12345) % 2147483648
    return rng / 2147483648
  end
  for i = 1, 9 do
    local light = 0.8 + rand() * 0.4
    clouds[i] = glow("BACKGROUND", -6, 0.36 * light, 0.56 * light, 0.95 * light, 0.42, "BLEND")
    seeds[i] = { a = rand() * 6.283, r = 4 + rand() * 18, size = 12 + rand() * 12, dir = i % 2 == 0 and 1 or -1 }
  end
  wisp[1] = glow("BORDER", 0, 0.35, 0.63, 1.0, 0.5)     -- bloom
  wisp[2] = glow("BORDER", 1, 0.67, 0.86, 1.0, 0.8)     -- glow
  wisp[3] = glow("BORDER", 2, 1.0, 1.0, 1.0, 1.0)       -- heart
  for i = 1, 4 do motes[i] = glow("BORDER", 3, 0.85, 0.94, 1.0, 0.8) end
  for s = 1, #Sky.SLOTS do
    local h = glow("ARTWORK", 0, 0.62, 0.78, 1.0, 0.5)
    h.speed, h.phase, h.size = 1.2 + rand() * 2, rand() * 6.283, rand()
    h:Hide()
    halos[s] = h
    local c = frame:CreateTexture(nil, "OVERLAY", nil, 7)
    c:SetColorTexture(1, 1, 1, 1)
    c:Hide()
    cores[s] = c
  end
  for g = 1, #Sky.GUIDES do
    local parts = { halo = glow("ARTWORK", 1, 0.62, 0.80, 1.0, 0.6),
      flares = { glow("ARTWORK", 2, 0.80, 0.90, 1.0, 0.85), glow("ARTWORK", 2, 0.80, 0.90, 1.0, 0.85) }, cells = {} }
    for _, cell in ipairs(Sky.WHITE_CELLS) do
      local t = frame:CreateTexture(nil, "OVERLAY", nil, 7)
      t:SetColorTexture(1, 1, 1, 1)
      t.cell = cell
      table.insert(parts.cells, t)
    end
    for _, cell in ipairs(Sky.BLACK_CELLS) do
      local t = frame:CreateTexture(nil, "OVERLAY", nil, 7)
      t:SetColorTexture(0, 0, 0, 1)
      t.cell = cell
      table.insert(parts.cells, t)
    end
    guides[g] = parts
  end
  local acc, clock = 0, 0
  frame:SetScript("OnUpdate", function(_, elapsed)
    acc, clock = acc + (elapsed or 0), clock + (elapsed or 0)
    if acc < 1 / FPS then return end
    acc = 0
    Sky.Animate(clock)
  end)
end

-- Lay the sky out at (left, top) pixels with `unit` pixels a unit; px is UIParent units a pixel. Cores and guides on
-- whole pixels; the rest is animated round them (Sky.Animate).
local function layout(left, top, unit, px)
  local key = left .. ":" .. top .. ":" .. unit .. ":" .. px
  if placed == key then return end
  placed = key
  local u = unit * px
  frame:ClearAllPoints()
  frame:SetPoint("TOPLEFT", UIParent, "BOTTOMLEFT", left * px, top * px)
  frame:SetSize(U * u, U * u)
  frame.u = u
  for s, xy in ipairs(Sky.SLOTS) do
    local c = cores[s]
    -- Round stars where a core is 4 pixels or more (its middle, which the companion reads, stays solid white);
    -- below that a round texture would only blur them.
    if unit >= 4 then
      c:SetTexture(DISC)
      c:SetVertexColor(1, 1, 1, 1)
    else
      c:SetColorTexture(1, 1, 1, 1)
    end
    c:SetSize(u, u)
    c:ClearAllPoints()
    c:SetPoint("TOPLEFT", frame, "TOPLEFT", corner(xy[1], unit) * px, -corner(xy[2], unit) * px)
  end
  for g, xy in ipairs(Sky.GUIDES) do
    local parts = guides[g]
    for _, t in ipairs(parts.cells) do
      t:SetSize(u, u)
      t:ClearAllPoints()
      t:SetPoint("TOPLEFT", frame, "TOPLEFT", (xy[1] + t.cell[1]) * u, -(xy[2] + t.cell[2]) * u)
    end
    parts.halo:SetSize(7 * u, 7 * u)
    parts.flares[1]:SetSize(12 * u, 0.9 * u)
    parts.flares[2]:SetSize(0.9 * u, 12 * u)
    for _, t in ipairs({ parts.halo, parts.flares[1], parts.flares[2] }) do
      t:ClearAllPoints()
      t:SetPoint("CENTER", frame, "TOPLEFT", (xy[1] + 1.5) * u, -(xy[2] + 1.5) * u)
    end
  end
  Sky.Animate(0)
end

-- The moving parts at time t (seconds): the mist drifts round, the wisp breathes and bobs with its motes circling,
-- the lit stars' halos twinkle. Every halo stays smaller than the gap to the next star, and the cores are on top.
function Sky.Animate(t)
  local u = frame and frame.u
  if not u then return end
  local function at(tex, x, y)   -- centre at (x, y) units from the sky's centre, y down
    tex:ClearAllPoints()
    tex:SetPoint("CENTER", frame, "CENTER", x * u, -y * u)
  end
  for i, c in ipairs(clouds) do
    local s = seeds[i]
    local a = s.a + t * 0.06 * s.dir
    c:SetSize(s.size * u * 2, s.size * u * 1.5)
    at(c, s.r * math.cos(a), s.r * math.sin(a))
  end
  local bob, breathe = math.sin(t * 1.6) * 0.4, 1 + 0.08 * math.sin(t * 2.3)
  for i, size in ipairs({ 12, 6.5, 2.8 }) do
    wisp[i]:SetSize(size * u * breathe, size * u * breathe)
    at(wisp[i], 0, bob)
  end
  for i, m in ipairs(motes) do
    local a, orbit = t * (0.8 + 0.15 * i) + i * 1.57, 3.2 + 0.6 * i
    m:SetSize(1.4 * u, 1.4 * u)
    at(m, orbit * math.cos(a), bob + orbit * 0.7 * math.sin(a))
  end
  for s in pairs(lit) do
    local h, xy = halos[s], Sky.SLOTS[s]
    local tw = 0.5 + 0.5 * math.sin(t * h.speed + h.phase)
    -- At most 3.8 units across: the glow (which fades out evenly to its edge) is all but gone at the next core.
    local size = (2.2 + 0.8 * h.size + 0.8 * tw) * u
    h:SetSize(size, size)
    h:SetAlpha(0.4 + 0.5 * tw)
    at(h, xy[1] / 100 + 0.5 - U / 2, xy[2] / 100 + 0.5 - U / 2)
  end
  for g, parts in ipairs(guides) do
    local tw = 0.5 + 0.5 * math.sin(t * 1.7 + g * 2)
    parts.flares[1]:SetAlpha(0.55 + 0.35 * tw)
    parts.flares[2]:SetAlpha(0.55 + 0.35 * tw)
  end
end

-- Paint these 45 bytes (Strip.Payload) into the stars, and put the sky where it goes now.
function Sky.Paint(bytes)
  if not frame then create() end
  local left, top, unit, px = Sky.Place()
  if not left then return false end
  layout(left, top, unit, px)
  for s, bit in ipairs(Sky.Bits(bytes)) do
    if shown[s] ~= bit then
      shown[s] = bit
      if bit == 1 then
        cores[s]:Show(); halos[s]:Show(); lit[s] = true
      else
        cores[s]:Hide(); halos[s]:Hide(); lit[s] = nil
      end
    end
  end
  frame:Show()
  return true
end

function Sky.Hide()
  if frame then frame:Hide() end
end

-- Out of the player's own screenshots, like the block (Strip.lua's SCREENSHOT_ events).
function Sky.SetHidden(hidden)
  if frame then frame:SetAlpha(hidden and 0 or 1) end
end

-- The screen or the interface changed size: lay out again at the next paint.
function Sky.Relayout() placed = nil end
