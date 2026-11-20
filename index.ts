import { XMLParser } from "fast-xml-parser";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import "dotenv/config";

const WORK_DIR = path.dirname(new URL(import.meta.url).pathname);
const TMP_DIR = path.join(WORK_DIR, "tmp");
const BED_PATH = path.join(WORK_DIR, "branding", "bed.mp3");
const INTRO_PATH = path.join(WORK_DIR, "branding", "intro.mp3");
const BRIDGE_PATH = path.join(WORK_DIR, "branding", "bridge.mp3");
const OUT_PATH = path.join(WORK_DIR, "final.mp3");
type Mode = "uwu" | "northern" | "unhinged";

const VOICE_IDS: Record<Mode, string> = {
	uwu: "jBpfuIE2acCO8z3wKNLl", // Gigi - young, bubbly
	northern: "7rQX8r6PVq3gfJ8rZzyE", // John of the North
	unhinged: "rHWSYoq8UlV0YIBKMryp", // The unhinged surfer
};

const RSS_FEEDS = [
	"https://feeds.bbci.co.uk/news/rss.xml",
	"https://feeds.npr.org/1001/rss.xml",
	"https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml",
	"https://www.theguardian.com/world/rss",
];

interface Story {
	title: string;
	description: string;
}

interface UwuScript {
	intro: string;
	stories: string[];
	outro: string;
}

// ── Step 1: Fetch RSS stories ─────────────────────────────────────────────────

async function fetchRssStories(feeds: string[]): Promise<Story[]> {
	const parser = new XMLParser({
		ignoreAttributes: false,
		cdataPropName: "__cdata",
	});

	const results = await Promise.allSettled(
		feeds.map(async (url) => {
			const res = await fetch(url, {
				headers: { "User-Agent": "UWU-News-Bot/1.0" },
				signal: AbortSignal.timeout(10_000),
			});
			if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
			return { xml: await res.text(), url };
		}),
	);

	const stripHtml = (s: unknown): string =>
		String(s ?? "")
			.replace(/<[^>]+>/g, "")
			.replace(/&amp;/g, "&")
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'")
			.replace(/&nbsp;/g, " ")
			.replace(/&[a-z]+;/gi, "")
			.trim();

	const stories: Story[] = [];
	const seen = new Set<string>();

	for (const result of results) {
		if (result.status === "rejected") {
			console.warn(`[RSS] Feed failed: ${result.reason}`);
			continue;
		}

		try {
			const parsed = parser.parse(result.value.xml);
			const items: unknown[] = parsed?.rss?.channel?.item ?? [];
			for (const item of items) {
				if (typeof item !== "object" || item === null) continue;
				const obj = item as Record<string, unknown>;

				const rawTitle =
					(obj.title as string) ||
					((obj.title as Record<string, unknown>)?.__cdata as string) ||
					"";
				const rawDesc =
					(obj.description as string) ||
					((obj.description as Record<string, unknown>)?.__cdata as string) ||
					"";

				const title = stripHtml(rawTitle);
				const description = stripHtml(rawDesc);

				if (!title || seen.has(title)) continue;
				seen.add(title);
				stories.push({ title, description });

				if (stories.length >= 20) break;
			}
		} catch (e) {
			console.warn(`[RSS] Parse error for ${result.value.url}: ${e}`);
		}

		if (stories.length >= 20) break;
	}

	console.log(`[RSS] Fetched ${stories.length} stories`);
	return stories;
}

// ── Step 2: Generate script via OpenRouter ────────────────────────────────────

