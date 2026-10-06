/**
 * Every tunable in one place. Values come from PROJECT.md §5–§7 and DESIGN.md.
 * Nothing here may be duplicated inline elsewhere.
 */

export const APP_VERSION = '0.0.0';

/* ---------------------------------------------------------------- storage -- */

/**
 * Bumped to 2 when the n-gram dimensions were removed. v1 payloads are migrated by
 * dropping `bigrams`/`trigrams` (see `store/migrations.ts`), so an existing history
 * survives the schema change instead of being parked as corrupt.
 */
export const SCHEMA_VERSION = 2;
export const STORAGE_KEY = 'yskeys:v1:store';
export const BACKUP_KEY_PREFIX = 'yskeys:backup:';
/** Unreadable payloads are parked here instead of being overwritten. */
export const CORRUPT_KEY_PREFIX = 'yskeys:corrupt:';
export const MAX_SESSION_SUMMARIES = 200;

/**
 * Budget guard, measured in UTF-16 code units (`String.length`) because that is how
 * browsers account against the ~5 MB localStorage quota. Deliberately lower than the
 * 3 MB first sketched in PROJECT.md §5.3: 3 M code units is already ~6 MB of browser
 * accounting, which is past the quota on some browsers.
 */
export const MAX_PAYLOAD_CHARS = 2_000_000;

/** Checked before parsing, so a malformed 20 MB file cannot hang the page. */
export const MAX_IMPORT_CHARS = 20_000_000;

/** Rows shown per weak-spot table before "show all" (PROJECT.md F7). */
export const WEAK_TABLE_LIMIT = 15;

/** Below this many attempts a unit is flagged "low sample" in history (PROJECT.md F6). */
export const LOW_SAMPLE_ATTEMPTS = 10;

/** Weakest units listed on the session result view (PROJECT.md F3). */
export const RESULT_WEAK_LIMIT = 5;

/** Sessions plotted in the CPM trend. */
export const CHART_MAX_POINTS = 60;

/* ------------------------------------------------------------- word list -- */

/**
 * Its own storage key on purpose: history pruning and "clear all data" must never
 * remove a list the user had to go and download.
 */
export const WORDLIST_KEY = 'yskeys:v1:words';

/** A 10k frequency list is ~100 KB; a 479k dictionary is ~4.5 MB and would not fit. */
export const MAX_WORDLIST_CHARS = 1_000_000;

/** Words outside this range make poor typing practice. Two-letter words are kept: "of", "to" and "in" are among the most frequent English words. */
export const WORD_MIN_LENGTH = 2;
export const WORD_MAX_LENGTH = 16;

/** Below this many usable words, repeats dominate and the character drill is better. */
export const MIN_USABLE_WORDS = 25;

/** How often a word is title-cased when the uppercase charset is enabled. */
export const CAPITALIZE_PROBABILITY = 0.35;

/* --------------------------------------------------------- text/code source -- */

/**
 * Its own key for the same reason the word list has one: it is a file the user had to
 * go and fetch, so history pruning and "clear all data" must not remove it.
 */
export const TEXTSOURCE_KEY = 'yskeys:v1:text';

/**
 * A pasted repository is much bigger than a word list, but it does not all need to be
 * kept: only the normalised practice text is stored, and it is capped.
 */
export const MAX_TEXTSOURCE_CHARS = 1_000_000;

/** How much of an uploaded repository is kept, in characters of normalised text. */
export const MAX_SOURCE_TEXT_CHARS = 200_000;

/** Guard against a pathological upload: a 20 MB archive would be pointless to decode. */
export const MAX_ZIP_BYTES = 24_000_000;

/**
 * Runs longer than this are trimmed. A minified bundle or a data blob is one enormous
 * "line", and one chunk that long would swallow a whole drill.
 */
export const MAX_SOURCE_RUN_CHARS = 120;

/** Chunks are the unit of display for the text shape, so more than this is noise. */
export const MAX_SOURCE_CHUNKS = 20_000;

/**
 * The smallest run worth practising. Below this the drill degenerates into single
 * characters with a stray space, which the character sets already do better.
 */
export const MIN_SOURCE_RUN_CHARS = 2;

/**
 * A repository is mostly not source code. Extensions are matched case-insensitively;
 * anything else is counted as skipped rather than silently ignored.
 */
