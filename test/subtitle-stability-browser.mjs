import { setupPlayerControlsFixture } from './player-controls-browser.mjs';

// Owned srcdoc player and synthetic caption/CC observations, not live YouTube.
export async function runSubtitleStabilityAcceptance() {
  const source = [
    { start: 0, end: 2, text: 'Today we are going to explain how a very long' },
    { start: 2.08, end: 4, text: 'a very long bilingual caption remains readable' },
    { start: 4, end: 6, text: 'remains readable while the speaker finishes.' },
    { start: 7, end: 9, text: 'A new sentence.' },
  ];
  const translation = '这条完整译文会跨越三段英文，但在同一字幕块中只显示一次。';
  const fixture = await setupPlayerControlsFixture({ sourceCues: source, targetCues: [
    { start: 0, end: 6, text: translation }, { start: 7, end: 9, text: '下一句。' },
  ] });
  const results = {}; let cleaned = false;
  const check = (condition, name) => { if (!condition) throw new Error(name); results[name] = true; };
  const notice = () => fixture.host().shadowRoot.querySelector('.ryb-notice');
  const observe = async (state, reason) => {
    const before = fixture.ccChecks;
    fixture.nativeCc(state, reason);
    await fixture.wait(() => fixture.ccChecks > before && fixture.box().hidden === (state === 'on' || ['controls-visible', 'player-not-visible'].includes(reason)));
  };
  const sample = time => { fixture.at(time); return fixture.probe(); };
  try {
    let p = sample(1);
    check(!p.hidden && p.source === source[0].text, 'long groups do not reveal future source cues');
    check(p.target === translation, 'one long target is shown once across short source cues');
    const mutations = [];
    const observer = new MutationObserver(records => mutations.push(...records));
    observer.observe(fixture.box(), { childList: true, subtree: true, characterData: true, attributes: true });
    try {
      for (const time of [1.1, 1.3, 1.7]) sample(time);
      await Promise.resolve();
      check(mutations.length === 0, 'unchanged caption ticks do not rewrite text or layout');
    } finally { observer.disconnect(); }
    p = sample(2.04);
    check(!p.hidden && p.source === source[0].text, 'tiny authoring gaps keep the spoken prefix without flashing blank');
    p = sample(2.2);
    check(!p.hidden && p.source === 'Today we are going to explain how a very long bilingual caption remains readable' && p.target === translation, 'rolling source overlap and shared translation are not duplicated');
    p = sample(5);
    check(!p.hidden && p.source.endsWith('remains readable while the speaker finishes.') && p.target === translation, 'the final spoken part remains visible until its boundary');
    check(sample(6.5).hidden, 'real speech gaps remain empty');
    check(sample(7.5).source === source[3].text, 'forward seek selects the next sentence');
    check(sample(1).source === source[0].text, 'backward seek removes future text');
    await fixture.geometry('height:360px;width:360px;', '');
    await fixture.wait(() => fixture.probe().frame.width <= 361);
    sample(5);
    await fixture.wait(() => !fixture.box().hidden && fixture.probe().source === source[2].text);
    p = fixture.probe();
    check(!p.hidden && p.source === source[2].text, 'narrow player uses the active original part rather than a squeezed paragraph');
    await fixture.geometry('height:496px;width:100%;', '');
    sample(1);
    await fixture.wait(() => !fixture.box().hidden);
    for (let cycle = 0; cycle < 3; cycle++) {
      fixture.playback(2);
      await observe('on', 'control');
      check(fixture.box().hidden && notice().hidden, `pause ${cycle + 1}: recovery hides unsafe captions without a transient warning`);
      await observe('off', 'control');
      check(!fixture.box().hidden && notice().hidden, `pause ${cycle + 1}: verified recovery restores captions quietly`);
    }
    await observe('unknown', 'controls-visible');
    check(fixture.box().hidden && notice().hidden, 'ambiguous pause chrome hides captions without a false CC-on toast');
    await observe('unknown', 'controls-hidden');
    check(!fixture.box().hidden && notice().hidden, 'hiding ambiguous chrome recovers the verified-off caption state');
    await observe('on', 'control');
    await fixture.wait(() => !notice().hidden);
    check(fixture.box().hidden && notice().textContent.includes('Native captions are still on'), 'a persistent real CC conflict still produces a warning');
    await observe('off', 'control');
    check(!fixture.box().hidden && notice().hidden, 'explicit OFF clears the persistent conflict warning');
    await observe('unknown', 'player-not-visible');
    check(fixture.box().hidden, 'lost player scope always closes the caption gate');
    check(fixture.probe().requests === 1, 'seeks, resize, pause and CC recovery do not redownload captions');
    fixture.cleanup(); cleaned = true;
    check(!document.querySelector('.ryb-surface-host,.ryb-settings-host,.ryb-toolbar-button'), 'unload removes all owned subtitle UI');
    return results;
  } catch (error) {
    error.message += JSON.stringify({ passed: Object.keys(results), probe: fixture.probe() });
    throw error;
  } finally { if (!cleaned) fixture.cleanup(); }
}
