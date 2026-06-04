# ElevenLabs Model Recommendation For The Pest-Control Receptionist

Current Retell candidate settings:

```txt
voice_id=11labs-Cimo
voice_model=eleven_v3
voice_speed=1.12
```

Do not change the live phone-bound model automatically. This recommendation is for the next controlled A/B test.

## Summary

For a production AI receptionist, start future optimization tests with `eleven_flash_v2_5`. Keep `eleven_v3` for the current demo if the user prefers the more expressive Cimo delivery and the latency is acceptable.

## Comparison

| Model | Strength | Latency / Cost Notes | Fit For This Receptionist |
| --- | --- | --- | --- |
| `eleven_flash_v2_5` | Fast, affordable real-time TTS | ElevenLabs lists Flash v2.5 as ultra-low latency around 75 ms and 50% lower price per character. | Best production default to test for phone calls where responsiveness matters. |
| `eleven_turbo_v2_5` | Quality/speed balance | ElevenLabs lists Turbo v2.5 around 250-300 ms and notes Flash models are lower latency on average than equivalent Turbo models. | Usually not the first choice if Flash v2.5 is available. |
| `eleven_v3` | Most expressive / emotionally rich | ElevenLabs describes v3 as highly expressive, but help docs say higher latency and variable consistency mean it is not suitable for real-time or conversational use cases. | Good demo voice if it sounds better live, but test latency carefully before production. |

## Recommendation

1. Keep `eleven_v3` for the immediate demo because the current Cimo voice already sounded good in live testing.
2. Create an unbound duplicate candidate later using `eleven_flash_v2_5` for an A/B live call test.
3. Move production receptionists to Flash v2.5 if it preserves enough naturalness, because it should reduce response latency and cost.
4. Avoid switching to Turbo v2.5 unless a specific Retell/voice combination performs better than Flash in live tests.

## Sources

- ElevenLabs model docs: `https://elevenlabs.io/docs/overview/models`
- ElevenLabs conversational/chatbot help: `https://help.elevenlabs.io/hc/en-us/articles/19954594946705-Do-you-offer-an-AI-model-for-conversational-purposes-or-for-chatbots`
- ElevenLabs v3 help: `https://help.elevenlabs.io/hc/en-us/articles/35869054119057-What-is-Eleven-v3`

