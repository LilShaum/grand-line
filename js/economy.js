(function (root) {
  "use strict";

  var STATS = {
    strength: { name: "Strength",  area: "Body",   haki: "Armament Haki",     crew: "The Dojo",    accent: "--wanted-red",  desc: "Workouts, sport, sleep, eating well — anything that builds your body." },
    wisdom:   { name: "Wisdom",    area: "Mind",   haki: "Observation Haki",  crew: "The Library", accent: "--sea-teal",    desc: "Reading, studying, learning, deep work — anything that sharpens your mind." },
    ambition: { name: "Ambition",  area: "Work",   haki: "Conqueror's Haki",  crew: "The Helm",    accent: "--bounty-gold", desc: "Career, projects, goals, side-hustles — the work that builds your future." },
    resolve:  { name: "Resolve",   area: "Chores", haki: "Inherited Will",    crew: "The Deck",    accent: "--steel",       desc: "Errands, cleaning, admin — the boring-but-necessary that takes grit." }
  };
  var STAT_KEYS = ["strength", "wisdom", "ambition", "resolve"];

  // bounty = notoriety added to your wanted poster (reputation track).
  var TIERS = {
    petty:     { label: "Petty Crime",     xp: 10,  berries: 10,  bounty: 40   },
    rookie:    { label: "Rookie Bounty",   xp: 25,  berries: 25,  bounty: 100  },
    notorious: { label: "Notorious Bounty",xp: 50,  berries: 50,  bounty: 220  },
    warlord:   { label: "Warlord Bounty",  xp: 100, berries: 100, bounty: 500  }
  };
  var TIER_KEYS = ["petty", "rookie", "notorious", "warlord"];

  var XP_BASE = 100;
  function xpToNext(level) { return XP_BASE * level; }
  function cumulativeXpForLevel(level) { return (XP_BASE / 2) * level * (level - 1); }
  function levelFromXp(totalXp) {
    var level = 1;
    while (totalXp >= cumulativeXpForLevel(level + 1)) level++;
    var base = cumulativeXpForLevel(level);
    var need = xpToNext(level);
    var into = totalXp - base;
    var pct = need > 0 ? Math.min(100, Math.round((into / need) * 100)) : 0;
    return { level: level, into: into, need: need, pct: pct };
  }

  var RANKS = [
    { title: "East Blue Pirate",    min: 0,      vibe: "Every legend starts in a small sea." },
    { title: "Notorious Pirate",    min: 10000,  vibe: "The Marines have a file on your name now." },
    { title: "Warlord of the Sea",  min: 45000,  vibe: "The World Government offers you a Warlord's seat." },
    { title: "Yonko",               min: 130000, vibe: "One of the four Emperors who rule the New World." },
    { title: "King of the Pirates", min: 200000, vibe: "You found the One Piece. The seas are yours." }
  ];
  function rankForBounty(bounty) {
    var current = RANKS[0], next = null;
    for (var i = 0; i < RANKS.length; i++) {
      if (bounty >= RANKS[i].min) { current = RANKS[i]; next = RANKS[i + 1] || null; }
    }
    var pct = 100;
    if (next) {
      var span = next.min - current.min;
      pct = span > 0 ? Math.min(100, Math.round(((bounty - current.min) / span) * 100)) : 100;
    }
    return { current: current, next: next, pct: pct };
  }

  var JOURNAL = {
    captains_log:       { berries: 15, xp: 10, bounty: 50,  stat: "resolve",  grants: "morale" },
    morning_intent:     { berries: 10, xp: 8,  bounty: 40,  stat: "ambition", grants: null },
    evening_reflection: { berries: 12, xp: 10, bounty: 50,  stat: "wisdom",   grants: "morale" },
    free_write:         { berries: 5,  xp: 5,  bounty: 25,  stat: "resolve",  grants: null },
    memory:       { berries: 5,  xp: 0,  bounty: 10, stat: null,       grants: null },
    mood:         { berries: 3,  xp: 0,  bounty: 5,  stat: null,       grants: null },
    victory:      { berries: 5,  xp: 0,  bounty: 15, stat: null,       grants: null },
    recap:        { berries: 100,xp: 50, bounty: 300,stat: "resolve",  grants: "tailwind" }
  };

  var MORNING_PROMPTS = [
    "What's your mission today, Captain?",
    "Which bounties will you hunt today?",
    "What's the one thing that must get done?",
    "Where do you point the Log Pose today?",
    "What would make today a victory?",
    "What's the first move when you set sail?"
  ];
  var EVENING_PROMPTS = [
    "What did your crew accomplish today?",
    "What was today's biggest haul?",
    "What slowed the ship down today?",
    "What are you grateful for after today's voyage?",
    "What will you do differently tomorrow?",
    "Where did you show real Haki today?"
  ];
  function _doy(dateStr) {
    var d = dateStr ? new Date(dateStr + "T00:00:00") : new Date();
    var start = new Date(d.getFullYear(), 0, 0);
    return Math.floor((d - start) / 86400000);
  }
  function morningPrompt(dateStr) { return MORNING_PROMPTS[_doy(dateStr) % MORNING_PROMPTS.length]; }
  function eveningPrompt(dateStr) { return EVENING_PROMPTS[_doy(dateStr) % EVENING_PROMPTS.length]; }

  var DISPATCH_EVENTS = [
    { id: "raid",     title: "Pirate Raid",     objective: "Clear any 3 bounties today",           reward: "xp_surge",    need: 3, match: { kind: "bounty" } },
    { id: "fortress", title: "Marine Fortress",  objective: "Clear a Notorious or Warlord bounty",  reward: "xp_surge",    need: 1, match: { kind: "bounty", minTier: "notorious" } },
    { id: "report",   title: "Evening Report",   objective: "Log an evening reflection",            reward: "haki_focus",  need: 1, match: { kind: "journal", jtype: "evening_reflection" } },
    { id: "orders",   title: "Morning Orders",   objective: "Set your morning intent",              reward: "haki_focus",  need: 1, match: { kind: "journal", jtype: "morning_intent" } },
    { id: "logbook",  title: "Open Waters",      objective: "Write a free-log entry",               reward: "log_insight", need: 1, match: { kind: "journal", jtype: "free_write" } },
    { id: "swab",     title: "Swab the Decks",   objective: "Complete 2 ship duties",               reward: "log_insight", need: 2, match: { kind: "duty" } }
  ];
  function dispatchForDay(dateStr) { return DISPATCH_EVENTS[_doy(dateStr) % DISPATCH_EVENTS.length]; }

  var BUFFS = {
    streakPerTier:  0.05,
    streakTierDays: 7,
    streakCap:      0.25,
    setSail:        10,
    dailyBounty:    50,
    morale:         0.10,
    tailwind:       0.15,
    tailwindDays:   3,
    recapCooldownDays: 7,
    hakiOverflowBerries: 200
  };

  var DEFAULT_HABITS = [
    { title: "Drink water",      stat: "resolve",  tier: "petty",  health: true },
    { title: "Move your body",   stat: "strength", tier: "rookie", health: true },
    { title: "Read 10 minutes",  stat: "wisdom",   tier: "petty" }
  ];

  var DEFAULT_SHOP = [
    { name: "1 episode of anime, guilt-free", cost: 150,   type: "reward" },
    { name: "Order takeout / treat meal",     cost: 400,   type: "reward" },
    { name: "Full movie night",               cost: 600,   type: "reward" },
    { name: "Day-trip / outing",              cost: 2500,  type: "reward" },
    { name: "New indie game",                 cost: 4000,  type: "reward" },
    { name: "New AAA game",                   cost: 20000, type: "reward" }
  ];

  var CREW = [
    { id: "swordsman",     name: "Swordsman",     role: "Crewmate", icon: "swords",    cost: 800,    bonus: "Sharpens your blade — +10% XP from Body (Strength) bounties.",        where: "Passive — always active",         effect: { type: "statXp", stat: "strength", mult: 0.10 } },
    { id: "navigator",     name: "Navigator",     role: "Crewmate", icon: "compass",   cost: 2000,   bonus: "Unlocks the Voyage Map — a 12-week heatmap of your activity. Passive: +10% Wisdom XP.",        where: "Captain's Log",                   effect: { type: "statXp", stat: "wisdom",   mult: 0.10 } },
    { id: "sniper",        name: "Sniper",        role: "Crewmate", icon: "slingshot", cost: 4000,   bonus: "Unlocks Focus Shot — pin one bounty as your target for +25% reward. Passive: +10% Ambition XP.", where: "Bounty Board",                    effect: { type: "statXp", stat: "ambition", mult: 0.10 } },
    { id: "cook",          name: "Cook",          role: "Crewmate", icon: "flame",     cost: 7000,  bonus: "Runs the galley — health-tagged missions pay +50% Berries, and all missions pay +10% Berries.",         where: "Bounty Board",                    effect: { type: "berry", mult: 0.10 } },
    { id: "doctor",        name: "Doctor",        role: "Crewmate", icon: "cross",     cost: 10000,  bonus: "Unlocks the Wellness card — track health habits; they grant Strength XP. Passive: +15% journal XP.", where: "Ship Duties",                effect: { type: "journalXp", value: 0.15 } },
    { id: "archaeologist", name: "Archaeologist", role: "Crewmate", icon: "book",      cost: 18000, bonus: "Unlocks Poneglyph of the Day — a canon One Piece fact each day. Passive: +15% Wisdom XP.",     where: "Captain's Log",                   effect: { type: "statXp", stat: "wisdom",   mult: 0.15 } },
    { id: "shipwright",    name: "Shipwright",    role: "Crewmate", icon: "wrench",    cost: 14000, bonus: "Unlocks the Ship's Logbook (weekly recap) + 10% off all themes. Passive: +10% Resolve XP.",    where: "Captain's Log & the Hold",        effect: { type: "statXp", stat: "resolve",  mult: 0.10 } },
    { id: "musician",      name: "Musician",      role: "Crewmate", icon: "note",      cost: 14000, bonus: "Unlocks sea ambient audio — gentle background sound while you work. Passive: +15% Berries.", where: "The Helm (settings)",             effect: { type: "berry", mult: 0.15 } },
    { id: "helmsman",      name: "Helmsman",      role: "Crewmate", icon: "wheel",     cost: 27000, bonus: "Steadies the ship — raises your streak XP cap by +15%.",             where: "Passive — always active",         effect: { type: "streakCap", value: 0.15 } }
  ];

  var PROMPTS = [
    "What's one win from today, however small?",
    "What drained you today — and why?",
    "What are you grateful for right now?",
    "What's one thing you'd do differently?",
    "Who or what made today better?",
    "What are you avoiding — and what's the next tiny step?",
    "How did your body feel today?",
    "What did you learn today?",
    "What's on your mind heading into tomorrow?",
    "When did you feel most like yourself today?",
    "What's a small thing that went right?",
    "What would make tomorrow a good day?"
  ];
  function promptForDay(dateStr) {
    var d = dateStr ? new Date(dateStr + "T00:00:00") : new Date();
    var start = new Date(d.getFullYear(), 0, 0);
    var doy = Math.floor((d - start) / 86400000);
    return PROMPTS[doy % PROMPTS.length];
  }

  var LORE = [
    "The Grand Line is bordered on both sides by the Calm Belts, waters teeming with giant Sea Kings.",
    "A Log Pose navigates the Grand Line by locking onto an island's magnetic field.",
    "Devil Fruit users gain a power but lose the ability to swim — the sea drains their strength.",
    "There are three forms of Haki: Armament, Observation, and Conqueror's.",
    "Conqueror's Haki is said to appear in only one in several million people.",
    "The Red Line is a vast continent that wraps around the entire world.",
    "Poneglyphs are indestructible stones carved in an ancient language the World Government forbids.",
    "The Four Emperors are the pirates who reign over the New World.",
    "The Straw Hats' ship, the Thousand Sunny, was built from the treasured Adam Wood.",
    "A bounty is set by the World Government to reflect how great a threat a pirate poses.",
    "The Reverie is a council held every four years where kings from member nations gather.",
    "Fish-Man Island lies 10,000 meters beneath the sea, at the halfway point of the Grand Line.",
    "Gol D. Roger's final words at his execution sparked the Great Age of Pirates.",
    "The Marines enforce the will of the World Government across all the seas.",
    "A Devil Fruit's power returns to the world in a new fruit when its user dies."
  ];
  function loreForDay(dateStr) {
    var d = dateStr ? new Date(dateStr + "T00:00:00") : new Date();
    var start = new Date(d.getFullYear(), 0, 0);
    var doy = Math.floor((d - start) / 86400000);
    return LORE[doy % LORE.length];
  }

  // 64 = exactly two full trees (32 each), reachable by a committed player at
  // roughly the one-year mark. Level-ups past this convert to Berries
  // (BUFFS.hakiOverflowBerries) so progression never dead-ends.
  var HAKI_LIFETIME_CAP = 64;
  var HAKI_TREE_META = {
    wisdom:   { title: "Observation Haki", blurb: "Awareness. See rewards before you strike, guard your streaks, read the sea ahead." },
    strength: { title: "Armament Haki",    blurb: "Raw power. Floors, multipliers and combos — every clear hits harder." },
    ambition: { title: "Conqueror's Haki", blurb: "Prestige. Decrees, notoriety and weekly conquest — climb the title ladder faster." },
    resolve:  { title: "Inherited Will",   blurb: "Reflection. The pen feeds the sword — journaling pays berries, XP and bounty." }
  };
  var HAKI_TREE = {
    wisdom: [
      { id: "o_root", stat: "wisdom", pos: "root", req: [],         cost: 2, icon: "ti-eye",     name: "Observation Haki", desc: "See a bounty's exact XP & \u0E3F reward before you commit.", effect: { type: "preview" } },
      { id: "o_a1",   stat: "wisdom", pos: "a1",   req: ["o_root"], cost: 3, icon: "ti-history", name: "Future Sight",     desc: "A warning appears when your streak would break tonight.",  effect: { type: "streakWarn" } },
      { id: "o_a2",   stat: "wisdom", pos: "a2",   req: ["o_a1"],   cost: 4, icon: "ti-compass", name: "Kenbunshoku",      desc: "Your wanted poster projects days to your next Title.",     effect: { type: "forecast" } },
      { id: "o_a3",   stat: "wisdom", pos: "a3",   req: ["o_a2"],   cost: 5, icon: "ti-repeat",  name: "Second Sight",     desc: "Once a week, a missed day won't break your streak.",       effect: { type: "streakInsure" } },
      { id: "o_b1",   stat: "wisdom", pos: "b1",   req: ["o_root"], cost: 3, icon: "ti-feather", name: "Calm Mind",        desc: "+10% XP from journal entries.",                            effect: { type: "journalXp", value: 0.10 } },
      { id: "o_b2",   stat: "wisdom", pos: "b2",   req: ["o_b1"],   cost: 4, icon: "ti-map-2",   name: "Read the Sea",     desc: "Raise your streak XP bonus cap by +10%.",                  effect: { type: "streakCap", value: 0.10 } },
      { id: "o_b3",   stat: "wisdom", pos: "b3",   req: ["o_b2"],   cost: 5, icon: "ti-sun",     name: "Flow State",       desc: "Raise the streak cap by another +15%.",                    effect: { type: "streakCap", value: 0.15 } },
      { id: "o_cap",  stat: "wisdom", pos: "cap",  req: ["o_a3", "o_b3"], cost: 6, icon: "ti-diamond", name: "All-Seeing Eye", desc: "Streak bonuses tier up every 5 days instead of 7.",     effect: { type: "streakTier", value: 5 } }
    ],
    strength: [
      { id: "a_root", stat: "strength", pos: "root", req: [],         cost: 2, icon: "ti-shield-half", name: "Armament Haki", desc: "Coat yourself in will — bounties never pay less than 15 XP.", effect: { type: "xpFloor", value: 15 } },
      { id: "a_a1",   stat: "strength", pos: "a1",   req: ["a_root"], cost: 3, icon: "ti-sword",     name: "Hardening",     desc: "Your XP floor hardens to 25.",                             effect: { type: "xpFloor", value: 25 } },
      { id: "a_a2",   stat: "strength", pos: "a2",   req: ["a_a1"],   cost: 4, icon: "ti-anchor",    name: "Iron Body",     desc: "+10% XP on all Strength bounties.",                        effect: { type: "statXp", value: 0.10 } },
      { id: "a_a3",   stat: "strength", pos: "a3",   req: ["a_a2"],   cost: 5, icon: "ti-bolt",      name: "Emission",      desc: "Back-to-back clears in a day pay escalating bonus \u0E3F.", effect: { type: "backToBack", value: 8 } },
      { id: "a_b1",   stat: "strength", pos: "b1",   req: ["a_root"], cost: 3, icon: "ti-crosshair", name: "Heavy Blow",    desc: "+5% XP on every bounty and duty you clear.",               effect: { type: "taskXp", value: 0.05 } },
      { id: "a_b2",   stat: "strength", pos: "b2",   req: ["a_b1"],   cost: 4, icon: "ti-wind",      name: "Ryuo Flow",     desc: "+10% more XP on every bounty and duty.",                   effect: { type: "taskXp", value: 0.10 } },
      { id: "a_b3",   stat: "strength", pos: "b3",   req: ["a_b2"],   cost: 5, icon: "ti-flag",      name: "Color of Arms", desc: "Reputation from a clear never rises less than \u0E3F60.",  effect: { type: "floorBounty", value: 60 } },
      { id: "a_cap",  stat: "strength", pos: "cap",  req: ["a_a3", "a_b3"], cost: 6, icon: "ti-trophy", name: "Supreme Ryuo", desc: "Notorious and Warlord bounties pay +25% XP.",            effect: { type: "tierXp", tiers: ["notorious", "warlord"], value: 0.25 } }
    ],
    ambition: [
      { id: "c_root", stat: "ambition", pos: "root", req: [],         cost: 2, icon: "ti-crown",  name: "Conqueror's Haki", desc: "Once a day, decree a bounty — it pays double rewards.", effect: { type: "decree" } },
      { id: "c_a1",   stat: "ambition", pos: "a1",   req: ["c_root"], cost: 3, icon: "ti-flame",  name: "Intimidation",     desc: "All reputation (bounty) gains +10%.",                      effect: { type: "bountyMult", value: 0.10 } },
      { id: "c_a2",   stat: "ambition", pos: "a2",   req: ["c_a1"],   cost: 4, icon: "ti-award",  name: "Supreme King",     desc: "Clear 15+ bounties in a week for \u0E3F500 + 200 XP.",     effect: { type: "weeklyOutput", threshold: 15, berries: 500, xp: 200 } },
      { id: "c_a3",   stat: "ambition", pos: "a3",   req: ["c_a2"],   cost: 5, icon: "ti-bolt",   name: "Haoshoku",         desc: "Your daily decree pays triple instead of double.",         effect: { type: "decreeBoost" } },
      { id: "c_b1",   stat: "ambition", pos: "b1",   req: ["c_root"], cost: 3, icon: "ti-sun",    name: "Royal Presence",   desc: "Set Sail — your first clear of the day — pays double.", effect: { type: "setSailMult", value: 2 } },
      { id: "c_b2",   stat: "ambition", pos: "b2",   req: ["c_b1"],   cost: 4, icon: "ti-coins",  name: "Overlord's Due",   desc: "Reputation gains another +15%.",                           effect: { type: "bountyMult", value: 0.15 } },
      { id: "c_b3",   stat: "ambition", pos: "b3",   req: ["c_b2"],   cost: 5, icon: "ti-cloud",  name: "Gathering Storm",  desc: "Your daily show-up notoriety is doubled.",                 effect: { type: "dailyBountyMult", value: 2 } },
      { id: "c_cap",  stat: "ambition", pos: "cap",  req: ["c_a3", "c_b3"], cost: 6, icon: "ti-diamond", name: "King's Disposition", desc: "The seas yield: 10+ clears a week pays \u0E3F1,000 + 400 XP.", effect: { type: "weeklyOutput", threshold: 10, berries: 1000, xp: 400 } }
    ],
    resolve: [
      { id: "w_root", stat: "resolve", pos: "root", req: [],         cost: 2, icon: "ti-anchor",      name: "Inherited Will",    desc: "Every journal entry pays +5 \u0E3F.",                  effect: { type: "journalBerry", value: 5 } },
      { id: "w_a1",   stat: "resolve", pos: "a1",   req: ["w_root"], cost: 3, icon: "ti-shield-half", name: "Unbreakable",       desc: "Your first clear after a missed day grants +50% XP.",  effect: { type: "comeback", value: 0.5 } },
      { id: "w_a2",   stat: "resolve", pos: "a2",   req: ["w_a1"],   cost: 4, icon: "ti-history",     name: "Iron Will",         desc: "Raise your streak XP cap by +10%.",                    effect: { type: "streakCap", value: 0.10 } },
      { id: "w_a3",   stat: "resolve", pos: "a3",   req: ["w_a2"],   cost: 5, icon: "ti-book",        name: "Poneglyph Scholar", desc: "+15% XP from journal entries.",                        effect: { type: "journalXp", value: 0.15 } },
      { id: "w_b1",   stat: "resolve", pos: "b1",   req: ["w_root"], cost: 3, icon: "ti-feather",     name: "Sea's Whisper",     desc: "Journal entries pay another +5 \u0E3F.",               effect: { type: "journalBerry", value: 5 } },
      { id: "w_b2",   stat: "resolve", pos: "b2",   req: ["w_b1"],   cost: 4, icon: "ti-sunrise",     name: "Saga of the Dawn",  desc: "The Weekly Voyage Recap pays +50%.",                   effect: { type: "recapMult", value: 1.5 } },
      { id: "w_b3",   stat: "resolve", pos: "b3",   req: ["w_b2"],   cost: 5, icon: "ti-moon",        name: "Dreamer's Resolve", desc: "Journal entries also add \u0E3F3 to your bounty.",     effect: { type: "journalBounty", value: 3 } },
      { id: "w_cap",  stat: "resolve", pos: "cap",  req: ["w_a3", "w_b3"], cost: 6, icon: "ti-skull", name: "Will of D.",        desc: "Morale from journaling is stronger and lasts two days.", effect: { type: "moraleBoost", value: 0.10, days: 1 } }
    ]
  };

  var THEMES = [
    { id: "grandline", name: "Grand Line", desc: "The classic wanted-poster parchment.", cost: 0, cat: "world", vars: {} },
    { id: "marine", name: "Marine HQ", desc: "Justice blues and crisp white.", cost: 1500, cat: "world", vars: { "--parchment": "#eef3f9", "--parchment2": "#dbe6f2", "--parchment3": "#c7d8ea", "--ocean-navy": "#13315c", "--ocean-navy2": "#0d2547", "--bounty-gold": "#3f7fbf", "--bounty-gold2": "#2f63a0", "--wanted-red": "#ab4438", "--ink": "#16243a", "--ink-soft": "#455570", "--paper-line": "#bcd0e6", "--sea-teal": "#257069", "--chrome-text": "#eef3f9" } },
    { id: "mera", name: "Mera Mera no Mi", desc: "Embers and ash — fire fist.", cost: 4000, cat: "fruit", vars: { "--parchment": "#2c1d16", "--parchment2": "#3a2118", "--parchment3": "#48271b", "--ocean-navy": "#190f0b", "--ocean-navy2": "#110a07", "--bounty-gold": "#ff8a3d", "--bounty-gold2": "#e0631f", "--wanted-red": "#e23b2e", "--ink": "#f6e3d0", "--ink-soft": "#cba78d", "--paper-line": "#5a3526", "--sea-teal": "#e0913f", "--den-pink": "#ff9e7a", "--good": "#6fae52", "--chrome-text": "#f6e3d0" } },
    { id: "yami", name: "Yami Yami no Mi", desc: "The void — true dark mode.", cost: 8000, cat: "fruit", vars: { "--parchment": "#1d2131", "--parchment2": "#262b3e", "--parchment3": "#2f3551", "--ocean-navy": "#0c0e16", "--ocean-navy2": "#070810", "--bounty-gold": "#c8a24a", "--bounty-gold2": "#a9852f", "--wanted-red": "#c2533f", "--ink": "#e7e3d4", "--ink-soft": "#9aa0b5", "--paper-line": "#3a4060", "--sea-teal": "#4fb6a8", "--den-pink": "#d98aa6", "--good": "#5cae6e", "--chrome-text": "#e7e3d4" } },
    { id: "gomu", name: "Gomu Gomu no Mi", desc: "Straw-hat reds and sun-warmed rope.", cost: 6000, cat: "fruit", vars: { "--parchment": "#f6ead2", "--parchment2": "#efdcb8", "--parchment3": "#e6cd9e", "--ocean-navy": "#9c2b1f", "--ocean-navy2": "#7c2017", "--bounty-gold": "#e0a32f", "--bounty-gold2": "#976716", "--wanted-red": "#b23326", "--ink": "#3a2417", "--ink-soft": "#7a5a3e", "--paper-line": "#d8c099", "--sea-teal": "#246c66", "--chrome-text": "#f6ead2" } },
    { id: "hie", name: "Hie Hie no Mi", desc: "Glacial blues — absolute zero.", cost: 6000, cat: "fruit", vars: { "--parchment": "#eef5fb", "--parchment2": "#dcebf6", "--parchment3": "#c6def0", "--ocean-navy": "#10405e", "--ocean-navy2": "#0a2c43", "--bounty-gold": "#4aa3c8", "--bounty-gold2": "#3482a4", "--wanted-red": "#426a98", "--ink": "#12303f", "--ink-soft": "#5a7488", "--paper-line": "#bcd6ea", "--sea-teal": "#24717d", "--chrome-text": "#eef5fb" } }
  ];

  var ITEMS = {
    xp_surge:      { name: "XP Surge",      icon: "ti-flame",       blurb: "Doubles the XP from your next bounty or journal entry.", use: "active",  earn: "Marine Dispatches \u00B7 recruiting the Shipwright" },
    berry_haul:    { name: "Berry Haul",    icon: "ti-coins",       blurb: "Instantly hauls in 500 Berries.", use: "instant", berries: 500, earn: "Every \u0E3F5,000 spent making port \u00B7 Marine Dispatches \u00B7 recruiting the Navigator" },
    streak_shield: { name: "Streak Shield", icon: "ti-shield-half", blurb: "Auto-protects your streak from one missed day.", use: "passive", earn: "Marine Dispatches \u00B7 eating the Gomu Gomu no Mi" },
    haki_focus:    { name: "Haki Focus",    icon: "ti-bolt",        blurb: "Your next bounty or journal earns bonus Haki Points.", use: "active",  earn: "Marine Dispatches \u00B7 recruiting the Swordsman" },
    log_insight:   { name: "Log Insight",   icon: "ti-bulb",        blurb: "Adds a reflection prompt to your next log entry for bonus Berries.", use: "active",  earn: "Marine Dispatches \u00B7 recruiting the Cook" }
  };
  var ITEM_KEYS = ["xp_surge", "berry_haul", "streak_shield", "haki_focus", "log_insight"];
  var CREW_ITEM = { swordsman: "haki_focus", navigator: "berry_haul", cook: "log_insight", shipwright: "xp_surge", gomu: "streak_shield", yonko: "haki_focus" };
  var BERRY_SPEND_MILESTONE = 5000;
  function randomItemKey() { return ITEM_KEYS[Math.floor(Math.random() * ITEM_KEYS.length)]; }

  var BOUNTY_MILESTONES = [
    { count: 10,  bonus: 100,  title: "Wanted Rookie" },
    { count: 25,  bonus: 250,  title: "Rising Outlaw" },
    { count: 50,  bonus: 500,  title: "Notorious Outlaw" },
    { count: 100, bonus: 1000, title: "Veteran of a Hundred Bounties" },
    { count: 250, bonus: 2500, title: "Feared Across the Seas" },
    { count: 500, bonus: 5000, title: "Living Legend" }
  ];
  function nextBountyMilestone(cleared) {
    for (var i = 0; i < BOUNTY_MILESTONES.length; i++) {
      if (cleared < BOUNTY_MILESTONES[i].count) return BOUNTY_MILESTONES[i];
    }
    return null;
  }

  var HAKI_NODES = [];
  STAT_KEYS.forEach(function (k) { HAKI_TREE[k].forEach(function (n) { HAKI_NODES.push(n); }); });

  var economy = {
    STATS: STATS, STAT_KEYS: STAT_KEYS,
    HAKI_TREE: HAKI_TREE, HAKI_NODES: HAKI_NODES, HAKI_TREE_META: HAKI_TREE_META, HAKI_LIFETIME_CAP: HAKI_LIFETIME_CAP,
    PROMPTS: PROMPTS, promptForDay: promptForDay,
    LORE: LORE, loreForDay: loreForDay,
    morningPrompt: morningPrompt, eveningPrompt: eveningPrompt,
    DISPATCH_EVENTS: DISPATCH_EVENTS, dispatchForDay: dispatchForDay,
    THEMES: THEMES,
    BOUNTY_MILESTONES: BOUNTY_MILESTONES, nextBountyMilestone: nextBountyMilestone,
    ITEMS: ITEMS, ITEM_KEYS: ITEM_KEYS, CREW_ITEM: CREW_ITEM, BERRY_SPEND_MILESTONE: BERRY_SPEND_MILESTONE, randomItemKey: randomItemKey,
    TIERS: TIERS, TIER_KEYS: TIER_KEYS,
    XP_BASE: XP_BASE,
    xpToNext: xpToNext,
    cumulativeXpForLevel: cumulativeXpForLevel,
    levelFromXp: levelFromXp,
    RANKS: RANKS, rankForBounty: rankForBounty,
    JOURNAL: JOURNAL, BUFFS: BUFFS,
    DEFAULT_HABITS: DEFAULT_HABITS,
    DEFAULT_SHOP: DEFAULT_SHOP,
    CREW: CREW
  };

  root.GL = root.GL || {};
  root.GL.economy = economy;
  if (typeof module !== "undefined" && module.exports) module.exports = economy;
})(typeof window !== "undefined" ? window : this);