const USER_MESSAGES: Record<Mode, (stories: Story[]) => string> = {
	uwu: (
		stories,
	) => `Here are today's top news stories. Select 5-8 of the most interesting ones and rewrite them in UWU kawaii style.

Stories:
${JSON.stringify(stories, null, 2)}

Return this exact JSON structure (raw JSON only, no code fences):
{
  "intro": "UWU kawaii welcome greeting followed by a brief one-sentence teaser for each story you selected (like a headlines preview), e.g. 'Coming up: something about bwead pwices~ and a vewy exciting thing about space OwO!'",
  "stories": ["full rewritten story 1", "full rewritten story 2", ...],
  "outro": "UWU kawaii goodbye sign-off message"
}`,
	northern: (
		stories,
	) => `Here are today's top news stories. Select 5-8 of the most interesting ones and rewrite them in John of the North style.

Stories:
${JSON.stringify(stories, null, 2)}

Return this exact JSON structure (raw JSON only, no code fences):
{
  "intro": "John's passionate northern welcome with a headline teaser for each story",
  "stories": ["full rewritten story with tangents and northern dialect", ...],
  "outro": "John's rousing northern sign-off"
}`,
	unhinged: (
		stories,
	) => `Here are today's top news stories. Select 5-8 of the most interesting ones and rewrite them in the unhinged surfer anchor style.

Stories:
${JSON.stringify(stories, null, 2)}

Return this exact JSON structure (raw JSON only, no code fences):
{
  "intro": "Manic upbeat welcome laced with swearing, surfboard references, and a flash of existential dread, with teasers for each story",
  "stories": ["full rewritten story with swearing, surfboard tangents, and underlying hatred of existence", ...],
  "outro": "Cheerful sign-off that briefly acknowledges nothing matters before wishing everyone a sick session"
}`,
};

function buildPrompts(
	stories: Story[],
	mode: Mode,
): { systemPrompt: string; userMessage: string } {
	const systemPrompt = fs
		.readFileSync(path.join(WORK_DIR, `prompts/${mode}.md`), "utf8")
		.trim();
	const userMessage = USER_MESSAGES[mode](stories);
	return { systemPrompt, userMessage };
}

async function generateScript(
	stories: Story[],
	apiKey: string,
	mode: Mode,
): Promise<UwuScript> {
	console.log(`[OpenRouter] Generating ${mode} script...`);

	const { systemPrompt, userMessage } = buildPrompts(stories, mode);

	const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model: "anthropic/claude-haiku-4-5",
			max_tokens: mode === "unhinged" ? 4096 : 2048,
			messages: [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: userMessage },
			],
		}),
	});

	if (!res.ok) {
		const errText = await res.text();
		throw new Error(`OpenRouter HTTP ${res.status}: ${errText}`);
	}

	const data = (await res.json()) as {
		choices: Array<{ message: { content: string } }>;
	};
	const rawText = data.choices[0]?.message?.content ?? "";

	const cleaned = rawText
		.replace(/^```(?:json)?\s*/i, "")
		.replace(/\s*```\s*$/i, "")
		.trim();

	const script = JSON.parse(cleaned) as UwuScript;
	console.log(
		`[OpenRouter] Script ready: intro + ${script.stories.length} stories + outro`,
	);
	return script;
}

// ── Step 3: Synthesize speech via ElevenLabs ──────────────────────────────────

