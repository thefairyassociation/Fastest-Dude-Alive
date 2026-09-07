import type { AtmosphereId } from "../world/Sky";

/**
 * MINUTES OWED — fifteen playable chapters in three acts.
 *
 * Stable chapter ids deliberately retain their original spelling so existing
 * saves keep their unlocked/completed chapters. Visible titles are the new story.
 * Authored routes connect real places; branch beats add actual playable tasks.
 */
export interface Line {
  /** Cast id, or "narration" for unattributed text. */
  who: string;
  text: string;
}

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
      /** Authored stops take precedence over generated gates. */
      stops?: Anchor[];
      minKph?: number;
      seconds?: number;
    }
  | { kind: "rescue"; title: string; detail: string; anchor: Anchor; count: number; seconds: number }
  | { kind: "duel"; title: string; detail: string; anchor: Anchor; rogue: string }
  | { kind: "survive"; title: string; detail: string; anchor: Anchor; rogue: string; seconds: number }
  | { kind: "investigate"; title: string; detail: string; anchor: Anchor; sites: number; spread: number }
  | { kind: "climb"; title: string; detail: string; anchor: Anchor; height: number }
  | { kind: "choice"; title: string; detail: string; prompt: string; options: [ChoiceOption, ChoiceOption] }
  | {
      kind: "branch";
      /** Omit to use the choice made earlier in this chapter. */
      chapter?: string;
      outcomes: Record<string, Objective[]>;
      /** Also used when an older profile has no recorded choice. */
      fallback: Objective[];
    };

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
  brief: string;
  spawn: Anchor;
  beats: Objective[];
}

const at = (id: string): Anchor => ({ at: "landmark", id });
const lines = (...entries: [string, string][]): Line[] => entries.map(([who, text]) => ({ who, text }));
const talk = (...entries: [string, string][]): Objective => ({ kind: "talk", lines: lines(...entries) });
const travel = (title: string, detail: string, place: string): Objective =>
  ({ kind: "travel", title, detail, anchor: at(place), radius: 32 });
const rescue = (title: string, detail: string, place: string, count: number, seconds: number): Objective =>
  ({ kind: "rescue", title, detail, anchor: at(place), count, seconds });
const investigate = (title: string, detail: string, place: string, sites = 3, spread = 320): Objective =>
  ({ kind: "investigate", title, detail, anchor: at(place), sites, spread });
const route = (title: string, detail: string, places: string[], seconds?: number, minKph?: number): Objective =>
  ({ kind: "route", title, detail, anchor: at(places[0]!), gates: places.length, spread: 0,
    stops: places.map(at), seconds, minKph });
const duel = (title: string, detail: string, place: string, rogue: string): Objective =>
  ({ kind: "duel", title, detail, anchor: at(place), rogue });

export const GRID_CHOICE_CHAPTER = "ch12-fastest-dude-alive";

