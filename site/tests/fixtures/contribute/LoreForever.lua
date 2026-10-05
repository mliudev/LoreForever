
LoreForeverDB = {
	["settings"] = {
		["zoneNudge"] = true,
		["capture"] = true,
		["panelScale"] = 1.15,
		["minimapAngle"] = 203.4567,
		["voiceOrder"] = {
			"auto", -- [1]
			"LoreForever_Voice_Female", -- [2]
		},
		["voiceOff"] = {
		},
	},
	["sessions"] = 42,
	["questions"] = {
		{
			["t"] = 1790000000,
			["q"] = "who is \"Hogger\"?",
			["via"] = "typed",
			["ctx"] = {
				["zone"] = "Elwynn Forest",
				["quests"] = {
					{
						["id"] = 176,
						["title"] = "Wanted: \"Hogger\"",
					}, -- [1]
				},
				["level"] = 9,
			},
			["results"] = {
				{
					["key"] = "npc:hogger",
					["score"] = 41.5,
				}, -- [1]
			},
		}, -- [1]
	},
	["quests"] = {
		[99001] = {
			["id"] = 99001,
			["title"] = "The Stormcrow's Debt",
			["text"] = "You've come a long way, $N. The crows of Zephras remember every slight.\n\nBring me 6 Stormcrow Feathers and we'll call it even.",
			["objectives"] = "Bring 6 Stormcrow Feathers to Warden Halvar.",
			["progress"] = "The crows still circle, $C. Do you have them?",
			["completion"] = "Fine work. Even a $R like you can earn the isle's respect.",
			["zone"] = "Zephras Isle",
			["known"] = false,
			["starter"] = {
				["kind"] = "npc",
				["id"] = 197001,
				["name"] = "Warden Halvar",
				["sex"] = 2,
				["ctype"] = "Humanoid",
				["model"] = 1011653,
				["race"] = "Human",
				["gender"] = "male",
			},
			["ender"] = {
				["kind"] = "npc",
				["id"] = 197001,
				["name"] = "Warden Halvar",
				["sex"] = 2,
				["ctype"] = "Humanoid",
			},
		},
		[99002] = {
			["id"] = 99002,
			["title"] = "Wanted: Grimtusk",
			["text"] = "Aelric, read the poster: <name> should not hunt Grimtusk alone.",
			["starter"] = {
				["kind"] = "object",
				["id"] = 300077,
				["name"] = "Wanted Poster",
			},
		},
		[176] = {
			["id"] = 176,
			["title"] = "Wanted: \"Hogger\"",
			["text"] = "A huge gnoll grows more bold by the day.",
			["known"] = true,
		},
	},
	["texts"] = {
		["gossip"] = {
			["Marshal McBride"] = {
				["1a2b3c4d"] = "Hey $N, the Defias are trouble.\n\nKeep your blade sharp.",
				["5e6f7a8b"] = "Northshire is quiet today.",
			},
			["Old Sailor"] = {
				["0badf00d"] = "Thalia? Never heard of 'er.",
			},
		},
		["npcs"] = {
			["Marshal McBride"] = {
				["id"] = 197,
				["sex"] = 2,
				["ctype"] = "Humanoid",
			},
		},
		["books"] = {
			["The Battle of Grim Batol"] = {
				"For $N: page one\\two.", -- [1]
				"Page two \226\128\148 with a dash.", -- [2]
			},
			["Plaque (Elwynn Forest)"] = {
				[1] = "In memory of the fallen of Goldshire.",
			},
		},
		["say"] = {
			[197001] = {
				["c0ffee00"] = {
					["text"] = "The storm comes for us all!",
					["kind"] = "yell",
					["name"] = "Warden Halvar",
					["sex"] = 2,
					["ctype"] = "Humanoid",
					["t"] = 1790000123,
				},
				["c0ffee01"] = {
					["text"] = "Thank you, $N.",
					["kind"] = "say",
					["name"] = "Warden Halvar",
					["t"] = 1790000200,
				},
			},
		},
	},
	["capture"] = {
		["v"] = 1,
		["build"] = "1.60.1.70205",
		["locale"] = "enUS",
		["version"] = "0.8.0",
		["install"] = "a1b2c3d4e5f60718",
		["missing"] = {
			["quest:99001"] = true,
			["quest:99002"] = true,
			["gossip:Marshal McBride"] = true,
		},
		["by"] = {
			["quest:99001#detail"] = "Human.WARRIOR.3",
			["quest:99001#progress"] = "Human.WARRIOR.3",
			["gossip:Marshal McBride#1a2b3c4d"] = "NightElf.DRUID.2",
		},
		["sent"] = {
			["quest:176#detail"] = true,
			["quest:176#title"] = true,
			["book:Plaque (Elwynn Forest)#1"] = true,
		},
		["copied"] = {
		},
	},
	["journey"] = {
		["v"] = 2,
		["chars"] = {
			["Aelric-Forever"] = {
				["name"] = "Aelric",
				["realm"] = "Forever",
				["level"] = 14,
				["events"] = {
					{
						["k"] = "login",
						["t"] = 1790000000,
						["lv"] = 14,
					}, -- [1]
				},
			},
		},
	},
	["maps"] = {
		[1429] = {
			["zone"] = "Elwynn Forest",
			["subzones"] = {
				["Northshire Valley"] = true,
			},
		},
	},
	["visits"] = {
		["Elwynn Forest"] = {
			["n"] = 3,
			["first"] = 1790000000,
			["last"] = 1790003600,
			["minLevel"] = 1,
			["maxLevel"] = 9,
			["lore"] = true,
		},
	},
	["heard"] = nil,
	["neg"] = -12.5e-1,
	["hex"] = 0x1F,
}
