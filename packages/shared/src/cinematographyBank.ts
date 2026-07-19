/* The Cinematography Prompt Bible (videofast/docs/cinematography.md, vault
 * doc 26) transcribed as structured data — the curated bank the studio.bible
 * import installs into a project's bible. Hand-structured on purpose: the doc
 * is locked series grammar, and structured-once beats a brittle markdown
 * parser. Entry ids are the vocabulary shot specs use ("ws", "push-in",
 * "concert.follow-spot"); clauses are the doc's paste-in prompt language,
 * kept channel-agnostic except danceSignatures (Animal Sitcom cast). */

import type { BibleCinematography } from "./index.js";

export const CINEMATOGRAPHY_BANK: BibleCinematography = {
  shotSizes: [
    {
      id: "ecu",
      name: "ECU — extreme close-up",
      clause: "extreme close-up on the detail, filling the frame, shallow depth of field",
      use: "Maximum tension, the 'uh-oh' — the peak freeze, the finger over the device",
    },
    {
      id: "cu",
      name: "CU — close-up",
      clause:
        "close-up of the character's face, expressive eyes, shallow depth of field, background softly blurred",
      use: "Emotion and reaction beats; lipsync dialogue punch-ins",
    },
    {
      id: "mcu",
      name: "MCU — medium close-up",
      clause: "medium close-up, head and shoulders framing",
      use: "Standard talking shot — dialogue with feeling",
    },
    {
      id: "ms",
      name: "MS — medium shot",
      clause: "medium shot from the waist up, hands visible and gesturing",
      use: "Argument beats — dialogue plus gesture",
    },
    {
      id: "mws",
      name: "MWS — medium wide / cowboy",
      clause: "medium wide shot framing the character from mid-thigh up, confident stance",
      use: "Stance, attitude, standoffs — the face-off beat",
    },
    {
      id: "ws",
      name: "WS — wide / full shot",
      clause: "wide shot, full body visible head to toe with room to move",
      use: "Physical comedy and EVERY dance move — choreography dies if feet are cropped",
    },
    {
      id: "ews",
      name: "EWS — extreme wide / establishing",
      clause: "extreme wide establishing shot, tiny figures dwarfed by the vast environment",
      use: "Scale, place, loneliness — cold-open establisher, crew-vs-the-world poster shots",
    },
  ],

  angles: [
    {
      id: "low",
      name: "Low angle",
      clause: "low-angle shot looking up at the subject, towering",
      use: "Power, dominance",
    },
    {
      id: "high",
      name: "High angle",
      clause: "high-angle shot looking down at the subject",
      use: "Small, vulnerable — anxiety spirals",
    },
    {
      id: "eye",
      name: "Eye level",
      clause: "eye-level shot",
      use: "Neutral, honest — default dialogue, at each character's OWN eye level",
    },
    {
      id: "dutch",
      name: "Dutch angle",
      clause: "tilted dutch angle, the frame off-kilter",
      use: "Wrongness, chaos — peak absurdity right before the freeze",
    },
    {
      id: "overhead",
      name: "Overhead / top-down",
      clause: "directly overhead top-down shot",
      use: "God view, choreography — Busby-Berkeley dance formations",
    },
    {
      id: "ground",
      name: "Ground level",
      clause: "camera at floor level, low to the ground",
      use: "Scrappy energy — floorwork, feet inserts",
    },
  ],

  moves: [
    {
      id: "static",
      name: "Static / locked-off",
      clause: "static camera, locked-off shot, no camera movement",
      use: "Deadpan, observation — dialogue beats, the outro. Sitcom comedy is MOSTLY static",
    },
    {
      id: "push-in",
      name: "Slow push-in",
      clause: "slow smooth push-in toward the subject",
      use: "Rising tension, 'listen closely' — escalation beats",
    },
    {
      id: "pull-back",
      name: "Slow pull-back",
      clause: "camera slowly pulls back, revealing the wider scene",
      use: "Reveal, aftermath, isolation — the mess after the argument",
    },
    {
      id: "pan",
      name: "Pan",
      clause: "smooth pan across the scene",
      use: "Following, comparing — panning across reaction faces",
    },
    {
      id: "tilt",
      name: "Tilt",
      clause: "slow tilt upward from low to high",
      use: "Scale, reveal height — the giraffe neck gag",
    },
    {
      id: "tracking",
      name: "Tracking / dolly alongside",
      clause: "tracking shot moving alongside the subject as they move",
      use: "Momentum, journey — following a strut down the hallway",
    },
    {
      id: "orbit",
      name: "Orbit / arc",
      clause: "camera orbits slowly around the subject",
      use: "Grandeur, 'the world revolves around them' — hero poses, the drop",
    },
    {
      id: "crane-up",
      name: "Crane / boom up",
      clause: "camera cranes upward, rising above the scene",
      use: "Triumph, ascension, finale — the final crew formation",
    },
    {
      id: "crane-down",
      name: "Crane down",
      clause: "camera descends from above, settling at eye level",
      use: "Descending into intimacy — cold-open entry into the argument",
    },
    {
      id: "handheld",
      name: "Handheld",
      clause: "handheld camera with subtle shake",
      use: "Nervous energy, chaos, realism — panic POV, peak chaos beats",
    },
    {
      id: "whip-pan",
      name: "Whip pan",
      clause: "fast whip pan to the subject",
      use: "Comedy cut, sudden attention — snap to whoever said the outrageous thing",
    },
    {
      id: "snap-zoom",
      name: "Snap zoom",
      clause: "sudden quick zoom in on the subject's face",
      use: "Comic emphasis, mockumentary — The Office reaction punch",
    },
    {
      id: "dolly-zoom",
      name: "Dolly zoom (vertigo)",
      clause: "dolly zoom, background warping while the subject stays fixed",
      use: "Dread, realization, the world tilts",
    },
    {
      id: "aerial",
      name: "Aerial / drone",
      clause: "sweeping aerial shot high above the environment",
      use: "Epic scale, geography — establishers, Dune-scale openings",
    },
    {
      id: "pov",
      name: "POV",
      clause: "first-person POV shot from the character's eyes",
      use: "Subjectivity — scanning the room for threats",
    },
    {
      id: "rise-orbit",
      name: "Rise + orbit (hero combo)",
      clause: "camera slowly orbits and rises around the subject",
      use: "Music-video money shot — SEEDANCE HERO ONLY; the one allowed compound move",
    },
  ],

  lenses: [
    {
      id: "shallow",
      name: "Shallow depth of field",
      clause: "shallow depth of field, background softly blurred, bokeh",
      use: "Intimacy, hero close-ups (85mm feel)",
    },
    {
      id: "deep",
      name: "Deep focus",
      clause: "deep focus, everything sharp front to back",
      use: "Comedy blocking — gags in the background must read",
    },
    {
      id: "wide-angle",
      name: "Wide-angle",
      clause: "wide-angle lens, slight distortion, exaggerated perspective",
      use: "Comic energy, cramped-room feeling, looming low angles",
    },
    {
      id: "telephoto",
      name: "Telephoto compression",
      clause: "telephoto compression, layers stacked flat",
      use: "The Dune army-of-figures look; crowds behind the crew",
    },
    {
      id: "anamorphic",
      name: "Anamorphic",
      clause: "anamorphic lens, subtle horizontal lens flare, oval bokeh, cinemascope",
      use: "Instant 'expensive movie'",
    },
    {
      id: "film-grain",
      name: "35mm film texture",
      clause: "35mm film grain, cinematic color grading",
      use: "General film texture — use in the still, keep video prompts lean",
    },
    {
      id: "macro",
      name: "Macro detail",
      clause: "macro lens detail",
      use: "The ECU on the device button",
    },
  ],

  compositions: [
    {
      id: "thirds",
      name: "Rule of thirds",
      clause: "subject positioned off-center on one third, looking into the open space",
      use: "Natural, alive — emotional beats",
    },
    {
      id: "symmetry",
      name: "Center-frame symmetry",
      clause: "perfectly centered symmetrical composition, subject facing camera",
      use: "Formal, powerful, comic deadpan — the HOUSE STYLE for comedy beats",
    },
    {
      id: "leading-lines",
      name: "Leading lines",
      clause: "converging lines of the environment leading the eye to the subject",
      use: "Eye control",
    },
    {
      id: "depth-layers",
      name: "Depth layers",
      clause:
        "foreground element out of focus, subject in midground, background in the distance",
      use: "3D richness — AI loves this",
    },
    {
      id: "negative-space",
      name: "Negative space",
      clause: "small figure in the corner of the frame, vast empty space around them",
      use: "Loneliness, scale, minimal poster look",
    },
    {
      id: "frame-in-frame",
      name: "Frame within frame",
      clause: "seen through a doorway, framed by the door edges",
      use: "Voyeurism, focus",
    },
    {
      id: "headroom",
      name: "Headroom / lead room",
      clause: "natural headroom, space in the direction the subject faces",
      use: "Professional polish",
    },
    {
      id: "triangle",
      name: "Trio triangle",
      clause: "three characters in a triangular arrangement, staggered in depth",
      use: "Blocking a trio — small in front, tall behind",
    },
    {
      id: "v-formation",
      name: "Crew V formation",
      clause:
        "six characters in a V formation opening toward camera, tallest at the back center",
      use: "Full-crew blocking",
    },
    {
      id: "depth-line",
      name: "Depth line",
      clause: "characters staggered along a diagonal receding into the frame",
      use: "Size gradient doubles the perspective",
    },
  ],

  lighting: [
    {
      id: "dune",
      name: "The Dune bank",
      use: "Scale, austerity, awe — epic-ironic establishers, poster shots, moments that need weight",
      entries: [
        {
          id: "hard-sun",
          name: "Hard desert sun",
          clause: "harsh top-down sunlight, short brutal shadows, blinding sky",
          use: "",
        },
        {
          id: "silhouette",
          name: "Silhouette scale",
          clause: "figures in silhouette against a bright hazy horizon, vast negative space",
          use: "",
        },
        {
          id: "haze",
          name: "Atmospheric depth",
          clause: "thick atmospheric haze, dust hanging in the air, layers fading into brightness",
          use: "",
        },
        {
          id: "monochrome",
          name: "Monochrome austerity",
          clause: "muted monochromatic palette, sand and bone tones, desaturated",
          use: "",
        },
        {
          id: "light-shaft",
          name: "Sacred interior",
          clause: "single shaft of light cutting through darkness, dust motes swirling in the beam",
          use: "",
        },
        {
          id: "golden-dust",
          name: "Golden apocalypse",
          clause: "low golden sun through dust, long stretched shadows, warm ochre haze",
          use: "",
        },
      ],
    },
    {
      id: "avatar",
      name: "The Avatar bank",
      use: "Wonder, bioluminescence, living light — night sets, dream beats, the night dance drop",
      entries: [
        {
          id: "biolum",
          name: "Bioluminescent night",
          clause:
            "bioluminescent plants glowing cyan and magenta in the darkness, soft ambient glow on the characters",
          use: "",
        },
        {
          id: "canopy",
          name: "Canopy light",
          clause: "dappled sunlight filtering through the jungle canopy, shifting patches of light",
          use: "",
        },
        {
          id: "rim-moon",
          name: "Cool rim light",
          clause: "cool blue moonlight rim-lighting the fur, edges glowing against the dark",
          use: "",
        },
        {
          id: "spores",
          name: "Floating particles",
          clause: "glowing spores drifting through the air, catching the light",
          use: "",
        },
        {
          id: "caustics",
          name: "Water light",
          clause: "rippling water caustics playing across the scene",
          use: "",
        },
        {
          id: "magic-hour",
          name: "Magic hour",
          clause: "warm golden magic-hour light, soft and directional, long soft shadows",
          use: "",
        },
      ],
    },
    {
      id: "sitcom",
      name: "The sitcom bank",
      use: "Everyday warmth vs institutional cold — arguments live in colder light than resolutions",
      entries: [
        {
          id: "warm-home",
          name: "Warm home",
          clause: "warm practical lamps, soft golden interior light, cozy evening glow",
          use: "",
        },
        {
          id: "cold-office",
          name: "Cold institution",
          clause: "flat cold fluorescent office lighting, slightly green, shadowless",
          use: "Conflict light — the argument register",
        },
        {
          id: "morning",
          name: "Morning kitchen",
          clause: "soft morning window light streaming in, bright and airy, high-key",
          use: "",
        },
        {
          id: "neutral",
          name: "TV-comedy neutral",
          clause: "even high-key lighting, soft shadows, clean and bright",
          use: "",
        },
        {
          id: "deadpan",
          name: "Awkward-pause light",
          clause: "unchanging flat light, nothing moves",
          use: "Deadpan is a lighting choice too",
        },
      ],
    },
    {
      id: "concert",
      name: "The concert bank",
      use: "The Drop, dance numbers, concert videos — the most saturated light of the episode",
      entries: [
        {
          id: "ignition",
          name: "The drop ignition",
          clause: "stage lights slamming on, colored beams sweeping, haze in the air",
          use: "",
        },
        {
          id: "strobe",
          name: "Strobe energy",
          clause: "strobing lights freezing dance poses mid-motion",
          use: "",
        },
        {
          id: "silhouette-intro",
          name: "Silhouette intro",
          clause: "dancer silhouetted against a wall of blinding backlight and haze",
          use: "",
        },
        {
          id: "color-wash",
          name: "Color wash",
          clause: "saturated magenta and cyan stage wash, colored gels, glowing haze",
          use: "",
        },
        {
          id: "follow-spot",
          name: "Follow spot",
          clause: "single hard spotlight isolating the subject on a dark stage",
          use: "",
        },
        {
          id: "bulb-wall",
          name: "Golden bulbs",
          clause: "warm tungsten bulb wall glowing behind the stage, lens flares",
          use: "",
        },
        {
          id: "led-floor",
          name: "Floor + underlight",
          clause: "LED dance floor glowing beneath the dancers, underlighting their moves",
          use: "",
        },
      ],
    },
    {
      id: "universal",
      name: "Universal vocabulary",
      use: "Works everywhere",
      entries: [
        {
          id: "three-point",
          name: "Three-point",
          clause: "three-point lighting, soft key light",
          use: "",
        },
        {
          id: "chiaroscuro",
          name: "Dramatic side light",
          clause: "dramatic side lighting, half the face in shadow, chiaroscuro",
          use: "",
        },
        {
          id: "rim",
          name: "Rim / backlight",
          clause: "rim light separating the subject from the background",
          use: "",
        },
        {
          id: "god-rays",
          name: "God rays",
          clause: "volumetric god rays",
          use: "",
        },
        {
          id: "low-key",
          name: "Low-key",
          clause: "low-key lighting, deep shadows, high contrast",
          use: "",
        },
        {
          id: "high-key",
          name: "High-key",
          clause: "high-key lighting, bright, minimal shadows",
          use: "",
        },
        {
          id: "golden-hour",
          name: "Golden / blue hour",
          clause: "golden hour light, long warm shadows",
          use: "",
        },
        {
          id: "neon-wet",
          name: "Neon on wet pavement",
          clause: "neon signs reflecting on wet pavement",
          use: "",
        },
        {
          id: "firelight",
          name: "Firelight",
          clause: "firelight flickering warm and unsteady",
          use: "",
        },
        {
          id: "underlight",
          name: "Underlighting",
          clause: "underlighting, eerie light from below",
          use: "Halloween-episode fuel",
        },
      ],
    },
  ],

  danceSignatures: [
    {
      character: "Sterling",
      danceStyle: "Ballroom / waltz, mane flips",
      camera: "Sweeping orbit — the camera waltzes with him",
      clause:
        "smooth steadicam orbit circling the lion as he waltzes, wide shot, full body, his mane sweeping with each turn",
    },
    {
      character: "Grant",
      danceStyle: "Locking / tutting, high steps",
      camera: "Locked-off symmetrical wide — precision frame for precision moves",
      clause:
        "static locked-off wide shot, perfectly centered symmetrical composition, the giraffe hitting sharp tutting angles with his long limbs",
    },
    {
      character: "Milo",
      danceStyle: "Fast jittery popping, quick spins",
      camera: "Snap zooms & whip pans — camera as twitchy as he is",
      clause:
        "quick snap zoom punching in on the meerkat's rapid popping footwork, energetic, fast motion",
    },
    {
      character: "Bruno",
      danceStyle: "Grounded hip-hop, body rolls",
      camera: "Low-angle slow push — weight and mass",
      clause:
        "low-angle shot pushing in slowly on the gorilla's grounded hip-hop groove, his body rolls filling the frame, powerful",
    },
    {
      character: "Jax",
      danceStyle: "Contemporary / lyrical, leaps",
      camera: "Crane rising — the camera takes flight with him",
      clause:
        "camera cranes upward following the eagle's leap, wing-arms extended in a flight shape, rising and graceful",
    },
    {
      character: "Barney",
      danceStyle: "Salsa / rumba waves, floorwork",
      camera: "Floor-level slinky dolly — moves like he does",
      clause:
        "floor-level tracking shot gliding sideways alongside the snake's salsa body waves and floorwork, smooth and slinky",
    },
  ],

  formations: [
    {
      id: "overhead-kaleidoscope",
      name: "The overhead kaleidoscope",
      clause:
        "directly overhead top-down shot of the six-animal formation, geometric choreography pattern, LED floor glowing beneath them",
      use: "The Busby-Berkeley money frame",
    },
    {
      id: "formation-wide",
      name: "The formation wide",
      clause:
        "static wide shot of the whole crew in V formation dancing in sync, giraffe at the back center, meerkat at the front, full bodies visible, stage wash and haze",
      use: "The spine of every dance number — cut everything else against this",
    },
    {
      id: "finale-crane",
      name: "The finale crane",
      clause:
        "camera cranes up and back from the final synchronized pose as all six freeze, lights blazing",
      use: "The closer",
    },
  ],

  templates: {
    keyframe:
      "{SHOT_SIZE} {ANGLE} of {NAME}, {ACTION_POSE}, in {SETTING}, {COMPOSITION}, {LIGHTING}, {LENS}, {STYLE}",
    ltxCoverage:
      "{SHOT_SIZE} of {NAME} {ONE_ACTION}, in {SETTING}, {LIGHTING_CONTINUITY}, {ONE_CAMERA_MOVE}, {MOTION_ENERGY} motion.",
    transitionMorph:
      "{SHOT_SIZE} of {SUBJECT_A_STATE}; {THE_TRANSFORMATION_PROCESS} into {SUBJECT_B_STATE}, {LIGHTING_SHIFT}, seamless continuous motion. zhuanchang",
    seedanceHero: "{CAMERA_MOVE_WITH_SPEED}, {SUBJECT_PEAK_ACTION}, {LIGHT_EVENT}, {ENDING_BEAT}",
  },

  rules: [
    "Write full sentences, never keyword lists.",
    "ONE camera move and ONE lighting logic per 5s clip — two moves = AI mush. Static is a choice, not a failure; sitcom comedy is mostly static.",
    "In i2v the locked still already decided composition and lighting — the video prompt's only job is motion, and it must AGREE with the still (contradicting it causes morphing).",
    "Name the framing again (wide shot, close-up) even in i2v — it anchors against drift; say 'static camera, no camera movement' explicitly when you want stillness.",
    "One shot size per clip; progression = tension (wide→close), release = the reverse.",
    "Dance is never tighter than WS except deliberate inserts cut against the wide.",
    "Pick the move by the feeling: tension→push-in, release→pull-back/crane up, power→low angle+slow push, anxiety→handheld, comedy→static/whip pan/snap zoom, glory→orbit, realization→dolly zoom.",
    "Speed words are the energy dial: slow/smooth/gentle = cinematic, fast/sudden/quick = comedic; LTX defaults gentle — say 'dynamic, fast, energetic motion' when needed.",
    "Lighting = quality + direction + color + atmosphere; arguments live in colder light than resolutions; the drop goes flattest-coldest → most saturated.",
    "Center-frame symmetry is the house style for comedy beats, rule of thirds for emotional beats, full asymmetric dynamism only in dance.",
    "180° rule: keep each character facing one screen direction across a scene's keyframes.",
    "Shoot each character at their OWN eye level and cut between them — the eyeline mismatch is the joke.",
    "Compound moves (orbit+rise) are Seedance-hero only — one composite idea, reusing the same motion words as the LTX coverage.",
  ].join("\n"),

  negativePrompt:
    "blurry, deformed, extra limbs, morphing body parts, warping face, inconsistent character, off-model, jittery flicker, frame jumping, text, watermark, low detail, mutated hands, duplicated face",
};