const ACT_ONE: Chapter[] = [
  {
    id: "ch01-longest-second", act: 1, number: 1,
    title: "A Route Home", subtitle: "Kestrel Bridge · 20:14", atmosphere: "dusk",
    brief: "A bridge relay failed. You pulled someone clear. Now your feet can barely keep up with you, " +
      "and there are still people on the other side of the barriers.",
    spawn: at("kestrel-bridge"),
    beats: [
      talk(
        ["narration", "Two hours ago, Nolan Reyes was delivering a replacement relay to Kestrel Bridge. He remembers a maintenance worker falling. He remembers reaching him before the light did."],
        ["wren", "You are awake, coherent, and running a temperature I cannot put on a chart. Those are three separate observations. Only two are good."],
        ["teo", "The rescue suit is venting the discharge. Keep it on. Start on the straight road; we need to know whether you can stop."],
        ["nolan", "The worker. Did he make it?"],
        ["wren", "Yes. He wants his delivery signed for."]
      ),
      { kind: "reach-speed", title: "Find your feet", detail: "Hold forward and Sprint on a straight road. Release to brake.", kph: 200, hold: 2 },
      talk(
        ["solomon", "Precinct Seven to anyone at Kestrel. The pedestrian exits have locked. Three people are still outside the evacuation line."],
        ["wren", "Nolan, walk them clear. Fast getting there. Gentle when you arrive."],
        ["nolan", "I know the route."]
      ),
      rescue("Clear the bridge approaches", "Reach each stranded resident. Slow down at the rescue markers.", "kestrel-bridge", 3, 110),
      travel("Report to the emergency desk", "Kade needs a witness before the bridge logs are overwritten.", "precinct-seven"),
      talk(
        ["solomon", "The system marks the bridge empty. I can see three people on your camera."],
        ["nolan", "One of them was waving at the emergency speaker. It told her to wait."],
        ["solomon", "Then we start with her name. All three names. Nobody goes in this log as a rounding error."]
      ),
    ],
  },
  {
    id: "ch02-eleven-months", act: 1, number: 2,
    title: "Manual Override", subtitle: "Meridian · the morning after", atmosphere: "dawn",
    brief: "The city calls the bridge failure isolated. A clinic's backup battery and an unanswered dispatch say otherwise.",
    spawn: at("precinct-seven"),
    beats: [
      talk(
        ["sable", "Until the bridge is inspected, transit gets emergency priority. Keep that corridor open."],
        ["wren", "My clinic requested power before the bridge failed. The reply still says six minutes."],
        ["nolan", "How long has it said six minutes?"],
        ["wren", "Since yesterday."]
      ),
      route("The battery run", "Collect the transit spare, take it to Halcyon's clinic annex, then check the neighborhood aid desk.",
        ["ridgeline-transit", "halcyon-labs", "kade-house"], 150),
      talk(
        ["elena", "Tell your captain the people charging oxygen batteries in Solomon's kitchen also count as an emergency."],
        ["nolan", "Mum, you could have called me."],
        ["elena", "I called the number everyone else has. That is the point."],
        ["teo", "Nolan, the annex roof has a dead repeater. Hit a solid wall at speed to run up it. Jump when you need to leave the wall."]
      ),
      travel("Reach the annex", "Return to Halcyon. Use a nearby facade for the repeater check.", "halcyon-labs"),
      { kind: "climb", title: "Get above the dead zone", detail: "Sprint into a building wall and climb at least 24 metres.", anchor: at("halcyon-labs"), height: 24 },
      talk(
        ["teo", "Repeater is fine. Those requests were received."],
        ["wren", "Then somebody needs to explain why receiving a request is different from answering it."],
        ["sable", "I will ask Halcyon. Nolan, don't turn yourself into a second dispatch system."],
        ["nolan", "I would love to stop being the first one that works."]
      ),
    ],
  },
  {
    id: "ch03-runs-hot", act: 1, number: 3,
    title: "Controlled Demolition", subtitle: "Sable Arena · a scheduled fault", atmosphere: "golden",
    brief: "A contractor is destroying supposedly obsolete relays. The residents using them did not get the notice.",
    spawn: at("sable-arena"),
    beats: [
      talk(
        ["solomon", "A demolition rig at the arena. Licensed operator. No evacuation permit."],
        ["kiln", "Roland Boyce. Decommission order, signed and paid. Your people should have cleared the block."],
        ["nolan", "They are still in it. Put the rig down."],
        ["kiln", "The schedule doesn't have a box for that."]
      ),
      rescue("Clear the work zone", "Get five residents away from the relay approaches before confronting the operator.", "sable-arena", 5, 110),
      duel("Shut down Kiln's rig", "Move out of the heat, circle behind him, and strike between attacks.", "sable-arena", "kiln"),
      investigate("Read the work orders", "Check three relay inspection points around the arena.", "sable-arena"),
      talk(
        ["teo", "They weren't obsolete. Same part number as the relay Nolan delivered yesterday."],
        ["nadia", "The contractor gets a completion bonus if the failure is classified as wear. Send me the order exactly as you found it."],
        ["nolan", "Someone is paying him to break working equipment?"],
        ["nadia", "Someone is paying him to replace equipment on paper. We prove the rest."]
      ),
    ],
  },
  {
    id: "ch04-the-streak", act: 1, number: 4,
    title: "On the Record", subtitle: "The Ledger · three copies", atmosphere: "noon",
    brief: "A story that depends on one stolen file can disappear with it. Put the evidence in more than one pair of hands.",
    spawn: at("ledger-tower"),
    beats: [
      talk(
        ["nadia", "Halcyon's lawyers say the relay contract is authentic and I have misunderstood every word of it."],
        ["nolan", "That sounds promising."],
        ["nadia", "It sounds like I need the original dispatch record. My father is going to enjoy this."],
        ["solomon", "I already printed it. There are mistakes in it. Some are mine."]
      ),
      investigate("Match the original calls", "Collect three local dispatch logs around Precinct Seven.", "precinct-seven", 3, 380),
      route("Keep a public record", "Deliver matching copies to the emergency desk, residents' aid desk, and Ledger archive.",
        ["precinct-seven", "kade-house", "ledger-tower"], 135),
      talk(
        ["nadia", "Published. Contracts, timestamps, and the names of the people who agreed to speak."],
        ["nolan", "What did you call me?"],
        ["nadia", "Municipal courier. You can correct it if you've quit."],
        ["nolan", "No. That's right."],
        ["vance", "Ms. Kade. Your figures are accurate. Your explanation is incomplete. I will meet you at Halcyon without a lawyer."]
      ),
    ],
  },
];

