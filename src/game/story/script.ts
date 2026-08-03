import type { AtmosphereId } from "../world/Sky";

/**
 * The campaign script.
 *
 * Twelve chapters in three acts, authored as data so the runner in
 * `Campaign.ts` stays mechanical and the writing stays in one place. A beat is
 * either dialogue or an objective; objectives that need real gameplay
 * delegate to the same activity classes free roam uses.
 *
 * Chapters can be added, reordered or rewritten without touching the runner.
 */

export interface Line {
  /** Cast id, or "narration" for unattributed text. */
  who: string;
  text: string;
}

/** Anchors an objective somewhere in the world. */
export type Anchor =
  | { at: "landmark"; id: string }
  | { at: "point"; x: number; z: number }
  | { at: "player" };

export type Objective =
  | { kind: "talk"; lines: Line[] }
  | { kind: "travel"; title: string; detail: string; anchor: Anchor; radius?: number }
  | { kind: "reach-speed"; title: string; detail: string; kph: number; hold: number }
  | {
      kind: "route";
      title: string;
      detail: string;
      anchor: Anchor;
      gates: number;
      spread: number;
      minKph?: number;
      seconds?: number;
    }
  | { kind: "rescue"; title: string; detail: string; anchor: Anchor; count: number; seconds: number }
  | { kind: "duel"; title: string; detail: string; anchor: Anchor; rogue: string }
  | { kind: "survive"; title: string; detail: string; anchor: Anchor; rogue: string; seconds: number }
  | { kind: "investigate"; title: string; detail: string; anchor: Anchor; sites: number; spread: number }
  | { kind: "climb"; title: string; detail: string; anchor: Anchor; height: number }
  | { kind: "choice"; title: string; detail: string; prompt: string; options: [ChoiceOption, ChoiceOption] };

export interface ChoiceOption {
  id: string;
  label: string;
  outcome: Line[];
}

export interface Chapter {
  id: string;
  act: 1 | 2 | 3;
  number: number;
  title: string;
  subtitle: string;
  atmosphere: AtmosphereId;
  /** Shown on the chapter-select card. */
  brief: string;
  /** Where the player is placed when the chapter begins. */
  spawn: Anchor;
  beats: Objective[];
}

