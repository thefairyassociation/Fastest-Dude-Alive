# Minutes Owed

The campaign follows Nolan Reyes, a municipal courier who gains speed while pulling a maintenance worker out of a failed bridge relay. He starts answering the emergency calls Meridian's celebrated Priority Grid says do not exist. The central question becomes what a city owes its residents when it can no longer hide the people its services leave waiting.

This is a complete replacement of the former origin story. Nolan's parents are alive and participate in the work. Wren is an emergency physician, Teo is a transit engineer, and Solomon runs a dispatch desk. Vance is the publicly accountable architect of a compromised system. His choices are visible before he admits them. Vantage is Iona Vale, a former rescue commander whose predictive suit uses the grid's routing data; she is not a visitor from another timeline.

Iona's evidence against the grid is real. Her plan to force a total reset would still endanger people dependent on it and erase its records. Nolan beats her prediction by preparing local power, preserving the evidence, coordinating ordinary crews, and disconnecting her route feed. The decisive work happens before the fight. Vance's testimony and Iona's grievances do not absolve either of responsibility.

## Playable chapters

| Chapter | Title | What the player does |
| --- | --- | --- |
| 1 | A Route Home | Learns sprinting, rescues bridge residents, reports the missing calls. |
| 2 | Manual Override | Delivers backup equipment across the city and runs up a wall to test a repeater. |
| 3 | Controlled Demolition | Clears a work zone, stops Kiln, investigates the relay orders. |
| 4 | On the Record | Collects dispatch logs and delivers independent evidence copies. |
| 5 | The Waiting List | Audits the overflow circuit and answers residents' queued calls. |
| 6 | A Controlled Failure | Rescues commuters, disables Gale, restarts the cooling loop. |
| 7 | The Price of a Street | Breaks Coldsnap's blockade and carries repair parts through it. |
| 8 | The Missing Column | Recovers Wren's archive and verifies it against Halcyon's records. |
| 9 | Always a Step Ahead | Survives Vantage for 45 seconds while Teo traces her predictive feed. |
| 10 | Everyone Is a Route | Delivers manual-network couplers and finishes the evacuation register. |
| 11 | An Honest Shutdown | Isolates four grid junctions and defeats Vantage without her route feed. |
| 12 | Minutes Owed | Completes the emergency handover, makes a choice, and physically delivers its orders. |
| 13 | Open Circuit | Performs a different Northline task depending on the choice, links the observatory and Beacon Point, and closes a coastal rescue gap. |
| 14 | Waterline | Audits a failed Westhaven pump, collects equipment through Foundry and Saltmere, clears passengers, and carries the restart order home. |
| 15 | Every Address | Collects residents' proposals on an untimed tour of the expanded city, sees the consequences of the choice, and clocks out. |

The first four chapters establish the people and teach movement through useful work. Chapters five through eight uncover the policy and the attempted forced reset. Chapters nine through twelve turn the investigation into coordinated action. The final three make rebuilding playable: new districts, supply runs, repairs, and consequences after the immediate threat ends.

## The emergency decision

Both choices happen after local crews have protected the wards. The player is choosing a temporary operating instruction, not permanently deciding the city's government.

| Choice | Immediate task | Northline consequence | Hearing callback |
| --- | --- | --- | --- |
| Restore a publicly logged grid | Carry restart orders to Halcyon and Ridgeline Transit. | Audit four legacy relays before connecting the public monitors. | An independent audit catches a subscriber exemption; local crews reject it. |
| Keep districts on local control | Carry supply orders to Kestrel Bridge and Sable Arena. | Find stranded supply crews and correct their manifests. | Districts demand shared reserves and paid maintenance; coordination still needs funding. |

The benefits and costs differ. A public grid reduces the delivery burden while retaining a central point of failure. Local control distributes authority while requiring more fuel, labor, and coordination. Neither ending claims that one fast person has repaired a city. The final image is someone else fixing a streetlight while Nolan walks home.

## Runtime and save continuity

- `src/game/story/script.ts` contains all playable dialogue and objectives. `cast.ts` supplies dialogue labels and biographies.
- Existing chapter IDs are unchanged, including legacy names such as `ch02-eleven-months`. They are save keys, not current story titles. Existing completion and numeric unlock progress survive the rewrite.
- Chapters 13–15 have new IDs. A profile that completed the old twelfth chapter gains access to chapter 13.
- The runner accepts saved choices as its fourth constructor argument. A completed chapter's decision is stored by the game and used by subsequent chapters.
- Older profiles did not preserve their ending choice. Chapters 13 and 15 therefore have neutral fallback beats that do not invent a past decision. Replaying and completing chapter 12 records a new choice.
- Branches insert tasks into a per-run copy of the beat list. Starting another playthrough cannot inherit a previously expanded branch.
- Authored `route.stops` connect actual landmark approaches in order. Existing generated ring routes remain supported. Campaign deadlines are displayed in the activity HUD, and arriving at the final gate on the deadline counts as success.
- The last collection route has no hard timer. Late campaign content can ask the player to see the expanded city without adding another emergency clock.

The story expresses infrastructure changes through missions and dialogue. It does not simulate a citywide power grid, schedule autonomous supply crews, or stage the narrated hearings as cutscenes. Future work should deepen those visible consequences without promising simulation that is not present.

## Verification

`tests/story.test.mjs` checks all cast, rogue, and city-landmark references; preserves the original twelve save identities; and walks all fifteen chapters with both decisions and a legacy profile with no decision. It also verifies that branches do not mutate shared chapter data, destinations remain ordered, route countdowns are visible, and a final-gate arrival on the deadline succeeds. These are runner and data checks; they do not replace human assessment of combat difficulty or prose.