export const SOURCE_EXTENSIONS: readonly string[] = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css', '.scss', '.less',
  '.html', '.htm', '.vue', '.svelte', '.py', '.rb', '.go', '.rs', '.java', '.kt',
  '.c', '.h', '.cc', '.cpp', '.hpp', '.cs', '.php', '.swift', '.m', '.mm', '.scala',
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.sql', '.yml', '.yaml', '.toml', '.ini',
  '.cfg', '.conf', '.graphql', '.gql', '.proto', '.md', '.txt', '.rst', '.tex',
  '.lua', '.pl', '.r', '.dart', '.ex', '.exs', '.erl', '.hs', '.clj', '.elm',
  '.tf', '.hcl', '.gradle', '.properties', '.dockerfile', '.makefile', '.cmake',
];

/** A file name without an extension that is still a text file worth reading. */
export const SOURCE_FILENAMES: readonly string[] = ['dockerfile', 'makefile', 'cmakelists.txt'];

/** Directories whose contents are never practice material. Matched on any path segment. */
export const SOURCE_EXCLUDED_SEGMENTS: readonly string[] = [
  '.git', '.hg', '.svn', 'node_modules', 'dist', 'build', 'out', 'target', 'vendor',
  'coverage', '.next', '.nuxt', '.cache', '.venv', 'venv', '__pycache__', '.idea',
  '.vscode', 'bower_components', 'jspm_packages', '.terraform', 'Pods',
];

/** Names that are generated, minified or vendored, and so are not good practice text. */
export const SOURCE_EXCLUDED_FILES: readonly string[] = [
  'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'composer.lock', 'cargo.lock',
  'poetry.lock', 'gemfile.lock', 'go.sum',
];

/** Below this many drivable characters a file is not worth keeping. */
export const MIN_SOURCE_FILE_CHARS = 40;

/* ---------------------------------------------------------------- session -- */

export const GROUP_SIZE = 5;
export const SESSION_GROUP_COUNTS = [15, 30, 60] as const;
export const DEFAULT_GROUP_COUNT = 30;

/* ------------------------------------------------- accuracy smoothing (F6) -- */

/** Beta prior strength: one attempt can never produce 0% or 100%. */
export const SMOOTHING_ALPHA = 5;
export const SMOOTHING_PRIOR = 0.9;

/* ------------------------------------------------- adaptive sampling (F5) -- */

export const WEIGHT_EXPONENT = 2;

/**
 * Deliberately tiny. Starvation is prevented by the exploration draw, not by the floor,
 * and a large floor actively compresses the weak:strong ratio: at 0.05 a 50%-accuracy
 * unit weighed only 4.6x a 99% one, below the 5x that acceptance criterion #6 asks for.
 */
export const WEIGHT_FLOOR = 0.01;

export const SAMPLE_BOOST = 2.5;
export const SAMPLE_BOOST_THRESHOLD = 10;

/**
 * An unmeasured unit is treated as if it were at 60% accuracy. Using the display prior
 * (0.9) here instead would make the keys you have never typed the ones you practise
 * least, which is exactly backwards.
 */
export const UNSEEN_WEIGHT = 0.16;

/** 85% of draws follow the weights, 15% are uniform so no unit can starve. */
export const EXPLORATION_SHARE = 0.15;

/**
 * A unit already drawn this session has its weight multiplied by this per prior use, so
 * one weak key cannot turn a whole drill into the same word over and over.
 */
export const SESSION_UNIT_DECAY = 0.5;

/** Cold start: no history, so walk outwards from the home row. */
export const COLD_START_ROW_WEIGHT: Readonly<Record<number, number>> = {
  1: 0.4,
  2: 0.75,
  3: 1,
  4: 0.6,
  5: 0.5,
};

/** Reaching for Shift is its own skill, so shifted characters start lower. */
export const COLD_START_SHIFTED_FACTOR = 0.5;

/** Only the characters shape uses this: chance a drawn unit is embedded in a 3-5 char group. */
export const EMBED_PROBABILITY = 0.7;

/* ----------------------------------------------------------------- latency -- */

/** Gaps longer than this are treated as "stepped away" and excluded. */
export const IDLE_GAP_MS = 1500;

/** Below this much active time, speed numbers are noise; report "—" instead. */
export const MIN_SPEED_WINDOW_MS = 1000;

/* --------------------------------------------------------------- keyboard -- */

/** DESIGN.md §4.3 — Tab is deliberately NOT intercepted. */
export const RESTART_KEY = 'Escape';
export const NEXT_SESSION_KEY = 'Enter';