const ACT_ONE: Chapter[] = [
  {
    id: "ch01-longest-second",
    act: 1,
    number: 1,
    title: "The Longest Second",
    subtitle: "Meridian City · the night of the resonance test",
    atmosphere: "dusk",
    brief:
      "You are a forensic tech who is late for the biggest science story in the city's history. " +
      "You will not make it. Something else will.",
    spawn: { at: "landmark", id: "precinct-seven" },
    beats: [
      {
        kind: "talk",
        lines: [
          { who: "narration", text: "Meridian City. 8:41 pm. Halcyon Labs is forty minutes from bringing the resonance ring to full power." },
          { who: "solomon", text: "You're on a roof. In the rain. Logging shell casings." },
          { who: "nolan", text: "Chain of custody doesn't care about the weather, Sol." },
          { who: "solomon", text: "Nadia saved you a seat at the lab thing. Front row. She had to ask a man she doesn't like." },
          { who: "nolan", text: "I'll make it." },
          { who: "solomon", text: "You have never once made it." },
        ],
      },
      {
        kind: "travel",
        title: "Get to Halcyon Labs",
        detail: "Across town. You have nineteen minutes and no car.",
        anchor: { at: "landmark", id: "halcyon-labs" },
        radius: 40,
      },
      {
        kind: "talk",
        lines: [
          { who: "narration", text: "The ring comes up to power at 9:02 pm. At 9:03 the containment field inverts." },
          { who: "narration", text: "The front crosses Meridian in eleven seconds. It comes down the precinct's antenna mast, through six floors of wet steel, and finds a man on a roof." },
          { who: "nolan", text: "…oh." },
        ],
      },
    ],
  },
  {
    id: "ch02-eleven-months",
    act: 1,
    number: 2,
    title: "Eleven Months",
    subtitle: "Halcyon Labs · the basement",
    atmosphere: "noon",
    brief: "You wake up in the building that killed you. The people who kept you alive would like a word.",
    spawn: { at: "landmark", id: "halcyon-labs" },
    beats: [
      {
        kind: "talk",
        lines: [
          { who: "wren", text: "Don't sit up. Your heart has been doing four hundred beats a minute for eleven months and I would like to keep it." },
          { who: "nolan", text: "Eleven — " },
          { who: "teo", text: "Months. Yeah. We had a whole thing going. I read to you. Mostly manuals." },
          { who: "vance", text: "Nolan. My name is Aldous Vance. I built the ring that did this to you." },
          { who: "nolan", text: "I know who you are. Half the city wants you in a cell." },
          { who: "vance", text: "The other half has stopped caring, which is worse. You are the only person the front touched who came back with something that isn't a tumour. I would like to find out what." },
          { who: "wren", text: "Carefully." },
          { who: "vance", text: "Carefully." },
        ],
      },
      {
        kind: "reach-speed",
        title: "The measured mile",
        detail: "Teo has cones out on the access road. Open up and hold it.",
        kph: 340,
        hold: 2.5,
      },
      {
        kind: "talk",
        lines: [
          { who: "teo", text: "Three hundred and fifty. In sneakers. On a road." },
          { who: "wren", text: "His core temperature went up nine degrees and came back down in under a second. That should have cooked him." },
          { who: "vance", text: "It should have. Teo — the suit." },
          { who: "teo", text: "It's not finished." },
          { who: "vance", text: "It is finished enough. He is going to run whether we hand him anything or not. I would rather he did it in something that doesn't catch fire." },
        ],
      },
      {
        kind: "route",
        title: "Suit trial",
        detail: "Six markers across Halcyon Row. Teo wants telemetry on the corners.",
        anchor: { at: "landmark", id: "halcyon-labs" },
        gates: 6,
        spread: 620,
      },
      {
        kind: "talk",
        lines: [
          { who: "teo", text: "Okay. Okay! The lattice held. You're welcome, by the way." },
          { who: "nolan", text: "Why does it have a stripe?" },
          { who: "teo", text: "Because it looked sad without one. Next question." },
        ],
      },
    ],
  },
  {
    id: "ch03-runs-hot",
    act: 1,
    number: 3,
    title: "A Man Who Runs Hot",
    subtitle: "Old Meridian · four blocks on fire",
    atmosphere: "golden",
    brief:
      "The front didn't only touch you. A foundry foreman named Roland Boyce is walking " +
      "through Old Meridian and everything he passes is burning.",
    spawn: { at: "point", x: -300, z: -900 },
    beats: [
      {
        kind: "talk",
        lines: [
          { who: "solomon", text: "Four blocks. Every hydrant in the district is running and it isn't touching it." },
          { who: "wren", text: "Nolan, listen to me. You are faster than a fire. You are not more fireproof than one." },
          { who: "nolan", text: "Get everyone out first. Understood." },
        ],
      },
      {
        kind: "rescue",
        title: "Clear the block",
        detail: "Eight people still inside the cordon. Move.",
        anchor: { at: "player" },
        count: 8,
        seconds: 70,
      },
      {
        kind: "talk",
        lines: [
          { who: "teo", text: "Okay, I've been thinking about this and I want it on the record before anyone else says anything." },
          { who: "wren", text: "Teo." },
          { who: "teo", text: "Kiln. His name is Kiln. It's a foundry word, it's thematically airtight, and I will not be taking notes." },
          { who: "solomon", text: "Who is talking in my ear." },
        ],
      },
      {
        kind: "duel",
        title: "Stop Kiln",
        detail: "He telegraphs before every swing. Take him during the recovery.",
        anchor: { at: "player" },
        rogue: "kiln",
      },
      {
        kind: "talk",
        lines: [
          { who: "vance", text: "You hit him nineteen times in four seconds and stopped when he went down." },
          { who: "nolan", text: "He's a foreman with a bad year." },
          { who: "vance", text: "Yes. I wanted to be sure you knew that at that speed. Most people would not have." },
        ],
      },
    ],
  },
  {
    id: "ch04-the-streak",
    act: 1,
    number: 4,
    title: "The Streak",
    subtitle: "The Meridian Ledger · page one",
    atmosphere: "golden",
    brief:
      "Nadia files eight hundred words about a blur that pulls people out of burning buildings. " +
      "Her father reads it at the breakfast table.",
    spawn: { at: "landmark", id: "ledger-tower" },
    beats: [
      {
        kind: "talk",
        lines: [
          { who: "nadia", text: "'The Streak.' It's a working title. My editor wanted 'Meridian's Guardian Angel' and I threw a stapler." },
          { who: "nolan", text: "You don't know who it is." },
          { who: "nadia", text: "No. But he came back for a cat, Nolan. A whole burning block and he went back in for a cat. Whoever that is, he's got a tell." },
          { who: "solomon", text: "Nadia. Drop it." },
          { who: "nadia", text: "Dad — " },
          { who: "solomon", text: "People who chase things like this end up in the file, not on the byline." },
        ],
      },
      {
        kind: "travel",
        title: "Kestrel Bridge",
        detail: "Sable's task force has something crossing the river. Get eyes on it.",
        anchor: { at: "landmark", id: "kestrel-bridge" },
        radius: 60,
      },
      {
        kind: "talk",
        lines: [
          { who: "sable", text: "Whoever you are — this is Captain Sable, MCPD. You are in my city, on my bridge, on an open channel." },
          { who: "nolan", text: "How is she on this frequency?" },
          { who: "teo", text: "Because I built the radio in eleven days and I am one man." },
          { who: "sable", text: "You keep pulling people out of fires and I keep not arresting you. Neither of those is a plan. Come and talk to me before someone makes it one." },
        ],
      },
      {
        kind: "route",
        title: "The Riverline",
        detail: "Down the Kestrel and back. Under the gate speed you go in the water.",
        anchor: { at: "landmark", id: "kestrel-bridge" },
        gates: 5,
        spread: 900,
        minKph: 150,
      },
      {
        kind: "talk",
        lines: [
          { who: "wren", text: "You ran across water." },
          { who: "nolan", text: "I ran across water." },
          { who: "wren", text: "For four hundred metres. I want to say something scientific and what I have is: what." },
          { who: "vance", text: "Surface tension holds for exactly as long as you outrun the displacement. Slow down and the river remembers you weigh something." },
        ],
      },
    ],
  },
];

