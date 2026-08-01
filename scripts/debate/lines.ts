/* Three dialogue-only micro-scenes for the Zoo Logic cast — no on-screen text,
 * no captions, no narrator. The argument carries the video.
 *
 * The brief this encodes:
 *   V1  three characters on set, TWO of them talk           (Bruno never speaks)
 *   V2  four characters on set, THREE of them talk          (Silas never speaks)
 *   V3  three talk, then two more walk in and talk too      (5 on set by shot 2)
 *
 * Everything downstream (VO, boards, shots, assembly) reads this file, so a
 * line change lands in one place and the beat maths re-derives itself. */

export interface Line {
  /** bible character id */
  who: string;
  text: string;
  /** what the character is DOING while they say it — becomes the prompt zone.
   * Every other character in the shot must be told MOUTH CLOSED in the same
   * beat, otherwise LTX spreads the lipsync across the whole cast. */
  action: string;
  /** chatterbox exaggeration for this delivery */
  emotion?: number;
}

export interface Shot {
  slug: string;
  /** which board (see boards.ts) this shot starts from */
  board: string;
  /** everyone visible, in reference-sheet order */
  cast: string[];
  /** the set, one sentence — stays SCENE-first so the ref sheet can't out-vote it */
  scene: string;
  lines: Line[];
}

export interface Video {
  slug: string;
  title: string;
  /** what the video is arguing about — notes only, never rendered */
  topic: string;
  shots: Shot[];
}

/* ---------------------------------------------------------------- video 1 */
/* Capitalism vs communism, fought over the communal coffee fund. Sterling
 * defends the market, Milo wants the pot. Bruno is present, holding a mug,
 * and never says a word — the brief's "third character who doesn't talk". */

const BREAKROOM =
  "An office breakroom in warm late-afternoon light, coffee machine on the counter, " +
  "window blinds behind";

const V1: Video = {
  slug: "coffee-fund",
  title: "The Coffee Fund",
  topic: "capitalism vs communism",
  shots: [
    {
      slug: "coffee-fund-a",
      board: "breakroom-trio",
      cast: ["sterling", "milo", "bruno"],
      scene:
        BREAKROOM +
        ". A lion in a tailored waistcoat and a small meerkat in a track jacket face each " +
        "other across the counter, a big gorilla behind them holding a mug. Static three-shot, waist up.",
      lines: [
        {
          who: "sterling",
          emotion: 0.6,
          text: "The coffee fund is voluntary, Milo. Whoever drinks it, pays for it. That is the entire system.",
          action:
            "Sterling the lion is talking — mouth moving, plummy and patient, one paw resting flat on the counter. " +
            "Milo the meerkat listens with his MOUTH CLOSED, vibrating slightly. Bruno the gorilla stands behind " +
            "them holding a mug, MOUTH CLOSED, watching.",
        },
        {
          who: "milo",
          emotion: 0.85,
          text: "Voluntary? You bought the machine, and you set the price. That's not a market, that's a landlord.",
          action:
            "Milo the meerkat is talking — mouth moving fast, both paws up, jabbing at the coffee machine. " +
            "Sterling the lion watches him with his MOUTH CLOSED, brow raised. Bruno the gorilla behind them " +
            "sips from his mug, MOUTH CLOSED.",
        },
      ],
    },
    {
      slug: "coffee-fund-b",
      board: "breakroom-trio-2",
      cast: ["sterling", "milo", "bruno"],
      scene:
        BREAKROOM +
        ". A small meerkat in a track jacket and a lion in a tailored waistcoat argue across the " +
        "counter, a big gorilla behind them holding a mug. Static three-shot, waist up.",
      lines: [
        {
          who: "milo",
          emotion: 0.8,
          text: "Pool it. Everyone pays four euros, everyone drinks, nobody counts cups.",
          action:
            "Milo the meerkat is talking — mouth moving, chopping one paw into the other palm, urgent. " +
            "Sterling the lion listens with his MOUTH CLOSED, unimpressed. Bruno the gorilla stands behind " +
            "them, MOUTH CLOSED, looking into his mug.",
        },
        {
          who: "sterling",
          emotion: 0.55,
          text: "And by Thursday the pot is empty, and nobody knows whose fault that is.",
          action:
            "Sterling the lion is talking — mouth moving, dry and unhurried, tipping his head toward the empty pot. " +
            "Milo the meerkat stares at him, MOUTH CLOSED, deflating. Bruno the gorilla behind them keeps drinking, " +
            "MOUTH CLOSED.",
        },
      ],
    },
  ],
};

