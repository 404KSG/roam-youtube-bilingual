import { setupPlayerControlsFixture } from './player-controls-browser.mjs';

// Simulated player state/AX observations, with actual browser iframe focus and
// layout. Never run against a user graph or use this as live YouTube evidence.
export async function runPausedPositionAcceptance() {
  const fixture = await setupPlayerControlsFixture();
  const results = {}; let cleaned = false;
  const check = (condition, name) => { if (!condition) throw new Error(name); results[name] = true; };
  const focused = () => document.activeElement === fixture.frame;
  const expectGap = gap => Math.abs(fixture.probe().gap - gap) < 1;
  const settlePolls = async count => { const before = fixture.ccChecks; await fixture.wait(() => fixture.ccChecks >= before + count); };
  try {
    const before = fixture.probe();
    check(expectGap(128), 'paused player with visible controls reserves the transport area');
    fixture.frame.focus();
    check(focused(), 'click-style focus can remain on the iframe');
    fixture.playback(2, true);
    fixture.frame.dispatchEvent(new Event('pointerleave'));
    check(expectGap(128), 'mouse departure keeps a bounded grace period rather than immediately covering controls');
    await fixture.wait(() => !fixture.box().hidden && expectGap(496 * .08));
    check(focused(), 'hidden-controls recovery does not steal or blur iframe focus');
    check(expectGap(39.68), 'paused captions return from 128px to the normal 8-percent bottom gap');
    const low = fixture.probe();
    check(low.source === before.source && low.target === before.target && low.sizes.join() === before.sizes.join(), 'position recovery preserves caption text and font settings');
    await settlePolls(3);
    check(expectGap(39.68), 'repeated hidden-controls observations do not bounce the paused caption');
    fixture.frame.dispatchEvent(new Event('pointerenter'));
    check(expectGap(128), 'pointer re-entry raises unchanged paused captions before the next helper poll');
    fixture.playback(2);
    document.querySelector('#outside').focus();
    // The legacy reason only describes a missing CC checkbox; transport is visible.
    fixture.nativeCc('unknown', 'controls-hidden', true);
    await settlePolls(6);
    check(!fixture.box().hidden && expectGap(128), 'a visible seek bar stays protected even when its CC checkbox is absent');
    fixture.frame.focus(); fixture.playback(2, true); fixture.frame.dispatchEvent(new Event('pointerleave'));
    await fixture.wait(() => !fixture.box().hidden && expectGap(39.68));
    check(focused(), 'a second pause and mouse departure also recovers with focus retained');
    fixture.playback(1, true);
    await settlePolls(2);
    check(expectGap(39.68), 'resuming with hidden controls preserves the normal low position');
    fixture.playback(2, false);
    await fixture.wait(() => expectGap(128));
    check(fixture.probe().box.bottom <= fixture.probe().controlsTop - 8, 'returning paused controls restores safe clearance without a cue change');
    check(fixture.probe().requests === 1, 'control visibility and focus never restart caption downloads');
    fixture.cleanup(); cleaned = true;
    check(!document.querySelector('.ryb-surface-host,.ryb-settings-host,.ryb-toolbar-button'), 'unload removes the fixture-owned subtitle UI');
    return results;
  } catch (error) { error.message += JSON.stringify({ passed: Object.keys(results), geometry: fixture.probe(), focused: focused() }); throw error; }
  finally { if (!cleaned) fixture.cleanup(); }
}