const ACT_TWO: Chapter[] = [
  {
    id: "ch05-dead-seconds", act: 2, number: 5,
    title: "The Waiting List", subtitle: "Halcyon · what the averages hide", atmosphere: "golden",
    brief: "The grid's architect explains the bargain. Then you visit the addresses missing from the sales pitch.",
    spawn: at("halcyon-labs"),
    beats: [
      talk(
        ["vance", "The Priority Grid moves reserve power where a failure would cost the most lives. We sold guaranteed access to fund its expansion."],
        ["wren", "Guaranteed access to whom?"],
        ["vance", "Hospitals first. Then major employers. Transit. Private subscribers."],
        ["nolan", "My mother's block comes after a subscription."],
        ["vance", "Your mother's block would not have a relay without those subscriptions."],
        ["nadia", "Let us test both halves of that sentence."]
      ),
      investigate("Audit the overflow circuit", "Log four emergency relays around Marrow Hill.", "kade-house", 4, 430),
      rescue("Answer the waiting calls", "Reach the residents whose assistance requests are still queued.", "kade-house", 5, 110),
      talk(
        ["wren", "The grid counts patients connected to registered equipment. Home oxygen isn't registered. Neither is a lift someone needs to leave a fire."],
        ["solomon", "Our response time improved because the clock starts when the grid accepts the call. Not when a person makes it."],
        ["nolan", "Then publish the waiting time too."],
        ["vance", "That will make the entire system look worse."],
        ["solomon", "It will make it look like itself."]
      ),
    ],
  },
  {
    id: "ch06-pressure-systems", act: 2, number: 6,
    title: "A Controlled Failure", subtitle: "Ridgeline · the cooling circuit", atmosphere: "storm",
    brief: "A former systems engineer intends to make the grid's defects impossible to ignore. There are commuters under her demonstration.",
    spawn: at("ridgeline-transit"),
    beats: [
      talk(
        ["gale", "I filed the pressure report twice. A shutdown costs less than another year of pretending."],
        ["teo", "Margo, the tunnel doors use the same circuit. Your shutdown locks them."],
        ["gale", "Then the city will finally have to send somebody."],
        ["nolan", "It sent me. Stop the pressure rig."]
      ),
      rescue("Open an evacuation path", "Reach six commuters around the transit approaches.", "ridgeline-transit", 6, 120),
      duel("Disable Gale's pressure rig", "Keep moving across the gusts and close in after a volley.", "ridgeline-transit", "gale"),
      route("Restart the cooling loop", "Reset the transit, bridge, and Halcyon junctions in order.",
        ["ridgeline-transit", "kestrel-bridge", "halcyon-labs"], 140),
      talk(
        ["gale", "Iona said your suit could cover the evacuation. She said nobody would be left waiting."],
        ["sable", "Iona Vale? She commanded the Westhaven rescue station."],
        ["nolan", "Where is she now?"],
        ["sable", "I closed her station. The grid marked it redundant. She hasn't taken my calls since."]
      ),
    ],
  },
  {
    id: "ch07-cold-equation", act: 2, number: 7,
    title: "The Price of a Street", subtitle: "Kestrel Bridge · containment", atmosphere: "night",
    brief: "A damping field blocks the repair convoy. Its operator has a contract and very little interest in what happens on either side.",
    spawn: at("kestrel-bridge"),
    beats: [
      talk(
        ["coldsnap", "Cassian Vok. This is a containment perimeter. Cross it and your suit stops doing the impressive part."],
        ["nolan", "There are replacement batteries in that convoy."],
        ["coldsnap", "Then I suggest you discuss access with my client."],
        ["teo", "The field is strongest close to him. Make him commit to a pulse, then get around the edge."]
      ),
      duel("Break Coldsnap's blockade", "Work around the damping field. Keep enough distance to recover speed.", "kestrel-bridge", "coldsnap"),
      route("Get the repair parts through", "Carry the convoy's control modules to the arena depot and the transit workshop.",
        ["sable-arena", "ridgeline-transit"], 100),
      talk(
        ["vantage", "You are repairing the locks on a door people have been asking to open for six years."],
        ["nolan", "Iona? These batteries keep people breathing tonight."],
        ["vantage", "I know. I carried them before you could do it in seconds. Ask Sable why your mother still needs a phone tree."],
        ["nolan", "Come ask her with me."],
        ["vantage", "I already did."]
      ),
    ],
  },
  {
    id: "ch08-what-wren-knows", act: 2, number: 8,
    title: "The Missing Column", subtitle: "Corbin Green · the paper archive", atmosphere: "dusk",
    brief: "Wren kept the records the network did not. Iona kept the same names. They reached different conclusions.",
    spawn: at("corbin-green"),
    beats: [
      talk(
        ["wren", "I kept discharge sheets after the clinic software stopped preserving failed requests. Paper cannot decide an outage was resolved because someone stopped asking."],
        ["nadia", "I need dates, not patient names. We can publish the delay without publishing someone's worst night."],
        ["nolan", "Did Iona know you had these?"],
        ["wren", "She brought me half of them."]
      ),
      investigate("Recover the neighborhood logs", "Collect four archive bundles from aid stations around Corbin Green.", "corbin-green", 4, 450),
      route("Compare the independent records", "Take the archive to Halcyon for the audit, then return a verified copy to the Ledger.",
        ["halcyon-labs", "ledger-tower"], 105),
      talk(
        ["vance", "There is an old recovery command. It disconnects every district, clears the priority table, and restarts from zero."],
        ["teo", "Clears the table or clears the machinery's memory of what it did?"],
        ["vance", "Both. The billing record, the queue history, the original requests."],
        ["nadia", "Then the archive stays here. Nobody's plan gets to erase the evidence."],
        ["wren", "And nobody turns off a ward to prove it deserved electricity."]
      ),
    ],
  },
];