const ACT_TWO: Chapter[] = [
  {
    id: "ch05-dead-seconds",
    act: 2,
    number: 5,
    title: "Dead Seconds",
    subtitle: "Citywide · minutes that nobody lived",
    atmosphere: "golden",
    brief:
      "At 4:12 pm, everyone in Meridian loses ninety seconds. Traffic cameras skip. " +
      "Kettles boil in empty rooms. It happens again at 6:40.",
    spawn: { at: "landmark", id: "ridgeline-transit" },
    beats: [
      {
        kind: "talk",
        lines: [
          { who: "nadia", text: "Every clock in the concourse is ninety seconds behind the network. Every clock, Nolan. Not slow. Skipped." },
          { who: "wren", text: "Two hundred thousand people did not experience a minute and a half of their own lives." },
          { who: "nolan", text: "Did I?" },
          { who: "wren", text: "No. You're the only telemetry that runs clean through it. Which is either very good news or the worst possible news." },
        ],
      },
      {
        kind: "investigate",
        title: "Read the sites",
        detail: "Three points where the skip was deepest. Get there and log them.",
        anchor: { at: "landmark", id: "ridgeline-transit" },
        sites: 3,
        spread: 900,
      },
      {
        kind: "talk",
        lines: [
          { who: "teo", text: "Okay. Plot the three sites. Now plot the eleven smaller ones from last week." },
          { who: "nolan", text: "They're a circle." },
          { who: "teo", text: "They're an arc. And if you carry the arc, the centre is — " },
          { who: "nolan", text: "Halcyon." },
          { who: "vance", text: "The ring has been cold for a year. I switch it on myself every morning to prove it to the inspectors." },
          { who: "wren", text: "Then something is drawing time toward a machine that isn't running." },
        ],
      },
      {
        kind: "reach-speed",
        title: "Chase the front",
        detail: "The next skip is starting. Get inside it and hold pace.",
        kph: 520,
        hold: 3,
      },
      {
        kind: "talk",
        lines: [
          { who: "narration", text: "Inside the skip, the city is a photograph. Rain hangs. A pigeon is a fixed shape in the air." },
          { who: "narration", text: "And a long way off, moving through it, there is somebody else." },
          { who: "nolan", text: "…Wren. There's someone in here with me." },
        ],
      },
    ],
  },
  {
    id: "ch06-pressure-systems",
    act: 2,
    number: 6,
    title: "Pressure Systems",
    subtitle: "The Meridian Ledger · forty-one floors",
    atmosphere: "storm",
    brief:
      "Margo Sable filed eleven warnings about the resonance ring. The Ledger printed none of them. " +
      "Today she is on the roof and the sky is doing what she tells it.",
    spawn: { at: "landmark", id: "ledger-tower" },
    beats: [
      {
        kind: "talk",
        lines: [
          { who: "nadia", text: "She's got the whole newsroom on forty. She isn't asking for money, Nolan, she's asking for a correction." },
          { who: "sable", text: "That is my sister up there." },
          { who: "nolan", text: "…Captain?" },
          { who: "sable", text: "Margo Sable. Atmospheric research, Halcyon Labs, eleven memoranda, no replies. Get her down. Do not make me regret which of you I trusted." },
        ],
      },
      {
        kind: "climb",
        title: "Run the tower",
        detail: "Lifts are out and the stairwell is flooded. Take the outside.",
        anchor: { at: "landmark", id: "ledger-tower" },
        height: 100,
      },
      {
        kind: "talk",
        lines: [
          { who: "teo", text: "Gale. She's Gale. I'm sorry, it's right there." },
          { who: "wren", text: "Her core temperature is dropping. She's holding a pressure differential the size of a district with her own body heat." },
          { who: "nolan", text: "So if I take too long — " },
          { who: "wren", text: "She kills herself proving a point. Yes." },
        ],
      },
      {
        kind: "duel",
        title: "Bring Gale down",
        detail: "She fires where you were. Stop being there.",
        anchor: { at: "landmark", id: "ledger-tower" },
        rogue: "gale",
      },
      {
        kind: "rescue",
        title: "Clear the newsroom",
        detail: "Six people on forty and the floor is coming apart.",
        anchor: { at: "landmark", id: "ledger-tower" },
        count: 6,
        seconds: 60,
      },
      {
        kind: "talk",
        lines: [
          { who: "nadia", text: "She was right. That's the thing nobody's going to print. Every warning in that file was right." },
          { who: "nolan", text: "Then print it." },
          { who: "nadia", text: "I'm going to. And when I do, somebody at Halcyon is going to have to explain why eleven memos about containment went into a drawer." },
        ],
      },
    ],
  },
  {
    id: "ch07-cold-equation",
    act: 2,
    number: 7,
    title: "The Cold Equation",
    subtitle: "Ridgeline Transit · platform nine",
    atmosphere: "night",
    brief:
      "Cassian Vok worked out the thing nobody at Halcyon did: you don't have to catch a speedster. " +
      "You only have to make the air expensive.",
    spawn: { at: "landmark", id: "ridgeline-transit" },
    beats: [
      {
        kind: "talk",
        lines: [
          { who: "solomon", text: "Bullion transfer, platform nine, and a man in a long coat who walked past four armed officers like they were scenery." },
          { who: "teo", text: "Nolan, his field is a dampening bubble. Inside it your momentum bleeds off about nine times faster than it should." },
          { who: "nolan", text: "So I stay outside it." },
          { who: "teo", text: "He's going to put it exactly where you need to be. That's the whole trick." },
        ],
      },
      {
        kind: "duel",
        title: "Stop Coldsnap",
        detail: "Fight around the field, not through it.",
        anchor: { at: "landmark", id: "ridgeline-transit" },
        rogue: "coldsnap",
      },
      {
        kind: "talk",
        lines: [
          { who: "vantage", text: "He was close. You should know that. Two more seconds of that field and I would have had to come down and finish it myself." },
          { who: "nolan", text: "Who is this. Teo, who is on this channel." },
          { who: "teo", text: "Nobody. Nolan, there is nobody on this channel." },
          { who: "vantage", text: "Run home, Mr. Reyes. You are going to need the practice." },
        ],
      },
    ],
  },
  {
    id: "ch08-what-wren-knows",
    act: 2,
    number: 8,
    title: "What Wren Knows",
    subtitle: "Halcyon Labs · sub-level four",
    atmosphere: "night",
    brief:
      "Wren's hands stop being warm. The founding data doesn't match the public record. " +
      "And there is a corridor behind the ring room that is not on any plan of this building.",
    spawn: { at: "landmark", id: "halcyon-labs" },
    beats: [
      {
        kind: "talk",
        lines: [
          { who: "wren", text: "Take my hand." },
          { who: "nolan", text: "Wren, that's — how long has it been like that?" },
          { who: "wren", text: "Six weeks. It was a degree. Then it was four. This morning I put my palm on the sink and the water froze in the trap." },
          { who: "nolan", text: "You were in the building that night." },
          { who: "wren", text: "I was in the room next to Aaron. The front went through the wall between us and it took him and it left me this. So no. I have not been in a hurry to tell anyone." },
        ],
      },
      {
        kind: "investigate",
        title: "Pull the founding data",
        detail: "Four archive terminals across the Halcyon campus. Read them all at speed.",
        anchor: { at: "landmark", id: "halcyon-labs" },
        sites: 4,
        spread: 520,
      },
      {
        kind: "talk",
        lines: [
          { who: "nolan", text: "The public filing says the ring was designed for particle work. This says lensing. Temporal lensing. From the first page." },
          { who: "teo", text: "That's — no. No, I built the cooling for that ring. I'd have known what it was for." },
          { who: "nolan", text: "You built the cooling for what he told you it was for." },
          { who: "wren", text: "There's a corridor behind the ring room. It's on the electrical plan and it is on no floor plan since 2009." },
        ],
      },
      {
        kind: "travel",
        title: "The sealed corridor",
        detail: "Behind the ring. Whatever it is, it has its own power feed.",
        anchor: { at: "landmark", id: "halcyon-labs" },
        radius: 30,
      },
      {
        kind: "talk",
        lines: [
          { who: "narration", text: "The corridor ends in a room the size of a closet. There is a chair in it. There is a suit on a rack, bone-white and gold." },
          { who: "narration", text: "And there is a newspaper, dated fourteen years from now, with Nadia Kade's byline on the front page and a headline about a man who vanished." },
          { who: "nolan", text: "Vance." },
        ],
      },
    ],
  },
];

