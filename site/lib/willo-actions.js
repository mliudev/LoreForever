// Generated from willo-actions.json by scripts/rebuild-generated.sh (scripts/willo_actions_js.py): edit the
// .json and rebuild. A module, since Cloudflare Pages' bundler can't import JSON.
export default {
  "about": [
    "Willo's actions: the one list of what her answers may do for the player in her apps, and how each is confirmed (LOR-844 step 6).",
    "The site reads it here (lib/willo-tools.js); the PC app reads its copy, companion/lore_companion/actions.json, which scripts/rebuild-generated.sh writes and scripts/check.sh keeps current.",
    "side: site is a tool the site does itself (a message to a friend): no app lists or runs it, and its tier is how the site confirms it.",
    "Contract: an app lists the actions it can run in X-LF-Capabilities, space-separated. The token actions/1 says the list is complete; then a flat tool is listed by its id (set_voice) and a grouped tool's operation as tool.op (talk.off). An app without actions/1 (a PC older than this) gets only the legacy tools, as before. The iPhone sends actions/1 alone.",
    "An action goes to the app as {id, args, label, now?}: a grouped tool's operation is args.op. now: true means the player plainly asked for it, so it runs at once; the app honors it only for the tiers whose now is true here, and treats anything else as an offer.",
    "args: {list} is one of lists below, or a list the asking app's state gives: voices (the plan's voices), talk_keys (the keys she hears, lib/willo-tools.js TALK_KEYS) and chats (the titles of their past chats, in the PC's state lines); {text: n} is the player's words, at most n letters (optional: the site fills it in when the model gives none); {site: …} the site fills in after her call, never the model (memories: the ids of the memories her words name; character: the asking character's Name-Realm). The app checks every argument again.",
    "needs: an operation that only makes sense in a moment the asking app's state shows (reminder_showing: its \"reminder showing now\" line; update_ready: its version line says one is ready; player: the Lore Player is playing or paused) is declared only then.",
    "Nothing here acts inside WoW, and money is never by voice."
  ],
  "tiers": {
    "show": {
      "now": true,
      "voice": true,
      "undo": false,
      "what": "opens or shows something in her window and changes nothing"
    },
    "do": {
      "now": true,
      "voice": true,
      "undo": false,
      "what": "harmless and done at once, with nothing to undo: say it again, look again, check for an update, snooze a reminder"
    },
    "undo": {
      "now": true,
      "voice": true,
      "undo": true,
      "what": "a change that can be put back: runs at once when asked plainly, else a tap or a spoken yes; always with Undo"
    },
    "yes": {
      "now": false,
      "voice": true,
      "undo": false,
      "what": "read back to the player first, then a tap or a spoken yes (an action's own undo: true gives it Undo after)"
    },
    "send": {
      "now": false,
      "voice": false,
      "undo": false,
      "what": "fills in a note the player sends themselves"
    },
    "preview": {
      "now": false,
      "voice": true,
      "undo": true,
      "what": "a screenshot shown to the player first; Send or a yes after it is shown, Undo while unread"
    },
    "consent": {
      "now": false,
      "voice": false,
      "undo": true,
      "what": "shows the same explanation as its Settings card; only the player's click on Turn on under it turns it on"
    },
    "money": {
      "now": false,
      "voice": false,
      "undo": false,
      "what": "a tap in her window only: opens the page, never buys, never shown over the game"
    }
  },
  "lists": {
    "remark_levels": {
      "often": 2,
      "sometimes": 5,
      "rarely": 10,
      "off": 0
    },
    "wisp_sizes": [
      "small",
      "normal",
      "large"
    ],
    "colors": [
      "willo",
      "warlock",
      "druid",
      "hunter",
      "mage",
      "paladin",
      "priest",
      "rogue",
      "shaman",
      "warrior",
      "fel",
      "holy",
      "shadow",
      "frost"
    ],
    "engines": {
      "hosted": "auto",
      "local": "kokoro",
      "captions": "text"
    },
    "chords": [
      "ctrl+alt+w",
      "ctrl+alt+j",
      "ctrl+alt+k",
      "ctrl+alt+h"
    ],
    "volume_levels": [
      "quieter",
      "louder",
      "25",
      "50",
      "75",
      "100"
    ],
    "sections": {
      "health": {
        "card": "talk-field",
        "label": "Show what's working"
      },
      "talk": {
        "card": "talk-field",
        "label": "Show the talk key"
      },
      "voice": {
        "card": "voice-field",
        "label": "Show my voices"
      },
      "wisp": {
        "card": "nano-field",
        "label": "Show my settings over the game"
      },
      "sight": {
        "card": "sight-field",
        "label": "Show Seeing the game"
      },
      "live": {
        "card": "live-game-field",
        "label": "How to turn it on in the game"
      },
      "color": {
        "card": "color-field",
        "label": "Show my colors"
      },
      "settings": {
        "card": "willo-settings-title",
        "label": "Open my Settings"
      },
      "target_key": {
        "card": "talk-target",
        "label": "Choose a key"
      },
      "remarks": {
        "card": "remarks-field",
        "label": "Show how often I chime in"
      },
      "ears": {
        "card": "ears-field",
        "label": "Show how I hear you"
      },
      "outside_game": {
        "card": "outside-game-row",
        "label": "Show talking outside the game"
      },
      "ways": {
        "card": "ways-field",
        "label": "Show my ways"
      },
      "account": {
        "card": "account-title",
        "label": "Open Account"
      },
      "privacy": {
        "card": "privacy-title",
        "label": "Open Privacy"
      },
      "game_files": {
        "card": "game-title",
        "label": "Open Game and files"
      },
      "updates": {
        "card": "updates-field",
        "label": "Show updates"
      },
      "help": {
        "card": "help-title",
        "label": "Open Help"
      }
    }
  },
  "tools": {
    "open_settings": {
      "legacy": true,
      "tier": "show",
      "args": {
        "section": {
          "list": "sections"
        }
      },
      "what": "opens a card in her Settings"
    },
    "open_plans": {
      "legacy": true,
      "tier": "money",
      "window_only": true,
      "what": "opens the Plans page in the browser, signed in; never buys"
    },
    "open_billing": {
      "legacy": true,
      "tier": "money",
      "window_only": true,
      "what": "opens Billing in the browser, signed in"
    },
    "open_keeps": {
      "legacy": true,
      "tier": "show",
      "window_only": true,
      "what": "opens What Willo keeps in the browser, signed in: everything she keeps, to change or erase"
    },
    "message_friend": {
      "tier": "yes",
      "side": "site",
      "what": "a message to one of their friends, in their words, read back before their yes (done on the site: lib/friend-send.js)"
    },
    "send_feedback": {
      "legacy": true,
      "tier": "send",
      "args": {
        "note": {
          "text": 300
        }
      },
      "what": "fills in \"Something's wrong\" with a note; the player presses Send"
    },
    "set_voice": {
      "legacy": true,
      "tier": "undo",
      "args": {
        "voice": {
          "list": "voices"
        }
      },
      "what": "switches her voice to one the player's plan has; \"switch back\" or \"the other one\" is the voice your state names as voice before"
    },
    "new_chat": {
      "legacy": true,
      "tier": "undo",
      "what": "starts a new chat; the old one stays in the list, and Undo reopens it"
    },
    "set_talk_key": {
      "legacy": true,
      "tier": "yes",
      "undo": true,
      "args": {
        "key": {
          "list": "talk_keys"
        }
      },
      "what": "sets her talk key to one she can hear; then /reload in the game"
    },
    "capture_game_to_friend": {
      "legacy": true,
      "tier": "preview",
      "what": "prepares a local game screenshot for a named friend; the player reviews it and chooses Send before upload"
    },
    "live_game_info": {
      "legacy": true,
      "tier": "consent",
      "what": "Live game info, turned on by the player's click under its explanation"
    },
    "see_the_game": {
      "legacy": true,
      "tier": "consent",
      "what": "seeing the game when they ask (Hero and up), turned on by the player's click under its explanation"
    },
    "talk": {
      "what": "how you talk and listen in your own app. Never the game's keybinds, chat or voice chat",
      "ops": {
        "on": {
          "tier": "yes",
          "label": "Turn talking on",
          "what": "turn talking with you on (it uses the microphone while the talk key is held)"
        },
        "off": {
          "tier": "undo",
          "label": "Turn talking off",
          "what": "turn talking with you off: no listening, and you answer in writing"
        },
        "key": {
          "tier": "yes",
          "undo": true,
          "args": {
            "key": {
              "list": "talk_keys"
            }
          },
          "label": "Use {key}",
          "what": "move your talk key, the key they hold to talk to you; never a key for a spell, an item or the game (then /reload in the game)"
        },
        "voice": {
          "tier": "undo",
          "args": {
            "voice": {
              "list": "voices"
            }
          },
          "label": "Switch to {voice}",
          "what": "switch your voice to another of their plan's voices: yours, or one of Azeroth's peoples (dwarf-male)"
        },
        "engine": {
          "tier": "undo",
          "args": {
            "engine": {
              "list": "engines"
            }
          },
          "label": "Speak with {engine}",
          "what": "how you speak: hosted (your full voice), local (the voice on their computer) or captions (words only, never out loud); never a voice by its name"
        },
        "again": {
          "tier": "do",
          "label": "Say it again",
          "what": "say your last answer again"
        }
      }
    },
    "remarks": {
      "what": "only when they talk about you: how often you chime in on your own while they play, and the little sound you make when you do (your chirps). Never the game's sounds, music or chat, the Lore Player's story, birds or anyone else",
      "ops": {
        "level": {
          "tier": "undo",
          "args": {
            "level": {
              "list": "remark_levels"
            }
          },
          "label": "Remarks: {level}",
          "what": "how often you chime in on your own: often, sometimes, rarely or off"
        },
        "chirps_on": {
          "tier": "undo",
          "label": "Turn chirps on",
          "what": "your chirps on"
        },
        "chirps_off": {
          "tier": "undo",
          "label": "Turn chirps off",
          "what": "your chirps off"
        }
      }
    },
    "look": {
      "what": "your own color and your wisp over the game. Never the game's interface",
      "ops": {
        "color": {
          "tier": "undo",
          "args": {
            "color": {
              "list": "colors",
              "or": "hex"
            }
          },
          "label": "Make me {color}",
          "what": "your color: a swatch, or any color as #rrggbb"
        },
        "wisp_show": {
          "tier": "undo",
          "label": "Show the wisp",
          "what": "show your wisp over the game"
        },
        "wisp_hide": {
          "tier": "undo",
          "label": "Hide the wisp",
          "what": "hide your wisp over the game"
        },
        "size": {
          "tier": "undo",
          "args": {
            "size": {
              "list": "wisp_sizes"
            }
          },
          "label": "Make the wisp {size}",
          "what": "your wisp's size"
        },
        "show": {
          "tier": "do",
          "label": "Show me",
          "what": "bring your wisp up now, only when they can't find you or ask you to come out"
        },
        "home": {
          "tier": "do",
          "label": "Put me back",
          "what": "put your wisp back in its usual place"
        }
      }
    },
    "target": {
      "what": "your keys for talking to the one they target, and to you outside the game. Never the game's keybinds",
      "ops": {
        "key": {
          "tier": "yes",
          "undo": true,
          "args": {
            "key": {
              "list": "talk_keys"
            }
          },
          "label": "Use {key} for your target",
          "what": "the key they hold so the one they target answers; never a key for a spell, an item or the game (then /reload in the game)"
        },
        "key_off": {
          "tier": "yes",
          "undo": true,
          "label": "No target key",
          "what": "no key for talking to the one they target"
        },
        "shortcut": {
          "tier": "yes",
          "undo": true,
          "args": {
            "chord": {
              "list": "chords"
            }
          },
          "label": "Use {chord} outside the game",
          "what": "turn on your own shortcut that talks to you outside the game, with that chord; never a keybind for the game"
        },
        "shortcut_off": {
          "tier": "yes",
          "undo": true,
          "label": "Turn the shortcut off",
          "what": "turn your shortcut outside the game off"
        }
      }
    },
    "player": {
      "what": "the Lore Player in your window: only the Lore Forever story your state says is playing or paused. Never the game's music, sounds, songs, quests, cutscenes or travel",
      "ops": {
        "play": {
          "tier": "undo",
          "needs": "player",
          "label": "Play",
          "what": "carry on with the paused story"
        },
        "pause": {
          "tier": "undo",
          "needs": "player",
          "label": "Pause",
          "what": "pause the story"
        },
        "back": {
          "tier": "undo",
          "needs": "player",
          "label": "Back 15 seconds",
          "what": "go back 15 seconds in the story (never going back to a place)"
        },
        "forward": {
          "tier": "undo",
          "needs": "player",
          "label": "Skip 15 seconds",
          "what": "skip ahead 15 seconds in the story"
        },
        "again": {
          "tier": "undo",
          "needs": "player",
          "label": "From the start",
          "what": "play the story from the start"
        },
        "volume": {
          "tier": "undo",
          "needs": "player",
          "args": {
            "level": {
              "list": "volume_levels"
            }
          },
          "label": "Volume {level}",
          "what": "the story's volume: quieter, louder, or a percent"
        },
        "mute": {
          "tier": "undo",
          "needs": "player",
          "label": "Mute",
          "what": "mute the story"
        },
        "unmute": {
          "tier": "undo",
          "needs": "player",
          "label": "Unmute",
          "what": "unmute the story"
        }
      }
    },
    "chats": {
      "what": "their past chats with you, by the titles your state lists. Never the game's chat, channels, whispers or mail",
      "ops": {
        "list": {
          "tier": "show",
          "label": "Your chats",
          "what": "show the list of their past chats, when they ask to see, list or find their chats (name the newest few from your state as you do)"
        },
        "open": {
          "tier": "undo",
          "args": {
            "chat": {
              "list": "chats"
            }
          },
          "label": "Open {chat}",
          "what": "open one of their past chats, by its title"
        },
        "rename": {
          "tier": "undo",
          "args": {
            "chat": {
              "list": "chats"
            },
            "title": {
              "text": 120
            }
          },
          "label": "Rename to {title}",
          "what": "rename a past chat"
        },
        "delete": {
          "tier": "yes",
          "args": {
            "chat": {
              "list": "chats"
            }
          },
          "label": "Delete {chat}",
          "what": "delete one past chat, after reading its title back"
        }
      }
    },
    "settings": {
      "what": "your own Settings in your app, only when they ask to see or open one of yours. Never the game's options, keybinds, sound, interface or windows",
      "ops": {
        "open": {
          "tier": "show",
          "args": {
            "section": {
              "list": "sections",
              "default": "settings"
            }
          },
          "label": "{section}",
          "what": "open a card or group in your Settings"
        }
      }
    },
    "health": {
      "what": "whether you and the game work together",
      "ops": {
        "rescan": {
          "tier": "do",
          "label": "Look again",
          "what": "look at the game's files again now (after they changed something in the game)"
        }
      }
    },
    "updates": {
      "what": "your updates",
      "ops": {
        "check": {
          "tier": "do",
          "label": "Check for an update",
          "what": "check for a newer version of you now"
        },
        "restart": {
          "tier": "yes",
          "needs": "update_ready",
          "label": "Restart to update",
          "what": "restart you to finish an update that's ready"
        }
      }
    },
    "reminder": {
      "what": "the reminder you're showing",
      "ops": {
        "snooze": {
          "tier": "do",
          "needs": "reminder_showing",
          "label": "Snooze 1 hour",
          "what": "remind them again in an hour about the reminder you're showing"
        }
      }
    },
    "memory": {
      "what": "what you keep in mind about the player themselves, only when they plainly ask: who they are, what to call them, how and when they play, who they play with, what they like. Never a to-do, a reminder, a goal or a place (their notebook's), a fact about the world, or something they only mention. Say it as a friend would (\"I'll keep that in mind.\", \"I've let that go.\"), never memory, saved, stored or data",
      "ops": {
        "remember": {
          "tier": "undo",
          "args": {
            "text": {
              "text": 160
            },
            "character": {
              "site": "character"
            }
          },
          "label": "Remember: {text}",
          "what": "keep in mind one lasting thing they ask you to remember about themselves (text: in their own words, as they'd say it of themselves, without \"remember that\")"
        },
        "forget": {
          "tier": "undo",
          "args": {
            "text": {
              "text": 160,
              "optional": true
            },
            "ids": {
              "site": "memories"
            }
          },
          "label": "Forget: {text}",
          "what": "let go of something they told you about themselves, when they ask you to forget it (text: their words for it)"
        },
        "forget_all": {
          "tier": "yes",
          "undo": true,
          "label": "Forget everything",
          "what": "let go of everything you keep in mind about them, read back first"
        },
        "list": {
          "tier": "show",
          "label": "What I remember",
          "what": "show what you keep in mind about them, when they ask what you remember or know about them"
        }
      }
    }
  }
};
