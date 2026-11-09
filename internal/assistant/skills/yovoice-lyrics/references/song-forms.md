# Song forms and lyric craft

Pick the form from the genre, mood and length the user wants. Do not default to the same verse / pre-chorus / chorus / bridge / outro shape every time. Name the form you chose in one short phrase in your reply.

## Forms to choose from

| Form | Section order | Fits |
| --- | --- | --- |
| Short verse-chorus | Verse, Chorus, Verse, Chorus | Jingles, demos, songs about one minute long |
| Pop with lift | Verse, Pre-Chorus, Chorus, Verse, Pre-Chorus, Chorus, Bridge, Chorus | Mainstream pop, city pop, dance |
| Post-chorus hook | Verse, Chorus, Post-Chorus, Verse, Chorus, Post-Chorus, Outro | EDM-pop, K-pop; the post-chorus is a short chant or syllable hook |
| AABA (32-bar) | Verse, Verse, Bridge, Verse | Jazz standards, crooner songs, old Mandopop; the title line closes each A |
| Strophic | Verse, Verse, Verse, Verse (same melody, new story each time), optional refrain line | Folk, ballads, story songs, children's songs |
| Verse-refrain | Verse ending in a fixed refrain line, repeated | Folk, country, singer-songwriter |
| Hip-hop | Intro, Verse (12–16 lines), Hook, Verse, Hook, Outro | Rap, trap; verses dense and rhythmic, hook short and sung |
| Through-composed | Intro, Part A, Part B, Part C, Outro, little or no repetition | Art songs, cinematic, theatre pieces |
| Ballad with climax | Intro, Verse, Verse, Chorus, Interlude, Chorus, Bridge, Final Chorus, Outro | Big ballads; the final chorus rises (key change or fuller words) |
| Chant / anthem | Intro, Chorus, Verse, Chorus, Chorus | Sports anthems, rock anthems, crowd songs |

Mix forms deliberately: open on the chorus, add a spoken intro, drop the bridge, end on a half-chorus, let a solo replace the second verse. Vary line counts: a verse can be 2, 4, 6 or 8 lines; a chorus 2–6.

## YuE2 style: describe how the song unfolds

The style is the strongest lever YuE2 has for making songs differ. The official demos range from three words (`funk`) to a 900-character paragraph; the varied ones describe the arrangement over time. Name the sung language, genre, lead vocal, core instruments and tempo, then add one to three sentences about the shape. Pick the opening deliberately instead of always "instrumental intro, then verse":

- Cold open: the voice starts at once, no intro tag, e.g. `vocals enter immediately over a lone guitar`.
- Hook first: open on the chorus or a sung hook, then drop to the verse.
- Short pickup: a one- or two-bar drum fill or riff, then the voice.
- Long build: an instrumental theme that the voice later picks up, e.g. `eight-bar piano and flute dialogue before a breathy female vocal enters`.

Then say what moves later: an instrument joining or dropping out, a stripped bridge, a solo, a key lift or final build, call-and-response, how it ends (fade, full stop, a cappella last line). Contrast the sections in words, e.g. `intimate verses, bright singable chorus`.

Other habits from the official prompts:
- End with the tempo, e.g. `4/4, 96 BPM`. Vary it between songs: the official demos run from 68 to 196 BPM, around 120 in the middle, while a slow ballad at 70 is what YuE2 drifts to when nothing is said. The score writer usually follows the number but sometimes reads it at half or double time; check `Q:` in the planned score and fix it with `transform_melody` {"op":"tempo"} if needed.
- The score writer writes 4/4 (sometimes 2/4). Do not ask for 3/4 or 6/8 in the style; a waltz or a brief 3/4 bar is a score edit, and then the style says so (`brief 3/4 transitions as written`).
- Add `clear Mandarin diction` (or the sung language) for intelligible words, and `complete every written lyric phrase` when lines tend to get skipped.
- Say what is absent or resting as well as what plays: `no guitars`, `the singer rests during the saxophone solo`. When the score has a solo or a sung motif, the style should describe the same thing.
- Point at the words to hold: `let stressed words such as dawn and home ring clearly`, `sustain vowels through melismas`.

Examples in the spirit of the official demos (do not reuse them verbatim):