/* ---------------------------------------------------------------- video 2 */
/* Feminism vs liberalism in a policy meeting. Allistaire argues procedural
 * neutrality, Valentino argues that neutral rules on an unequal floor just
 * formalise the tilt, Omar keeps moving the question. Silas sits in and never
 * speaks — the brief's fourth, silent character. */

const MEETING =
  "A small office meeting room in cool daylight, long table, whiteboard behind, blinds on the far wall";

const V2: Video = {
  slug: "the-committee",
  title: "The Committee",
  topic: "feminism vs liberalism",
  shots: [
    {
      slug: "committee-a",
      board: "meeting-quartet",
      cast: ["alli", "valentino", "omar", "silas"],
      scene:
        MEETING +
        ". A compact penguin in a tactical vest, a large hippo in a floral silk robe, a big elephant " +
        "in a linen shirt and a lean tiger in a hooded denim jacket sit around the table. " +
        "Static four-shot, waist up.",
      lines: [
        {
          who: "alli",
          emotion: 0.6,
          text: "The policy is neutral. Same rules, same forms, same panel for everyone. That is fairness.",
          action:
            "Allistaire the penguin is talking — beak moving, crisp and commanding, one flipper flat on the table. " +
            "Valentino the hippo listens with MOUTH CLOSED, one brow arched. Omar the elephant and Silas the tiger " +
            "sit still with their MOUTHS CLOSED.",
        },
        {
          who: "valentino",
          emotion: 0.85,
          text: "Darling, neutral rules on an unequal floor just make the tilt official.",
          action:
            "Valentino the hippo is talking — mouth moving, plush and theatrical, one hand turning over in the air. " +
            "Allistaire the penguin watches with BEAK CLOSED, jaw set. Omar the elephant and Silas the tiger sit " +
            "still with their MOUTHS CLOSED.",
        },
      ],
    },
    {
      slug: "committee-b",
      board: "meeting-quartet-2",
      cast: ["omar", "valentino", "alli", "silas"],
      scene:
        MEETING +
        ". A big elephant in a linen shirt, a large hippo in a floral silk robe, a compact penguin in a " +
        "tactical vest and a lean tiger in a hooded denim jacket sit around the table. " +
        "Static four-shot, waist up.",
      lines: [
        {
          who: "omar",
          emotion: 0.45,
          text: "Mm. You are both arguing about the ladder. I am asking who built the wall.",
          action:
            "Omar the elephant is talking — mouth moving, slow and low, one hand spread on the table. " +
            "Valentino the hippo and Allistaire the penguin both turn to him with their MOUTHS CLOSED. " +
            "Silas the tiger sits back, MOUTH CLOSED.",
        },
        {
          who: "valentino",
          emotion: 0.8,
          text: "Finally. Someone in this room with an actual question.",
          action:
            "Valentino the hippo is talking — mouth moving, delighted, gesturing at Omar with an open hand. " +
            "Omar the elephant, Allistaire the penguin and Silas the tiger all keep their MOUTHS CLOSED, " +
            "Allistaire visibly annoyed.",
        },
      ],
    },
  ],
};

/* ---------------------------------------------------------------- video 3 */
/* Three arguing in the loft, then two more walk in and join — so shot B is
 * boarded from shot A's frame with Sterling and Milo added to it. */

const LOFT =
  "A warm cluttered warehouse loft in the evening, string lights overhead, battered sofa and mismatched furniture";

