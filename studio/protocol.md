# Flaw Studio protocol (elicited human flaws)

The instruction shown on screen **is the label**. Forced alignment pins where the instructed words were actually spoken, and a person verifies the result, so human recordings get near-exact labels without frame-by-frame hand labelling.

## Session (≈15 min per volunteer)
1. Consent (`studio/consent.md`) and age check (18+). Optional metadata: first language, accent region, gender, device, age band.
2. Mic check: level meter; warn when the noise floor is within 25 dB of speech or the input clips.
3. For each of two scripts: listen once to the original orator → record one **good** take ("deliver it as well as you can, in your own voice") → record three **instructed-flaw** takes (one flaw each, mild or strong).
4. Upload. The server converts to 16 kHz mono WAV, aligns the transcript and proposes the realised label span.

## Assignment design
`GET /v1/studio/assignment?speaker_id=…` is a pure function of the pseudonymous id (SHA-256 based), so no coordination is needed between recruiters. Scripts, flaw types and severities rotate across volunteers (a Latin-square style design): each speaker gets 2 of the 6 scripts and 3 of the 10 flaw types per script, with sites chosen by the same site rules the synthetic injector uses (`choose_site`).

## Verification (Flaw Studio → Review page)
- Two team members listen to every **good** take and accept it only if it is fluent, on-script and free of obvious flaws. Accepted good takes are copied to `data/studio/accepted/<script>/` and immediately join the population baseline for that script (leave-speaker-out at evaluation time).
- For **flawed** takes the reviewer checks the flaw was actually performed (reject otherwise), adjusts the proposed start/end if needed, and adds any unplanned natural flaw as an extra label with `label_source = natural`.
- 20% of takes are reviewed twice to report agreement: boundary error (ms), temporal IoU and Cohen's κ on flaw type.

## Recruiting rules
Classmates, the college debate society and hostel groups. **Never** the hackathon Discord (those people are competitors). Minimum viable set: 10 volunteers; target 30.

## Instructions shown (by flaw type)
| Flaw | Instruction |
|---|---|
| rushed | Rush the highlighted words: say them {a little / a lot} faster than the rest. |
| dragged | Drag the highlighted words out: say them {a little / a lot} slower than the rest. |
| long_pause | After the highlighted word, stop for an awkward pause (about {1 / 2} seconds). |
| missing_pause | Do not pause after the highlighted word: run straight into the next one. |
| monotone | Say the highlighted words flat, on one note, like reading a list. |
| volume_fade | Let your voice fade away {a little / a lot} on the highlighted words. |
| mumble | Mumble the highlighted words: barely open your mouth. |
| filler | Say "uhh" or "umm" just before the highlighted word. |
| stutter | Stutter the start of the highlighted word, like "c-c-country". |
| misplaced_emphasis | Stress the highlighted small word {a little / a lot}, and keep the word next to it flat. |