| Song | style |
| --- | --- |
| Japanese easy listening | `Japanese, gentle melancholic easy listening. A delicate piano melody and breathy flute open; a soft, clear female vocal enters almost like a lullaby. Gradually add a downtempo lo-fi beat, warm bass and synth pads. End on an instrumental piano and flute outro that fades out.` |
| Flamenco hip-hop duet | `Spanish, flamenco meets hip-hop, 95 BPM. Female flamenco vocal over slow compás, palmas and guitar, then the beat drops and a deep male rap enters on cajón and bass. Choruses sung by her, verses rapped by him, a call-and-response bridge, a festive final chorus together.` |
| J-pop dance | `Japanese, high-energy J-pop dance, 138 BPM, bright female lead, vocal chops, synth bass, four-on-the-floor. Belted choruses, a contrasting half-time bridge, a guitar solo, then a breakdown that builds into the last chorus.` |
| Alt metal | `English, alternative metal, 100 BPM, cinematic. Gritty male lead; verses in melodic rap and near-spoken delivery, choruses sung with full intensity. Heavy guitars, piano and electronic textures; a quiet piano bridge before the final chorus.` |
| Mandarin acoustic pop (official example) | `Mandarin, contemporary acoustic pop, warm expressive female lead vocal, clear Mandarin diction, piano, clean electric guitar, melodic electric bass, tight acoustic drums, bright singable chorus, intimate verses, hopeful bittersweet mood, polished studio recording, 4/4, 96 BPM` |
| Mandarin ballad | `Mandarin, piano ballad, warm male vocal, clear Mandarin diction. Voice and piano only for the first verse, strings join in the chorus, everything drops out for the bridge except the vocal, the last chorus rises a whole step. 4/4, 72 BPM` |
| Short tags | `country` or `1980s pop, classic rock` is also valid: with little to go on, YuE2 picks the arrangement itself, which is a good way to get variety. |

## Section tags

Use one tag per line, title-case, in square brackets: `[Intro]`, `[Verse]`, `[Pre-Chorus]`, `[Chorus]`, `[Post-Chorus]`, `[Hook]`, `[Rap]`, `[Bridge]`, `[Interlude]`, `[Breakdown]`, `[Final Chorus]`, `[Outro]`. Instrumental passages can be tagged with what plays, e.g. `[Guitar Solo]`, `[Piano Interlude]`, `[Instrumental Break]`, with no words under them. Numbered verses (`[Verse 2]`) are fine.

For YuE2 a tag may carry a short performance note after a dash or colon, as the official demos do: `[Intro: Piano & Flute]`, `[Verse 2 – husky female voice]`, `[Chorus – both voices, call and response]`, `[Bridge – stripped, vocal and piano only]`, `[Vocal Ad-libs]`. Use this for duets and for contrast between sections. Tags guide YuE2 but do not schedule anything exactly. An intro tag is optional: leave it out (or put sung words under it) when the voice should start right away.

## Length

With YuE2 the song lasts as long as the lyrics need. As a rough guide, each sung line is 3–5 seconds at a medium tempo:
- About 1 minute: 8–12 lines.
- About 2–3 minutes: 20–32 lines.
- Over 4 minutes: 40 or more lines. Generation takes much longer, so only write this many when asked.

ACE-Step has a set duration instead: fit the lyrics to it.

## Make lines singable

- Keep a steady syllable count within a section so the melody can repeat; vary it between sections for contrast (short punchy chorus lines after longer verse lines, or the reverse).
- Put stressed syllables and important words where the beat falls; end lines on open vowels when they will be held.
- Avoid clusters of consonants on fast lines. Leave breathing room: not every line needs to be full.
- Chinese: rhyme the line endings (押韵) in each section, keep tones natural, 7–10 characters per line is typical for pop, shorter for rap hooks.
- English: use concrete images and one central metaphor; avoid filler words added only to fit the meter.

## Keep songs different from each other

- Start from a specific scene, person or detail in the user's request, not a generic feeling.
- Avoid the stock images of a genre unless the user asks for them. For 中国风 these are 青石板、油纸伞、烟雨、老巷、信笺、墨迹; for ballads, rain on the window and fading photos. One familiar image is fine, a whole song of them sounds like every other song.
- No stage directions, sound effects or parenthesised notes in the lyrics (`(音效：留声机底噪)`, `(harpsichord enters)`): YuE2 tries to sing them. Put them in the style.
- Change point of view (first person, second person addressed to someone, a narrator), tense and setting between songs.
- Give the chorus a hook that can stand alone as the title. Change at least one line in the last chorus, or the meaning of the repeated line, so the song moves.
- Do not reuse the example lyrics or phrases from earlier songs in the conversation unless asked.