async function synthesizeSpeech(
	text: string,
	outputPath: string,
	apiKey: string,
	voiceId: string,
): Promise<void> {
	const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`;

	const body = JSON.stringify({
		text,
		model_id: "eleven_multilingual_v2",
		voice_settings: {
			stability: 0.5,
			similarity_boost: 0.85,
		},
	});

	let lastError: Error | null = null;
	const delays = [2000, 4000];

	for (let attempt = 0; attempt <= 2; attempt++) {
		const res = await fetch(url, {
			method: "POST",
			headers: {
				"xi-api-key": apiKey,
				"Content-Type": "application/json",
				Accept: "audio/mpeg",
			},
			body,
		});

		if (res.status === 429 && attempt < 2) {
			console.warn(
				`[ElevenLabs] Rate limited, retrying in ${delays[attempt] / 1000}s...`,
			);
			await new Promise((r) => setTimeout(r, delays[attempt]));
			lastError = new Error("Rate limited");
			continue;
		}

		if (!res.ok) {
			const errText = await res.text();
			throw new Error(`ElevenLabs HTTP ${res.status}: ${errText}`);
		}

		const buffer = await res.arrayBuffer();
		fs.writeFileSync(outputPath, Buffer.from(buffer));
		return;
	}

	throw lastError ?? new Error("ElevenLabs synthesis failed");
}

interface AudioFiles {
	introFile: string;
	storyFiles: string[];
	outroFile: string;
}

// ── Step 4: Generate all audio files ─────────────────────────────────────────

async function generateAllAudio(
	script: UwuScript,
	apiKey: string,
	voiceId: string,
): Promise<AudioFiles> {
	fs.mkdirSync(TMP_DIR, { recursive: true });

	const introFile = path.join(TMP_DIR, "tts_intro.mp3");
	console.log("[ElevenLabs] Synthesizing intro...");
	await synthesizeSpeech(script.intro, introFile, apiKey, voiceId);

	const storyFiles: string[] = [];
	for (let i = 0; i < script.stories.length; i++) {
		const outPath = path.join(TMP_DIR, `tts_story_${i}.mp3`);
		console.log(`[ElevenLabs] Synthesizing story_${i}...`);
		await synthesizeSpeech(script.stories[i], outPath, apiKey, voiceId);
		storyFiles.push(outPath);
	}

	const outroFile = path.join(TMP_DIR, "tts_outro.mp3");
	console.log("[ElevenLabs] Synthesizing outro...");
	await synthesizeSpeech(script.outro, outroFile, apiKey, voiceId);

	console.log(`[ElevenLabs] Generated ${2 + storyFiles.length} audio files`);
	return { introFile, storyFiles, outroFile };
}

// ── Step 5: Mix audio with ffmpeg ─────────────────────────────────────────────

function ffmpeg(args: string, label: string): void {
	try {
		execSync(`ffmpeg -y ${args}`, { stdio: "pipe" });
	} catch (e: unknown) {
		const err = e as { stderr?: Buffer; message?: string };
		throw new Error(
			`ffmpeg ${label} failed: ${err.stderr?.toString() ?? err.message}`,
		);
	}
}

function mixAudio(audio: AudioFiles): void {
	const { introFile, storyFiles, outroFile } = audio;
	const t = (name: string) => path.join(TMP_DIR, name);

	// ── 5a. Concat story voice files (with 0.5s silence between each) ───────────
	const silencePath = t("silence.mp3");
	ffmpeg(
		`-f lavfi -i anullsrc=r=44100:cl=stereo -t 0.5 -q:a 2 "${silencePath}"`,
		"silence gen",
	);
	const storiesWithGaps = storyFiles.flatMap((f, i) =>
		i < storyFiles.length - 1
			? [`file '${f}'`, `file '${silencePath}'`]
			: [`file '${f}'`],
	);
	fs.writeFileSync(t("stories_concat.txt"), storiesWithGaps.join("\n"));
	console.log("[ffmpeg] Concatenating story segments...");
	ffmpeg(
		`-f concat -safe 0 -i "${t("stories_concat.txt")}" -c copy "${t("tts_stories.mp3")}"`,
		"stories concat",
	);

	// ── 5b. Build sections — all normalised to 44100 Hz stereo mp3 ───────────

	// Section 1: intro.mp3 music (strip cover art, normalise)
	console.log("[ffmpeg] Building section: intro music...");
	ffmpeg(
		`-i "${INTRO_PATH}" -vn -ac 2 -ar 44100 -q:a 2 "${t("sec1_intro_music.mp3")}"`,
		"sec1",
	);

	// Section 2: TTS welcome+headlines mixed with looping bed (ducked under voice)
	// Sidechain: voice triggers compression on bed — bed drops when speech is detected
	console.log("[ffmpeg] Building section: welcome + bed (ducked)...");
	ffmpeg(
		`-i "${introFile}" -stream_loop -1 -i "${BED_PATH}" ` +
			`-filter_complex "[0:a]asplit=2[voice_out][voice_sc];[1:a]volume=0.5[bed];` +
			`[bed][voice_sc]sidechaincompress=level_sc=5:threshold=0.02:ratio=8:attack=100:release=600[bed_ducked];` +
			`[voice_out][bed_ducked]amix=inputs=2:duration=first:normalize=0[out]" ` +
			`-map "[out]" -vn -ac 2 -ar 44100 -q:a 2 "${t("sec2_welcome.mp3")}"`,
		"sec2",
	);

	// Section 3: bridge.mp3 (bed dips away)
	console.log("[ffmpeg] Building section: bridge...");
	ffmpeg(
		`-i "${BRIDGE_PATH}" -vn -ac 2 -ar 44100 -q:a 2 "${t("sec3_bridge.mp3")}"`,
		"sec3",
	);

	// Section 4: stories, no bed
	console.log("[ffmpeg] Building section: stories (dry)...");
	ffmpeg(
		`-i "${t("tts_stories.mp3")}" -ac 2 -ar 44100 -q:a 2 "${t("sec4_stories.mp3")}"`,
		"sec4",
	);

	// Section 5: TTS outro mixed with looping bed (ducked under voice)
	console.log("[ffmpeg] Building section: outro + bed (ducked)...");
	ffmpeg(
		`-i "${outroFile}" -stream_loop -1 -i "${BED_PATH}" ` +
			`-filter_complex "[0:a]asplit=2[voice_out][voice_sc];[1:a]volume=0.5[bed];` +
			`[bed][voice_sc]sidechaincompress=level_sc=5:threshold=0.02:ratio=8:attack=100:release=600[bed_ducked];` +
			`[voice_out][bed_ducked]amix=inputs=2:duration=first:normalize=0[out]" ` +
			`-map "[out]" -vn -ac 2 -ar 44100 -q:a 2 "${t("sec5_outro.mp3")}"`,
		"sec5",
	);

	// Section 6: intro.mp3 again as sign-off
	console.log("[ffmpeg] Building section: sign-off music...");
	ffmpeg(
		`-i "${INTRO_PATH}" -vn -ac 2 -ar 44100 -q:a 2 "${t("sec6_signoff.mp3")}"`,
		"sec6",
	);

	// ── 5c. Concatenate all sections into final.mp3 ───────────────────────────
	const sections = [
		t("sec1_intro_music.mp3"),
		t("sec2_welcome.mp3"),
		t("sec3_bridge.mp3"),
		t("sec4_stories.mp3"),
		t("sec5_outro.mp3"),
		t("sec6_signoff.mp3"),
	];
	const finalConcatList = sections.map((f) => `file '${f}'`).join("\n");
	fs.writeFileSync(t("final_concat.txt"), finalConcatList);
	console.log("[ffmpeg] Assembling final.mp3...");
	ffmpeg(
		`-f concat -safe 0 -i "${t("final_concat.txt")}" -c copy "${OUT_PATH}"`,
		"final concat",
	);

	// ── 5d. Cleanup ───────────────────────────────────────────────────────────
	fs.rmSync(TMP_DIR, { recursive: true, force: true });
	console.log("[ffmpeg] Cleanup done");
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	const openrouterKey = process.env.OPENROUTER_API_KEY;
	const elevenKey = process.env.ELEVENLABS_API_KEY;

	if (!openrouterKey) {
		console.error("Error: OPENROUTER_API_KEY is not set");
		process.exit(1);
	}
	if (!elevenKey) {
		console.error("Error: ELEVENLABS_API_KEY is not set");
		process.exit(1);
	}
	if (!fs.existsSync(BED_PATH)) {
		console.error(`Error: bed.mp3 not found at ${BED_PATH}`);
		process.exit(1);
	}
	if (!fs.existsSync(INTRO_PATH)) {
		console.error(`Error: intro.mp3 not found at ${INTRO_PATH}`);
		process.exit(1);
	}
	if (!fs.existsSync(BRIDGE_PATH)) {
		console.error(`Error: bridge.mp3 not found at ${BRIDGE_PATH}`);
		process.exit(1);
	}

	const mode: Mode = process.argv.includes("--northern")
		? "northern"
		: process.argv.includes("--unhinged")
			? "unhinged"
			: "uwu";

	const titles: Record<Mode, string> = {
		uwu: "UWU News",
		northern: "John of the North News",
		unhinged: "Unhinged Surf Report",
	};

	console.log(`=== ${titles[mode]} ===`);

	const stories = await fetchRssStories(RSS_FEEDS);
	if (stories.length === 0) {
		console.error("No stories fetched — check network/feeds");
		process.exit(1);
	}

	const script = await generateScript(stories, openrouterKey, mode);
	const audioFiles = await generateAllAudio(script, elevenKey, VOICE_IDS[mode]);
	mixAudio(audioFiles);

	console.log(`\nDone! Output: final.mp3`);
}

main().catch((e) => {
	console.error("Fatal:", e);
	process.exit(1);
});
