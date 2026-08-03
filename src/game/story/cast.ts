/**
 * The people of Meridian City.
 *
 * A note for future contributors: this cast is shaped like a serialised
 * superhero drama on purpose — the lab accident, the team in the basement,
 * the detective who raised him, the reporter who names him, the mentor with a
 * secret — but every name, organisation and power here is original to this
 * project. Keep it that way. See the asset policy in the README.
 */

export interface CastMember {
  id: string;
  name: string;
  /** How the HUD labels them when they speak. */
  short: string;
  role: string;
  /** Speech colour, used by the dialogue panel. */
  color: string;
  bio: string;
}

export const CAST: Record<string, CastMember> = {
  nolan: {
    id: "nolan",
    name: "Nolan Reyes",
    short: "Nolan",
    role: "Forensic technician, MCPD Precinct Seven",
    color: "#e8a53c",
    bio:
      "Twenty-seven, chronically late, unusually good at telling you what happened in a room " +
      "from the dust in it. He was on the precinct roof logging evidence when the resonance " +
      "front came down the antenna mast. He woke up eleven months later.",
  },
  vance: {
    id: "vance",
    name: "Dr. Aldous Vance",
    short: "Vance",
    role: "Founder, Halcyon Labs",
    color: "#8fd0ff",
    bio:
      "Built the resonance ring, lost the use of his legs the night it failed, and lost the " +
      "city's goodwill the morning after. Speaks to Nolan like a man who already knows how " +
      "the story ends and is being careful not to spoil it.",
  },
  wren: {
    id: "wren",
    name: "Dr. Wren Adeyemi",
    short: "Wren",
    role: "Bio-physicist, Halcyon Labs",
    color: "#bfe6f2",
    bio:
      "Kept Nolan breathing for eleven months and has never once said she is glad she did. " +
      "Her fiancé Aaron was inside the ring room when it went. She has not moved his coat.",
  },
  teo: {
    id: "teo",
    name: "Mateo Salcedo",
    short: "Teo",
    role: "Mechanical engineer, Halcyon Labs",
    color: "#7fd8a0",
    bio:
      "Built the suit out of firefighter tri-polymer, a stolen heat-exchange lattice and " +
      "roughly nine hundred hours he will never get back. Names every rogue. Nobody asked " +
      "him to. Nobody has managed to stop him.",
  },
  solomon: {
    id: "solomon",
    name: "Detective Solomon Kade",
    short: "Kade",
    role: "MCPD, Precinct Seven",
    color: "#d6b483",
    bio:
      "Took Nolan in at eleven, the week the state took his father. Has spent sixteen years " +
      "not saying the thing he thinks about that case. Does not believe in metahumans, which " +
      "is going to be a problem.",
  },
  nadia: {
    id: "nadia",
    name: "Nadia Kade",
    short: "Nadia",
    role: "Reporter, The Meridian Ledger",
    color: "#f2a8c0",
    bio:
      "Solomon's daughter, Nolan's foster sister, and the only person in Meridian filing " +
      "copy about the blur downtown. She named him in print before the lab named him in the " +
      "basement, which Teo has still not forgiven.",
  },
  sable: {
    id: "sable",
    name: "Captain Imogen Sable",
    short: "Sable",
    role: "MCPD, Metahuman Response",
    color: "#a9b6bf",
    bio:
      "Runs a task force she does not believe should exist, competently, out of spite. " +
      "Wants the blur on a payroll or in a cell and is genuinely undecided which.",
  },
  vantage: {
    id: "vantage",
    name: "Vantage",
    short: "Vantage",
    role: "Unknown",
    color: "#f5c542",
    bio:
      "Bone-white and gold, and everything about him arrives a half-second before he does. " +
      "He is not from now. He has been waiting a very long time for someone to be fast enough " +
      "to be useful.",
  },
  elena: {
    id: "elena",
    name: "Elena Reyes",
    short: "Elena",
    role: "Nolan's mother",
    color: "#ffd9a0",
    bio: "Died on a Tuesday in October, twenty-two years ago, in a kitchen full of light that had no source.",
  },
  marcus: {
    id: "marcus",
    name: "Marcus Reyes",
    short: "Marcus",
    role: "Ironvale Correctional, inmate 41103",
    color: "#b9a184",
    bio:
      "Convicted of his wife's murder on physical evidence that made no sense to anyone, " +
      "including the technician who eventually re-read it at superhuman speed. Stopped " +
      "protesting his innocence in year nine.",
  },
};

export function speaker(id: string): CastMember {
  const found = CAST[id];
  if (!found) throw new Error(`Unknown cast member "${id}".`);
  return found;
}