const ACT_THREE: Chapter[] = [
  {
    id: "ch09-negative-resonance", act: 3, number: 9,
    title: "Always a Step Ahead", subtitle: "Corbin Green · Vantage", atmosphere: "storm",
    brief: "Iona's suit knows where the routing grid expects you to turn. You need forty-five seconds to find out how.",
    spawn: at("corbin-green"),
    beats: [
      talk(
        ["vantage", "Vance will promise a review. Sable will promise staffing. Then a faster runner will become their entire expansion plan."],
        ["nolan", "You used me as the evacuation plan at Ridgeline. How is that different?"],
        ["vantage", "Because mine ends tonight."],
        ["teo", "Her suit is receiving your route before you move. I can trace the signal if you stay alive for forty-five seconds. Don't try to win this."]
      ),
      { kind: "survive", title: "Trace Vantage's signal", detail: "Survive for 45 seconds. Keep moving and use buildings to break her approach.", anchor: at("corbin-green"), rogue: "vantage", seconds: 45 },
      talk(
        ["teo", "Got it. She is reading the same priority map as dispatch. She cannot predict a road the grid has stopped mapping."],
        ["vantage", "I can be at the spire before you cross the bridge. I can end this before they write another apology."],
        ["nolan", "You can be first. That isn't the same as getting everyone there."],
        ["vantage", "Then show me everyone."]
      ),
      travel("Regroup at the aid desk", "Take the signal trace to the people planning a way through the shutdown.", "kade-house"),
    ],
  },
  {
    id: "ch10-twenty-two-years", act: 3, number: 10,
    title: "Everyone Is a Route", subtitle: "Meridian · a plan with names", atmosphere: "dawn",
    brief: "There will not be one miraculous lap that saves the city. Prepare ordinary people to finish the work a runner starts.",
    spawn: at("kade-house"),
    beats: [
      talk(
        ["sable", "We can isolate the spire, but the districts will need local reserves. Nolan takes batteries to all of them."],
        ["marcus", "No. Nolan takes the connectors. My launch takes batteries to Saltmere. Drivers take the rest."],
        ["elena", "Residents call back when they are ready. Silence does not mean ready."],
        ["sable", "Right. People and confirmation, by address. Let's do it properly."]
      ),
      route("Lay the manual network", "Deliver couplers to transit, the arena depot, Corbin's aid station, and the bridge crew.",
        ["ridgeline-transit", "sable-arena", "corbin-green", "kestrel-bridge"], 180),
      rescue("Finish the evacuation register", "Find the six residents still missing from the bridge crew's roll call.", "kestrel-bridge", 6, 125),
      talk(
        ["solomon", "All four crews checked in. This time I can tell you who checked, who answered, and who is still on the way."],
        ["wren", "The ward has power for the changeover. We have a real margin now, not a prediction."],
        ["nolan", "What do you need from me?"],
        ["teo", "One last run. Then we switch the grid off under Iona's feet."]
      ),
    ],
  },
  {
    id: "ch11-man-in-the-chair", act: 3, number: 11,
    title: "An Honest Shutdown", subtitle: "Halcyon · responsibility", atmosphere: "night",
    brief: "Vance can disconnect the priority controller. He must also leave a record of why it was necessary.",
    spawn: at("halcyon-labs"),
    beats: [
      talk(
        ["vance", "I can authorize the district isolation. If this goes wrong, the order has my name on it."],
        ["nadia", "It already has your name on it. The question is whether the public gets to read it."],
        ["vance", "Record this. I approved subscriber priority after we knew it was delaying emergency service. The failures were foreseeable."],
        ["nolan", "Keep talking to Nadia. Teo, tell me where to run."]
      ),
      route("Disconnect the prediction feed", "Trip the local breakers at Halcyon, transit, the bridge, then the broadcast spire.",
        ["halcyon-labs", "ridgeline-transit", "kestrel-bridge", "broadcast-spire"], 155),
      talk(
        ["teo", "Her route feed is gone. Your suit still works; it carries its own charge. Hers does too, but now she has to watch where you actually go."],
        ["vantage", "You cut the grid. After all that, you cut the grid."],
        ["nolan", "The wards are on local power. The records are copied. The crews are ready. Those parts matter."],
        ["vantage", "They will reconnect it the moment the cameras leave."]
      ),
      duel("Take the recovery key", "Vantage has lost the prediction feed. Dodge her approach and counter when she slows.", "broadcast-spire", "vantage"),
      talk(
        ["vantage", "I kept every letter. Every hearing date. They let me talk until the room closed."],
        ["nolan", "Give Nadia the letters. Give Wren the shutdown key. You still get to decide what you do next."],
        ["narration", "Iona sets the key on the pavement. Sable approaches at walking pace."],
        ["sable", "You are under arrest. And those letters will be entered as evidence. Including the ones I answered."]
      ),
    ],
  },
  {
    id: GRID_CHOICE_CHAPTER, act: 3, number: 12,
    title: "Minutes Owed", subtitle: "Meridian Spire · the handover", atmosphere: "storm",
    brief: "The immediate threat is over. The reserves are finite. Choose how to keep the city running until its residents can decide what follows.",
    spawn: at("broadcast-spire"),
    beats: [
      talk(
        ["wren", "The backup crews bought us time. The storm is taking it back. Two aid stations need their handover finished now."],
        ["nolan", "Which first?"],
        ["solomon", "The bridge, then Corbin. We asked them. We have their actual reserve readings."]
      ),
      route("Hold the handover", "Carry the final switching orders to the bridge and Corbin Green, then return to the spire.",
        ["kestrel-bridge", "corbin-green", "broadcast-spire"], 135),
      rescue("Clear the spire approaches", "Bring the last five residents inside the local-power perimeter.", "broadcast-spire", 5, 100),
      talk(
        ["teo", "We can restore the grid with subscriber priority removed and every queue publicly logged. Efficient, but it keeps one central point of failure."],
        ["wren", "Or leave districts disconnected and put crews in charge of their own reserves. More deliveries, more fuel, less room for error until we rebuild."],
        ["nadia", "This is an emergency instruction, Nolan. A public vote comes after. Neither option makes you the mayor."],
        ["nolan", "Good. I still have a delivery job."]
      ),
      {
        kind: "choice", title: "The emergency instruction", detail: "Both plans keep the wards supplied. Your choice changes the work that follows.",
        prompt: "How should Meridian run until the public hearings?",
        options: [
          {
            id: "restore-public-grid", label: "Restore a publicly logged grid",
            outcome: lines(
              ["nolan", "Restore it with the queues visible. No paid priority. Local crews keep the disconnect switches."],
              ["teo", "I need your authorization carried to Halcyon, then the transit hub. Nobody gets to quietly turn the old settings back on."],
              ["nadia", "The first queue report goes out tonight. The ugly parts too."]
            ),
          },
          {
            id: "disconnect-grid", label: "Keep districts on local control",
            outcome: lines(
              ["nolan", "Keep the districts independent. Publish the reserves and let the crews request what they actually need."],
              ["marcus", "Then take the supply schedule to the bridge and the arena. We will need paid shifts, son. People can't volunteer forever."],
              ["sable", "Agreed. I am signing for the crews and the fuel now."]
            ),
          },
        ],
      },
      {
        kind: "branch",
        outcomes: {
          "restore-public-grid": [route("Authorize the public restart", "Deliver the logged restart order to Halcyon and transit.", ["halcyon-labs", "ridgeline-transit"], 105)],
          "disconnect-grid": [route("Authorize local supply", "Deliver independent supply orders to the bridge and arena crews.", ["kestrel-bridge", "sable-arena"], 105)],
        },
        fallback: [travel("Confirm the handover", "Deliver the signed emergency plan to the dispatch desk.", "precinct-seven")],
      },
      talk(
        ["narration", "At 00:18, every aid station answers a roll call. The city has not been fixed. For the first time tonight, nobody claims it has."],
        ["elena", "Come home when your shift ends. I do mean ends."],
        ["nolan", "One more thing first."],
        ["solomon", "The northern districts. Their calls are coming through now."],
        ["nolan", "Then we need a bigger map."]
      ),
    ],
  },
  {
    id: "ch13-open-circuit", act: 3, number: 13,
    title: "Open Circuit", subtitle: "Northline · the next morning", atmosphere: "dawn",
    brief: "The emergency decision has practical consequences. Bring Northline into the new arrangement and find the people missing from its coverage map.",
    spawn: at("northline-station"),
    beats: [
      talk(
        ["solomon", "Northline used to be listed as an external service area. They pay city taxes. I have corrected the map."],
        ["nolan", "The streets didn't move overnight."],
        ["solomon", "No. Just the line around who we thought we owed a call."]
      ),
      {
        kind: "branch", chapter: GRID_CHOICE_CHAPTER,
        outcomes: {
          "restore-public-grid": [
            talk(
              ["teo", "Your public grid is live downtown. Northline's old relays cannot send queue reports. We need a physical survey before they join."],
              ["nolan", "And if a relay doesn't report?"],
              ["teo", "We leave it under local control. Missing data is a reason to check, not permission to assume."]
            ),
            investigate("Survey Northline's relays", "Log four legacy connectors around Northline Station.", "northline-station", 4, 380),
            route("Connect the public monitors", "Carry the surveyed settings to the observatory and Beacon Point's coastal monitor.",
              ["northline-observatory", "beacon-point"], 155),
          ],
          "disconnect-grid": [
            talk(
              ["marcus", "Your local-control plan works if the supplies arrive. Northline's first delivery went to a depot that closed eight years ago."],
              ["nolan", "I will meet the crews at their actual addresses."],
              ["sable", "The driver is being paid for the delay. A bad manifest is our mistake."]
            ),
            rescue("Meet the stranded supply crews", "Reach five Northline residents and drivers caught outside the local aid network.", "northline-station", 5, 120),
            route("Build the Northline supply loop", "Carry corrected manifests to the observatory and Beacon Point's receiving crew.",
              ["northline-observatory", "beacon-point"], 155),
          ],
        },
        fallback: [
          talk(["sable", "Whatever the emergency plan said, Northline needs a verified connection to it. Start with the station's actual equipment."]),
          investigate("Verify Northline's equipment", "Log four local reserve stations before making the coastal connection.", "northline-station", 4, 380),
          route("Make the coastal connection", "Deliver the Northline survey to the observatory and Beacon Point.", ["northline-observatory", "beacon-point"], 155),
        ],
      },
      rescue("Close the coastal coverage gap", "Reach the five residents who were outside Beacon Point's old service boundary.", "beacon-point", 5, 120),
      talk(
        ["nadia", "Northline's first report is online. Its waiting time is worse than downtown's."],
        ["nolan", "We just spent all morning there."],
        ["nadia", "Yesterday we didn't count the wait at all. This is a problem we can finally point to."],
        ["solomon", "Westhaven is next. This time I called ahead."]
      ),
    ],
  },
  {
    id: "ch14-waterline", act: 3, number: 14,
    title: "Waterline", subtitle: "Westhaven to Saltmere · the ordinary emergency", atmosphere: "storm",
    brief: "A reservoir pump fails without a villain touching it. The wider city needs maintenance, spare parts, and a route across the water.",
    spawn: at("westhaven-reservoir"),
    beats: [
      talk(
        ["elena", "Reservoir pump three is down. The replacement was approved last winter. It is apparently still being approved."],
        ["nolan", "Sabotage?"],
        ["teo", "A seal that should have been replaced. Sometimes the answer is a seal."],
        ["marcus", "Foundry has the part. Saltmere has the crane controller. I have a boat and a very unimpressive top speed."]
      ),
      investigate("Find the failed pump circuit", "Check three pressure stations around Westhaven Reservoir.", "westhaven-reservoir", 3, 350),
      route("The long supply run", "Pick up the replacement seal at Foundry Exchange and the crane controller at Saltmere Terminal.",
        ["foundry-exchange", "saltmere-terminal"], 180),
      talk(
        ["marcus", "The crane is back. We can load the part. There are people on the terminal apron waiting for a ferry that isn't coming."],
        ["nolan", "I can carry the part back."],
        ["marcus", "It weighs more than my boat. Clear the apron. Let us do this bit."]
      ),
      rescue("Clear Saltmere's terminal", "Reach six stranded passengers so the repair crew can use the apron.", "saltmere-terminal", 6, 125),
      route("Bring the restart order home", "Confirm the bridge delivery, then take the pump restart order to Westhaven.",
        ["kestrel-bridge", "westhaven-reservoir"], 160),
      talk(
        ["elena", "Pressure is coming back. The repair crew says they need another shift to check the other seals."],
        ["sable", "Approved. Before somebody has to run across the city for them."],
        ["nolan", "Dad, thank you."],
        ["marcus", "You're welcome. My boat is now officially faster than a purchase order."]
      ),
    ],
  },
  {
    id: "ch15-every-address", act: 3, number: 15,
    title: "Every Address", subtitle: "Meridian · one week later", atmosphere: "golden",
    brief: "Finish a route through the expanded city, deliver the residents' demands, and make room for an ending that does not require you to run forever.",
    spawn: at("foundry-exchange"),
    beats: [
      talk(
        ["nadia", "The first public hearing starts at six. Six districts sent written proposals. None of them begins with 'hire another speedster'."],
        ["nolan", "A little hurtful."],
        ["wren", "I helped write that part."],
        ["solomon", "One collection route: Foundry, Westhaven, Northline, the coast, Saltmere, then the Ledger. No deadline. Bring the papers back intact."]
      ),
      route("Every address counts", "Collect the residents' proposals across the expanded city. Take your time; this route has no countdown.",
        ["foundry-exchange", "westhaven-reservoir", "northline-observatory", "northline-station", "beacon-point", "saltmere-terminal", "ledger-tower"]),
      {
        kind: "branch", chapter: GRID_CHOICE_CHAPTER,
        outcomes: {
          "restore-public-grid": [talk(
            ["nadia", "The public grid has reduced the delivery load. Its first independent audit also caught Halcyon trying to exempt three subscribers."],
            ["nolan", "Did the exemption go through?"],
            ["nadia", "No. The local crews refused it. Having a way to say no turned out to matter."]
          )],
          "disconnect-grid": [talk(
            ["nadia", "The local districts kept control. They have also demanded shared fuel reserves and paid maintenance crews. Independence still needs coordination."],
            ["nolan", "Did they get them?"],
            ["nadia", "Funding is the first vote tonight. I have every councillor's answer on the record."]
          )],
        },
        fallback: [talk(
          ["nadia", "The residents agree on one thing: no emergency plan becomes permanent just because everyone is tired."],
          ["nolan", "Good. Let's put their proposals first."]
        )],
      },
      talk(
        ["vance", "They have asked me to attend as a witness, not a consultant."],
        ["nadia", "Yes."],
        ["vance", "I will be there."],
        ["sable", "Iona's records are in the inquiry. So are her charges. One does not cancel the other."],
        ["wren", "Nolan, your checkup is tomorrow. An appointment. You are allowed to arrive at an ordinary speed."]
      ),
      travel("Clock out", "Take the last delivery home to the Kade House aid desk.", "kade-house"),
      talk(
        ["elena", "There he is. The fastest dude alive. Ten minutes late for dinner."],
        ["nolan", "I walked the last block."],
        ["marcus", "How was it?"],
        ["nolan", "Someone else was fixing the streetlight."],
        ["narration", "Tomorrow there will be another call. Tonight, someone else is on shift. Meridian stays open."]
      ),
    ],
  },
];

export const CHAPTERS: Chapter[] = [...ACT_ONE, ...ACT_TWO, ...ACT_THREE];
export const ACT_TITLES: Record<1 | 2 | 3, string> = {
  1: "Act I — The Calls We Miss",
  2: "Act II — Who Gets Counted",
  3: "Act III — Every Address",
};

export function chapterById(id: string): Chapter {
  const found = CHAPTERS.find((chapter) => chapter.id === id);
  if (!found) throw new Error(`Unknown chapter "${id}".`);
  return found;
}