const V3: Video = {
  slug: "the-loft",
  title: "Who Built The Wall",
  topic: "capitalism vs communism, round two",
  shots: [
    {
      slug: "loft-a",
      board: "loft-trio",
      cast: ["grant", "jax", "barney"],
      scene:
        LOFT +
        ". A tall giraffe in a coach's zip-up, an eagle in a weathered flight jacket and a snake draped " +
        "over the sofa back are mid-argument. Static three-shot, waist up.",
      lines: [
        {
          who: "grant",
          emotion: 0.5,
          text: "Nobody works harder because a committee asked them to. They work harder because it's theirs.",
          action:
            "Grant the giraffe is talking — mouth moving, calm and level, one hand opening toward the room. " +
            "Jax the eagle listens with his BEAK CLOSED, unmoved. Barney the snake watches from the sofa back, " +
            "MOUTH CLOSED.",
        },
        {
          who: "jax",
          emotion: 0.55,
          text: "Or because the rent is due. Let's not dress that up as ambition.",
          action:
            "Jax the eagle is talking — beak moving, flat and unhurried, head tilting once. " +
            "Grant the giraffe listens with his MOUTH CLOSED. Barney the snake watches, MOUTH CLOSED, amused.",
        },
        {
          who: "barney",
          emotion: 0.75,
          text: "Ohhh, I love it when the bird gets bleak.",
          action:
            "Barney the snake is talking — mouth moving, slow drawl, coiling a little closer along the sofa back. " +
            "Grant the giraffe and Jax the eagle both keep their MOUTHS CLOSED, looking at him.",
        },
      ],
    },
    {
      slug: "loft-b",
      board: "loft-quintet",
      cast: ["grant", "jax", "barney", "sterling", "milo"],
      scene:
        LOFT +
        ". A tall giraffe, an eagle and a snake are joined by a lion in a tailored waistcoat and a small " +
        "meerkat in a track jacket who have just walked in. Static wide five-shot, waist up.",
      lines: [
        {
          who: "sterling",
          emotion: 0.6,
          text: "You've started without me. Again.",
          action:
            "Sterling the lion, just arrived, is talking — mouth moving, plummy and wounded, spreading both paws. " +
            "Grant the giraffe, Jax the eagle, Barney the snake and Milo the meerkat all keep their MOUTHS CLOSED, " +
            "turning toward him.",
        },
        {
          who: "milo",
          emotion: 0.85,
          text: "They started without you because you'd have made it about the coffee fund.",
          action:
            "Milo the meerkat is talking — mouth moving fast, thumbing back at Sterling. " +
            "Sterling the lion, Grant the giraffe, Jax the eagle and Barney the snake keep their MOUTHS CLOSED.",
        },
        {
          who: "barney",
          emotion: 0.7,
          text: "He's not wrong, cat.",
          action:
            "Barney the snake is talking — mouth moving, lazy drawl, tipping his head at Sterling. " +
            "Sterling the lion, Milo the meerkat, Grant the giraffe and Jax the eagle all keep their " +
            "MOUTHS CLOSED, Sterling looking betrayed.",
        },
      ],
    },
  ],
};

export const VIDEOS: Video[] = [V1, V2, V3];

export const ALL_SHOTS: Shot[] = VIDEOS.flatMap((v) => v.shots);

/** every line in render order, with a stable id used as the VO take key */
export function lineId(shot: Shot, index: number): string {
  return `${shot.slug}-${index}-${shot.lines[index].who}`;
}

export const PROJECT = "playground";

/* Beat maths. Gaps stay under 1.5s: LTX scores silence by inventing speech, so
 * a 2.7s hole becomes 1.75s of made-up dialogue with mouth movement to match. */
export const LEAD_IN = 0.4;
export const GAP = 0.7;
export const TAIL = 0.6;

export const RESOLUTION = "896 × 704";

/** Two failures this fights, both observed rather than imagined:
 *
 * · with a reference sheet in play LTX will happily render the SHEET — white
 *   ground, cells, labels — instead of the set;
 * · asked for "sitcom" light it renders a TELEVISION BROADCAST, station bug
 *   included: the first take of coffee-fund-a came back with a fake channel
 *   logo burned into the top-left corner. On a no-text brief that is fatal, so
 *   the word "sitcom" is gone from the prompts and every broadcast-overlay
 *   word we can name is in here. */
export function negativePrompt(base: string): string {
  return (
    (base ?? "") +
    ", reference sheet, contact sheet, character sheet, split screen, side-by-side portraits, " +
    "studio backdrop, plain white background, full-body turnaround, text, labels, captions, subtitles, " +
    "TV channel logo, station bug, broadcast overlay, on-screen graphics, chyron, lower third, " +
    "network ident, corner logo, watermark, letterboxing, black bars, banner, title card, credits"
  );
}
