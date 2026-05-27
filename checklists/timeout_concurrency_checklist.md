# Timeout / Concurrency Checklist

- [ ] Provider calls inside Round 1 are parallel
- [ ] Provider calls inside Round 2 are parallel
- [ ] No sequential await between providers
- [ ] Promise.allSettled or equivalent used
- [ ] Provider timeout implemented
- [ ] Round timeout implemented
- [ ] Session timeout implemented
- [ ] Retry bounded to max 1
- [ ] Timeout saved as timed_out
- [ ] Provider status visible in UI
- [ ] sessionId returned immediately
- [ ] polling or SSE implemented
- [ ] partial completion supported
- [ ] limited answer supported
- [ ] mock delay test proves concurrency