const ACT_THREE: Chapter[] = [
  {
    id: "ch09-negative-resonance",
    act: 3,
    number: 9,
    title: "Negative Resonance",
    subtitle: "Corbin Green · ninety seconds",
    atmosphere: "storm",
    brief:
      "He has been in Meridian for twenty-two years and this is the first time he has let you see him. " +
      "You cannot win this. You can only still be standing at the end of it.",
    spawn: { at: "landmark", id: "corbin-green" },
    beats: [
      {
        kind: "talk",
        lines: [
          { who: "vantage", text: "There you are." },
          { who: "nolan", text: "You were in the skip. In the dead seconds. That was you." },
          { who: "vantage", text: "Every one of them was me. Ninety seconds here, ninety there — I have been taking this city apart a minute at a time and nobody noticed until you." },
          { who: "vantage", text: "Which is the point of you. Now show me what a year of this bought." },
        ],
      },
      {
        kind: "survive",
        title: "Survive Vantage",
        detail: "Ninety seconds. Stay moving. You will not land a hit and that is not the objective.",
        anchor: { at: "landmark", id: "corbin-green" },
        rogue: "vantage",
        seconds: 90,
      },
      {
        kind: "talk",
        lines: [
          { who: "narration", text: "He puts Nolan through a bandstand, two hundred metres of grass and the far kerb, and then stops to let him get up." },
          { who: "vantage", text: "You are not slow. Understand that. You are simply new." },
          { who: "vantage", text: "There is a night twenty-two years ago you have never been able to explain. A kitchen. Light with no source. Your mother on the floor and your father with her blood on him and no idea how." },
          { who: "nolan", text: "How do you know that." },
          { who: "vantage", text: "Because I was there. And so, Mr. Reyes, were you." },
        ],
      },
    ],
  },
  {
    id: "ch10-twenty-two-years",
    act: 3,
    number: 10,
    title: "Twenty-Two Years",
    subtitle: "Marrow Hill · a Tuesday in October",
    atmosphere: "dawn",
    brief:
      "Wren says the resonance will tear him apart. Teo says the maths works. " +
      "Nolan is already running.",
    spawn: { at: "landmark", id: "kade-house" },
    beats: [
      {
        kind: "talk",
        lines: [
          { who: "wren", text: "Say it out loud so you hear how it sounds." },
          { who: "nolan", text: "If I run hard enough at the resonance instead of alongside it, I go back." },
          { who: "wren", text: "You go back and you come apart. Those are the same sentence." },
          { who: "teo", text: "…they're not, though. Not necessarily. The front is still active. If he enters it at the right angle at the right speed — " },
          { who: "wren", text: "Mateo." },
          { who: "teo", text: "I'm not saying he should. I'm saying the maths doesn't say no." },
          { who: "solomon", text: "Nolan. Look at me. If you can change it — " },
          { who: "solomon", text: "No. Sixteen years I've told you that man was guilty. If you can change it, you go." },
        ],
      },
      {
        kind: "reach-speed",
        title: "Run at the front",
        detail: "Everything you have. Straight into it.",
        kph: 900,
        hold: 4,
      },
      {
        kind: "talk",
        lines: [
          { who: "narration", text: "October. Rain. A kitchen window on Marrow Hill with the light on inside." },
          { who: "narration", text: "There are two speedsters in that room. One of them is bone-white and gold." },
          { who: "narration", text: "The other one is wearing Nolan's suit, and he is looking straight out of the window, at Nolan, and he is shaking his head." },
          { who: "nolan", text: "That's me. That's — I'm already there. I already tried." },
          { who: "elena", text: "Marcus? Marcus, take Nolan and go — " },
          { who: "narration", text: "The resonance closes like a hand. Meridian comes back at 6:40 pm, twenty-two years later, and Nolan Reyes is face down in the grass at Corbin Green." },
        ],
      },
      {
        kind: "talk",
        lines: [
          { who: "nolan", text: "I was there. I was always there. Every time I've thought about that night I was remembering myself." },
          { who: "wren", text: "Nolan — " },
          { who: "nolan", text: "I don't get to save her. I never did. It already happened with me in the room." },
          { who: "wren", text: "Then you get the other thing. You get the man who did it." },
        ],
      },
    ],
  },
  {
    id: "ch11-man-in-the-chair",
    act: 3,
    number: 11,
    title: "The Man in the Chair",
    subtitle: "Halcyon Labs · the ring room",
    atmosphere: "night",
    brief: "Everyone finds out at once. Nobody handles it well. One of them stops being human about it.",
    spawn: { at: "landmark", id: "halcyon-labs" },
    beats: [
      {
        kind: "talk",
        lines: [
          { who: "nolan", text: "Stand up." },
          { who: "vance", text: "Nolan." },
          { who: "nolan", text: "Stand up, Aldous. You've had twenty-two years of practice." },
          { who: "narration", text: "He stands up. He does it the way a man does when he has been waiting a very long time to stop pretending." },
          { who: "vance", text: "Aldous Vance died on a Tuesday in October. I needed a chair at a lab and a reason to build a ring, and he was not using either." },
          { who: "wren", text: "You were in the building. When it failed. You were in the building and you let it fail." },
          { who: "vance", text: "I made it fail. I needed a speedster and the front had to touch someone. It could have been any of forty people on that roster." },
          { who: "vance", text: "It was Aaron and it was you, Dr. Adeyemi, and it was a technician on a roof who was late for something. I am sorry about two of those." },
        ],
      },
      {
        kind: "talk",
        lines: [
          { who: "solomon", text: "Meridian PD. On the ground." },
          { who: "narration", text: "Solomon Kade fires three times from four metres. All three rounds are on the floor before the sound arrives." },
          { who: "vantage", text: "Detective. I have read your file. You are a good man in a story that does not have a use for one." },
          { who: "wren", text: "Get away from him." },
          { who: "narration", text: "The temperature in the ring room drops eleven degrees in a second and a half. Frost climbs the containment housing. Wren Adeyemi is standing very still with her hands open." },
          { who: "teo", text: "…okay. Okay! That's new. We're going to name that later." },
        ],
      },
      {
        kind: "duel",
        title: "Hold the ring room",
        detail: "Wren has slowed him. It will not last. Make it count.",
        anchor: { at: "landmark", id: "halcyon-labs" },
        rogue: "vantage",
      },
      {
        kind: "talk",
        lines: [
          { who: "vantage", text: "You hit me. Twice. In a cold room, with help, after a year." },
          { who: "vantage", text: "Good. Because tomorrow I am going to bring the ring up to full and open the way home, and the front that lets me through will take Meridian with it." },
          { who: "vantage", text: "You will not stop me because you cannot. But I would like you to be there. You have earned that much." },
        ],
      },
    ],
  },
  {
    id: "ch12-fastest-dude-alive",
    act: 3,
    number: 12,
    title: "The Fastest Dude Alive",
    subtitle: "Meridian City · all of it",
    atmosphere: "storm",
    brief:
      "The ring comes up at midnight. The resonance front will cross the city in eleven seconds " +
      "and keep going. Somebody has to run the other way around it.",
    spawn: { at: "landmark", id: "broadcast-spire" },
    beats: [
      {
        kind: "talk",
        lines: [
          { who: "teo", text: "Right. Here's the bad idea, and I want everyone to notice I said 'bad'." },
          { who: "teo", text: "The front expands as a ring. If something runs the opposite way around the city fast enough, the counter-rotation cancels it at the boundary." },
          { who: "wren", text: "'Something' meaning a person." },
          { who: "teo", text: "'Something' meaning Nolan doing about a thousand kilometres an hour for a full circuit of Meridian." },
          { who: "nadia", text: "And if he's a second slow?" },
          { who: "teo", text: "Then the front gets the city and Nolan gets to watch." },
          { who: "solomon", text: "He's already gone." },
        ],
      },
      {
        kind: "route",
        title: "Run the ring",
        detail: "One circuit of Meridian, against the front. Do not drop the pace.",
        anchor: { at: "landmark", id: "broadcast-spire" },
        gates: 8,
        spread: 1500,
        minKph: 620,
        seconds: 150,
      },
      {
        kind: "talk",
        lines: [
          { who: "narration", text: "The front folds at the boundary. Meridian keeps its midnight." },
          { who: "vantage", text: "Twenty-two years. Twenty-two years in a chair, in a building, in a century I do not belong to." },
          { who: "nolan", text: "I know." },
          { who: "vantage", text: "You do not." },
          { who: "nolan", text: "You killed my mother to slow me down and it made me. You built the thing that gave me this. Every single thing you did to get home is the reason you didn't." },
        ],
      },
      {
        kind: "duel",
        title: "Finish it",
        detail: "He is running on a broken ring and borrowed time. So are you.",
        anchor: { at: "landmark", id: "broadcast-spire" },
        rogue: "vantage",
      },
      {
        kind: "choice",
        title: "The last decision",
        detail: "The ring is still open. It will close in seconds and it will not open again.",
        prompt: "Vantage is down, and the way home is still standing open behind him.",
        options: [
          {
            id: "send-him-home",
            label: "Send him home",
            outcome: [
              { who: "nolan", text: "Go. Whatever's left up there — go and be somebody else's problem." },
              { who: "vantage", text: "…you understand this means I get to have existed." },
              { who: "nolan", text: "So does she. Somewhere behind us, on a Tuesday in October, she still gets to have existed. I'm not burning that to hurt you." },
              { who: "narration", text: "The ring closes at 12:04 am. Halcyon Labs is dark for the first time in fourteen years." },
              { who: "nadia", text: "So what do I call him? In the column. It's going to be a big column." },
              { who: "teo", text: "I have a list." },
              { who: "solomon", text: "He's the fastest dude alive, Nadia. Print that and let the man have his dinner." },
            ],
          },
          {
            id: "hold-him-here",
            label: "Hold him here",
            outcome: [
              { who: "nolan", text: "No. You don't get the ending. You get the chair." },
              { who: "narration", text: "Nolan Reyes pulls the containment coupling at 12:03 am. The ring collapses inward and the way home goes with it." },
              { who: "vantage", text: "You have no idea what you have just done to me." },
              { who: "nolan", text: "You'll have twenty-two years to explain it. That's the number, isn't it." },
              { who: "narration", text: "Ironvale takes him on a Thursday. Marcus Reyes walks out of the same building nine days later, blinking, into a city that has to relearn his name." },
              { who: "marcus", text: "They said a man came forward. Fast, they said. Would not give a name." },
              { who: "nolan", text: "Yeah. I hear he's like that." },
            ],
          },
        ],
      },
    ],
  },
];

export const CHAPTERS: Chapter[] = [...ACT_ONE, ...ACT_TWO, ...ACT_THREE];

export const ACT_TITLES: Record<1 | 2 | 3, string> = {
  1: "Act I — First Light",
  2: "Act II — Rogues",
  3: "Act III — Vantage",
};

export function chapterById(id: string): Chapter {
  const found = CHAPTERS.find((chapter) => chapter.id === id);
  if (!found) throw new Error(`Unknown chapter "${id}".`);
  return found;
}
