/**
 * Meridian's cast. Public trust, emergency work and who gets counted by a city.
 * Keep motives legible before a reveal: nobody needs a time-travel explanation.
 */
export interface CastMember {
  id: string;
  name: string;
  short: string;
  role: string;
  color: string;
  bio: string;
}

export const CAST: Record<string, CastMember> = {
  nolan: {
    id: "nolan", name: "Nolan Reyes", short: "Nolan", color: "#e8a53c",
    role: "Municipal courier · volunteer responder",
    bio: "Nolan knows Meridian by the addresses that delivery apps refuse. When a bridge relay failed, " +
      "he pulled a maintenance worker clear and took its resonance discharge through his body. " +
      "Two hours later, he could outrun an ambulance. He would like to know why he has to.",
  },
  wren: {
    id: "wren", name: "Dr. Wren Adeyemi", short: "Wren", color: "#bfe6f2",
    role: "Emergency physician · Meridian General",
    bio: "Wren runs a clinic on the city's least reliable power circuit. She treats Nolan as a patient " +
      "with a dangerous new job, not an experiment. She has kept a handwritten record of every " +
      "outage since the official one stopped matching her ward.",
  },
  teo: {
    id: "teo", name: "Mateo Salcedo", short: "Teo", color: "#7fd8a0",
    role: "Transit maintenance engineer",
    bio: "A shift engineer who keeps obsolete equipment working because people still depend on it. " +
      "Teo adapted a rescue suit to bleed off Nolan's heat. He distrusts a system with no manual " +
      "override and a repair nobody can do with the tools they own.",
  },
  solomon: {
    id: "solomon", name: "Solomon Kade", short: "Kade", color: "#d6b483",
    role: "Dispatcher · Precinct Seven emergency desk",
    bio: "Twenty-four years of dispatch, including the transition to automated priority routing. " +
      "He signed off on a shorter response-time target and is beginning to ask who disappeared " +
      "from the average. His house is the neighborhood's unofficial charging station.",
  },
  nadia: {
    id: "nadia", name: "Nadia Kade", short: "Nadia", color: "#f2a8c0",
    role: "Reporter · The Meridian Ledger",
    bio: "Nadia covers municipal contracts, which become more interesting when somebody tries to " +
      "destroy them. She checks her father's dispatch records as hard as anybody else's. She " +
      "wants testimony people can challenge, not a hero's version of the night.",
  },
  vance: {
    id: "vance", name: "Dr. Aldous Vance", short: "Vance", color: "#8fd0ff",
    role: "Architect · Halcyon Priority Grid",
    bio: "Built a resonance network to keep hospitals and transit alive through outages. He accepted " +
      "premium routing to pay for expansion, then let expansion become the excuse for every " +
      "exception. He is publicly responsible, technically useful and not entitled to forgiveness.",
  },
  sable: {
    id: "sable", name: "Captain Imogen Sable", short: "Sable", color: "#a9b6bf",
    role: "Meridian Emergency Coordination",
    bio: "Responsible for keeping evacuation routes open when the routing network itself becomes " +
      "the hazard. She initially mistakes one very fast responder for spare capacity. Her job " +
      "becomes learning to build a plan that survives his absence.",
  },
  vantage: {
    id: "vantage", name: "Iona Vale", short: "Vantage", color: "#f5c542",
    role: "Former rescue commander · Vantage operator",
    bio: "Iona trained Meridian's rescue crews until her district was repeatedly denied backup. " +
      "Her predictive suit reads the city's routing grid and intercepts a runner before he turns. " +
      "She plans to destroy centralized priority control, even if the blackout harms the people " +
      "she once promised to protect.",
  },
  elena: {
    id: "elena", name: "Elena Reyes", short: "Elena", color: "#ffd9a0",
    role: "Resident coordinator · Westhaven",
    bio: "Nolan's mother organizes a residents' phone tree, knows whose lift stops in an outage, " +
      "and refuses to describe doing essential work without a budget as resilience.",
  },
  marcus: {
    id: "marcus", name: "Marcus Reyes", short: "Marcus", color: "#b9a184",
    role: "Retired ferry mechanic · Saltmere",
    bio: "Nolan's father maintains the harbor's community launch. He is proud of his son and " +
      "worried that the city will find it cheaper to depend on him than to fix anything.",
  },
  kiln: {
    id: "kiln", name: "Roland Boyce", short: "Kiln", color: "#f18c55",
    role: "Demolition contractor · Kiln operator",
    bio: "Roland's industrial heat rig destroys a relay in seconds. The contracts behind his work " +
      "matter more than the codename: somebody pays him to make outages look accidental.",
  },
  gale: {
    id: "gale", name: "Margo Sable", short: "Gale", color: "#a7d6e8",
    role: "Pressure-systems specialist",
    bio: "Margo designed ventilation for transit tunnels. She now uses a stolen pressure rig to " +
      "disable emergency cooling. She believes a controlled failure will force a repair; her " +
      "definition of controlled does not include the people underneath it.",
  },
  coldsnap: {
    id: "coldsnap", name: "Cassian Vok", short: "Coldsnap", color: "#b6dafa",
    role: "Containment specialist",
    bio: "Cassian carries a damping field designed for dangerous resonance equipment. He hires it " +
      "out to anyone who wants a street nobody can cross. He understands a public emergency, " +
      "but tends to invoice it first.",
  },
};

export function speaker(id: string): CastMember {
  const found = CAST[id];
  if (!found) throw new Error(`Unknown cast member "${id}".`);
  return found;
}
